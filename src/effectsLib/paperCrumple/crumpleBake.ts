/**
 * 紙が丸められていく過程を Position Based Dynamics で一度だけ解き、
 * 各コマの頂点位置を記録する。
 *
 * 頂点の並びと UV は `THREE.PlaneGeometry(1, 1, segments, segments)` と同じ
 * （上の行から下へ、各行は左から右）。座標は「紙の幅 = 1」の単位で、
 * x は [-0.5, 0.5]、y は [-aspect/2, aspect/2]（aspect = 高さ / 幅）。
 *
 * - 辺の長さを保つ拘束と、隣り合う三角形の向かいの頂点どうしの距離拘束
 *   （曲げの硬さ）で紙を表す。曲げの硬さはランダムな折り線の近くだけ弱くし、
 *   そこから折れるようにする
 * - 縮んでいく球の内側へ押し込んで潰し、近づきすぎた頂点どうしを押し離して
 *   紙が自分を貫通しないようにする
 * - コマ 0 は平らな初期状態そのもの。各コマは最も低い点が z = 0 になるよう持ち上げる
 *
 * 同じ引数なら同じ結果を返す（乱数はシード付き）。
 */

export interface CrumpleBakeOptions {
  /** 縦横の分割数（PlaneGeometry の widthSegments / heightSegments と同じ） */
  segments: number;
  /** 高さ / 幅 */
  aspect: number;
  seed?: number;
  /** 記録するコマ数（コマ 0 の平らな状態を含む） */
  frames?: number;
  /** 折り線の本数 */
  foldCount?: number;
  /** 丸め終えた球の半径（紙の幅に対する比） */
  ballRadius?: number;
  /** 頂点の位置をランダムにずらす量（格子 1 マスに対する比） */
  jitter?: number;
}

export interface CrumpleBake {
  segments: number;
  aspect: number;
  vertexCount: number;
  /** 三角形のインデックス（対角線の向きをランダムにしたもの） */
  index: Uint32Array;
  /** ずらした頂点に合わせた UV */
  uvs: Float32Array;
  /** 各コマの頂点位置（vertexCount * 3） */
  frames: Float32Array[];
}

const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export function bakeCrumple(options: CrumpleBakeOptions): CrumpleBake {
  const seg = Math.max(2, Math.floor(options.segments));
  const aspect = options.aspect > 0 ? options.aspect : 1;
  const frameCount = Math.max(2, Math.floor(options.frames ?? 48));
  const foldCount = Math.max(0, Math.floor(options.foldCount ?? 7));
  const ballRadius = options.ballRadius ?? 0.17;
  const jitter = options.jitter ?? 0.3;
  const rand = mulberry32(options.seed ?? 1);

  const cols = seg + 1;
  const n = cols * cols;
  const dx = 1 / seg;
  const dy = aspect / seg;

  // --- 平らな初期状態（内側の頂点だけずらす）
  const rest = new Float32Array(n * 3);
  const uvs = new Float32Array(n * 2);
  for (let iy = 0; iy < cols; iy++) {
    for (let ix = 0; ix < cols; ix++) {
      const i = iy * cols + ix;
      const inner = ix > 0 && ix < seg && iy > 0 && iy < seg;
      const jx = inner ? (rand() - 0.5) * jitter : 0;
      const jy = inner ? (rand() - 0.5) * jitter : 0;
      const u = (ix + jx) / seg;
      const v = (iy + jy) / seg;
      rest[i * 3] = u - 0.5;
      rest[i * 3 + 1] = aspect / 2 - v * aspect;
      rest[i * 3 + 2] = 0;
      uvs[i * 2] = u;
      uvs[i * 2 + 1] = 1 - v;
    }
  }

  // --- 三角形（対角線の向きをランダムに）
  const index = new Uint32Array(seg * seg * 6);
  let k = 0;
  for (let iy = 0; iy < seg; iy++) {
    for (let ix = 0; ix < seg; ix++) {
      const a = ix + cols * iy;
      const b = ix + cols * (iy + 1);
      const c = ix + 1 + cols * (iy + 1);
      const d = ix + 1 + cols * iy;
      if (rand() < 0.5) {
        index.set([a, b, d, b, c, d], k);
      } else {
        index.set([a, b, c, a, c, d], k);
      }
      k += 6;
    }
  }

  // --- 折り線（中心付近を通るランダムな直線）
  const folds: { px: number; py: number; nx: number; ny: number; sign: number }[] = [];
  for (let f = 0; f < foldCount; f++) {
    const ang = rand() * Math.PI;
    folds.push({
      px: (rand() - 0.5) * 0.7,
      py: (rand() - 0.5) * 0.7 * aspect,
      nx: -Math.sin(ang),
      ny: Math.cos(ang),
      sign: rand() < 0.5 ? -1 : 1,
    });
  }
  const foldWidth = dx * 1.5;
  /** その点が折り線にどれだけ近いか（0〜1）と、山折り/谷折りの向き */
  const foldAt = (x: number, y: number) => {
    let weak = 0;
    let bump = 0;
    for (const f of folds) {
      const d = (x - f.px) * f.nx + (y - f.py) * f.ny;
      const w = Math.exp(-(d * d) / (foldWidth * foldWidth));
      weak = Math.max(weak, w);
      bump += f.sign * w;
    }
    return { weak, bump };
  };

  // --- 拘束（辺と曲げ）
  const edgeKey = (a: number, b: number) => (a < b ? a * n + b : b * n + a);
  const edgeOpp = new Map<number, number[]>();
  for (let t = 0; t < index.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = index[t + e];
      const b = index[t + ((e + 1) % 3)];
      const c = index[t + ((e + 2) % 3)];
      const key = edgeKey(a, b);
      const list = edgeOpp.get(key);
      if (list) list.push(c);
      else edgeOpp.set(key, [c]);
    }
  }
  const restDist = (a: number, b: number) => {
    const x = rest[a * 3] - rest[b * 3];
    const y = rest[a * 3 + 1] - rest[b * 3 + 1];
    return Math.sqrt(x * x + y * y);
  };
  const edges: number[] = [];
  const edgeRest: number[] = [];
  const bends: number[] = [];
  const bendRest: number[] = [];
  const bendStiff: number[] = [];
  for (const [key, opp] of edgeOpp) {
    const a = Math.floor(key / n);
    const b = key % n;
    edges.push(a, b);
    edgeRest.push(restDist(a, b));
    if (opp.length === 2) {
      const [c, d] = opp;
      const mx = (rest[a * 3] + rest[b * 3]) / 2;
      const my = (rest[a * 3 + 1] + rest[b * 3 + 1]) / 2;
      const { weak } = foldAt(mx, my);
      bends.push(c, d);
      bendRest.push(restDist(c, d));
      // 折り線の上はほぼ自由に折れ、それ以外は張りを残す
      bendStiff.push(0.5 * (1 - 0.95 * weak));
    }
  }

  // --- シミュレーション
  const pos = new Float32Array(rest);
  const prev = new Float32Array(rest);
  // 平らなままだと球に押されても面内で縮むだけなので、折り線に沿って
  // わずかに山谷を付けて座屈のきっかけを作る
  for (let i = 0; i < n; i++) {
    const { bump } = foldAt(rest[i * 3], rest[i * 3 + 1]);
    const z = bump * dx * 1.2 + (rand() - 0.5) * dx * 0.3;
    pos[i * 3 + 2] = z;
    prev[i * 3 + 2] = z;
  }

  const project = (a: number, b: number, len: number, stiff: number) => {
    const ax = a * 3;
    const bx = b * 3;
    const x = pos[bx] - pos[ax];
    const y = pos[bx + 1] - pos[ax + 1];
    const z = pos[bx + 2] - pos[ax + 2];
    const d = Math.sqrt(x * x + y * y + z * z);
    if (d < 1e-9) return;
    const s = ((d - len) / d) * 0.5 * stiff;
    pos[ax] += x * s;
    pos[ax + 1] += y * s;
    pos[ax + 2] += z * s;
    pos[bx] -= x * s;
    pos[bx + 1] -= y * s;
    pos[bx + 2] -= z * s;
  };

  // 球の中心は丸めきった玉の中心（紙より上）に置く。縁が内側へ寄るときに
  // 持ち上がるので、面内で縮むだけの円盤にならず、手で握ったように折れ上がる
  const rMin = ballRadius * Math.sqrt(aspect / 0.75);
  const cz = rMin;
  const r0 = Math.sqrt(0.25 + aspect * aspect * 0.25 + cz * cz) * 1.02;
  const contain = (radius: number) => {
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3];
      const y = pos[i * 3 + 1];
      const z = pos[i * 3 + 2] - cz;
      const d = Math.sqrt(x * x + y * y + z * z);
      if (d > radius) {
        const s = radius / d;
        pos[i * 3] = x * s;
        pos[i * 3 + 1] = y * s;
        pos[i * 3 + 2] = z * s + cz;
      }
    }
  };

  // 自己衝突: 空間ハッシュで近傍を引き、元の紙の上で離れていた頂点どうしだけ押し離す
  const thickness = dx * 0.45;
  const tableSize = 1 << Math.ceil(Math.log2(n * 2));
  const cellStart = new Int32Array(tableSize + 1);
  const cellEntries = new Int32Array(n);
  const cellOf = new Int32Array(n);
  const hash = (ix: number, iy: number, iz: number) =>
    ((Math.imul(ix, 92837111) ^ Math.imul(iy, 689287499) ^ Math.imul(iz, 283923481)) >>> 0) &
    (tableSize - 1);
  const minRestGap = Math.max(dx, dy) * 2.2;
  const separate = () => {
    cellStart.fill(0);
    for (let i = 0; i < n; i++) {
      const h = hash(
        Math.floor(pos[i * 3] / thickness),
        Math.floor(pos[i * 3 + 1] / thickness),
        Math.floor(pos[i * 3 + 2] / thickness),
      );
      cellOf[i] = h;
      cellStart[h + 1]++;
    }
    for (let h = 0; h < tableSize; h++) cellStart[h + 1] += cellStart[h];
    const fill = cellStart.slice(0, tableSize);
    for (let i = 0; i < n; i++) cellEntries[fill[cellOf[i]]++] = i;

    const t2 = thickness * thickness;
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(pos[i * 3] / thickness);
      const cy = Math.floor(pos[i * 3 + 1] / thickness);
      const cz = Math.floor(pos[i * 3 + 2] / thickness);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          for (let oz = -1; oz <= 1; oz++) {
            const h = hash(cx + ox, cy + oy, cz + oz);
            for (let e = cellStart[h]; e < cellStart[h + 1]; e++) {
              const j = cellEntries[e];
              if (j <= i) continue;
              const x = pos[j * 3] - pos[i * 3];
              const y = pos[j * 3 + 1] - pos[i * 3 + 1];
              const z = pos[j * 3 + 2] - pos[i * 3 + 2];
              const d2 = x * x + y * y + z * z;
              if (d2 >= t2 || d2 < 1e-12) continue;
              if (restDist(i, j) < minRestGap) continue;
              const d = Math.sqrt(d2);
              const s = ((thickness - d) / d) * 0.5;
              pos[i * 3] -= x * s;
              pos[i * 3 + 1] -= y * s;
              pos[i * 3 + 2] -= z * s;
              pos[j * 3] += x * s;
              pos[j * 3 + 1] += y * s;
              pos[j * 3 + 2] += z * s;
            }
          }
        }
      }
    }
  };

  const frames: Float32Array[] = [new Float32Array(rest)];
  const substeps = 4;
  const damping = 0.9;
  const steps = (frameCount - 1) * substeps;
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    // 序盤はゆっくり、中盤で一気に縮め、最後は締め込む
    const radius = r0 + (rMin - r0) * smoothstep(0, 0.85, t);

    for (let i = 0; i < n * 3; i++) {
      const p = pos[i];
      pos[i] += (p - prev[i]) * damping;
      prev[i] = p;
    }
    for (let it = 0; it < 3; it++) {
      for (let e = 0, m = edgeRest.length; e < m; e++) {
        project(edges[e * 2], edges[e * 2 + 1], edgeRest[e], 1);
      }
    }
    for (let b = 0, m = bendRest.length; b < m; b++) {
      project(bends[b * 2], bends[b * 2 + 1], bendRest[b], bendStiff[b]);
    }
    contain(radius);
    separate();
    contain(radius);

    if (step % substeps === 0) frames.push(new Float32Array(pos));
  }

  // 床（z = 0）に乗るよう各コマを持ち上げる
  for (let f = 1; f < frames.length; f++) {
    const fr = frames[f];
    let minZ = Infinity;
    for (let i = 0; i < n; i++) minZ = Math.min(minZ, fr[i * 3 + 2]);
    for (let i = 0; i < n; i++) fr[i * 3 + 2] -= minZ;
  }

  return { segments: seg, aspect, vertexCount: n, index, uvs, frames };
}

/**
 * 面積で重み付けした頂点法線を out へ書く。三角形の向きは PlaneGeometry と同じ
 * （平らなとき +z を向く）。
 */
export function computeNormals(
  positions: ArrayLike<number>,
  index: ArrayLike<number>,
  out: Float32Array,
): void {
  out.fill(0);
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3;
    const b = index[t + 1] * 3;
    const c = index[t + 2] * 3;
    const e1x = positions[b] - positions[a];
    const e1y = positions[b + 1] - positions[a + 1];
    const e1z = positions[b + 2] - positions[a + 2];
    const e2x = positions[c] - positions[a];
    const e2y = positions[c + 1] - positions[a + 1];
    const e2z = positions[c + 2] - positions[a + 2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) {
      out[v] += nx;
      out[v + 1] += ny;
      out[v + 2] += nz;
    }
  }
  for (let i = 0; i < out.length; i += 3) {
    const l = Math.hypot(out[i], out[i + 1], out[i + 2]) || 1;
    out[i] /= l;
    out[i + 1] /= l;
    out[i + 2] /= l;
  }
}
