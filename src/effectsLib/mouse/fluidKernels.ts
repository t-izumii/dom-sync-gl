/**
 * WebGPU コンピュートシェーダー版 Navier-Stokes 流体の TSL カーネル群。
 *
 * `splashCursor/fluidSim.ts`（fragment + ping-pong RenderTarget 版）の数式を
 * そのまま compute へ移した実装。1フレーム分のディスパッチを事前構築した
 * 静的チェーンとして 1 回の compute パスに流し込むため、各ファクトリは
 * 「入出力の StorageTexture と uniform を固定した ComputeNode」を返す。
 *
 * Why not fragment 版の流用: RenderTarget の付け替えと swap のたびに JS が
 * 介入する必要があり、1フレームで 30 回近いレンダーパスが開く。compute なら
 * 入出力を静的に固定できるので単一パスにまとめられる。
 *
 * Why 解像度をシェーダー定数に焼き込むか: グリッドサイズが変わると
 * ディスパッチ数も変わり、どのみち ComputeNode の再構築が要る。uniform に
 * 逃がしても再構築は避けられないので、定数畳み込みが効く側を選んでいる。
 *
 * @see src/effectsLib/splashCursor/fluidSim.ts 移植元の数式（L114-190）
 */

import type { ComputeNode, StorageTexture, TextureNode, UniformNode } from 'three/webgpu';
import {
  Fn,
  If,
  Loop,
  Return,
  abs,
  clamp,
  computeKernel,
  dot,
  exp,
  float,
  globalId,
  int,
  length,
  select,
  texture,
  textureStore,
  uint,
  uniformArray,
  uvec2,
  vec2,
  vec4,
} from 'three/tsl';
import type { Node } from 'three/webgpu';

/* ==----------------------------------------------------
 * Y 軸の向きに依存する符号
 * ---------------------------------------------------- */

/**
 * compute 版は `globalId.y = 0` を画面上端（UV v = 0）に統一している。
 * 移植元の `fluidSim.ts` は plane geometry の UV（左下原点）で書かれていて
 * v の向きが逆なので、向きに依存する量はこの 2 定数だけに集約してある。
 * 実機で渦の巻き方向・押し出し方向が splashCursor と逆に見えたら、
 * ここを反転すれば足りる。
 */
export const VORTICITY_FORCE_Y_SIGN = -1;

/** splat 速度の y 成分の符号。上と同じ理由でここに集約している。 */
export const SPLAT_VELOCITY_Y_SIGN = 1;

/* ==----------------------------------------------------
 * 共通ヘルパー
 * ---------------------------------------------------- */

/** 2D グリッド 1 ワークグループあたりの invocation 配置。 */
const WORKGROUP_SIZE = [8, 8];

export interface FluidGrid {
  width: number;
  height: number;
}

export type FluidUniformArray = ReturnType<typeof uniformArray>;

/** ワークグループ数。`ComputeNode.setCount()` には invocation 数ではなくこれを渡す。 */
const dispatchCount = (grid: FluidGrid): number[] => [
  Math.ceil(grid.width / WORKGROUP_SIZE[0]),
  Math.ceil(grid.height / WORKGROUP_SIZE[1]),
  1,
];

/**
 * 整数テクセル座標 → そのテクセル中心の UV。
 *
 * Why +0.5: fragment の `uv()` は既にピクセル中心を指しているが、compute の
 * `globalId` はテクセル左上角相当。忘れると全体が半テクセルずれ、移流が
 * 毎フレーム片側へドリフトする。
 */
const texelCenter = (grid: FluidGrid, ix: Node, iy: Node): Node =>
  vec2(float(ix).add(0.5).div(grid.width), float(iy).add(0.5).div(grid.height));

/**
 * 整数テクセル座標での近傍タップ。
 *
 * Why clamp: fragment 版は範囲外 UV を ClampToEdgeWrapping に暗黙依存して
 * いたが、compute で unfilterable 判定に落ちると `textureLoad` になり範囲外は
 * 0 を返す。縁が黒く抜けて渦が壊れるので明示的に折り返す。
 */
const tap = (source: TextureNode, grid: FluidGrid, ix: Node, iy: Node): Node =>
  source.sample(
    texelCenter(
      grid,
      clamp(ix, int(0), int(grid.width - 1)),
      clamp(iy, int(0), int(grid.height - 1)),
    ),
  );

interface KernelCoords {
  /** 整数テクセル座標（int） */
  ix: Node;
  iy: Node;
  /** テクセル中心の UV */
  vUv: Node;
}

/**
 * 全カーネル共通のラッパー。境界ガードと `textureStore` をここに閉じ込める。
 *
 * Why 早期 return が必須か: dye 解像度は 8 の倍数とは限らず（1440×810 等）、
 * 末端ワークグループがグリッド外まではみ出す。
 */
const makeKernel = (
  name: string,
  grid: FluidGrid,
  target: StorageTexture,
  body: (coords: KernelCoords) => Node,
): ComputeNode => {
  const shader = Fn(() => {
    const gx = globalId.x;
    const gy = globalId.y;

    If(
      gx.greaterThanEqual(uint(grid.width)).or(gy.greaterThanEqual(uint(grid.height))),
      () => {
        Return();
      },
    );

    const ix = int(gx);
    const iy = int(gy);

    textureStore(
      target,
      uvec2(gx, gy),
      body({ ix, iy, vUv: texelCenter(grid, ix, iy) }),
    );
  });

  return computeKernel(shader(), WORKGROUP_SIZE)
    .setName(name)
    .setCount(dispatchCount(grid));
};

/* ==----------------------------------------------------
 * 初期化
 * ---------------------------------------------------- */

/**
 * StorageTexture の初期内容は未定義。NaN が混じると 1 フレームで全体が
 * 発散するため、確保直後に必ず 1 回流す。
 */
export const clearKernel = (target: StorageTexture, grid: FluidGrid): ComputeNode =>
  makeKernel('fluidClear', grid, target, () => vec4(0));

/* ==----------------------------------------------------
 * splat（マウス入力の注入）
 * ---------------------------------------------------- */

export interface SplatKernelParams {
  target: StorageTexture;
  source: StorageTexture;
  grid: FluidGrid;
  /** 1 フレームに合成できる splat の最大数。ループ回数として焼き込まれる */
  maxSplats: number;
  /** 実際に積まれた splat 数（int） */
  uSplatCount: UniformNode<number>;
  /** drawing buffer のアスペクト比。splat を真円に保つ */
  uAspect: UniformNode<number>;
  /** vec4(x, y, radius, -) */
  points: FluidUniformArray;
  /** vec4(注入量 rgb, -)。velocity なら (dx, dy, 0)、dye ならインク色 */
  amounts: FluidUniformArray;
  name: string;
}

/**
 * splat を「毎フレーム固定 1 ディスパッチ」に畳み込むカーネル。
 *
 * Why not 1 点 1 ディスパッチ: 点数が可変だと ping-pong のパリティが
 * フレームごとに変わり、静的チェーンが組めなくなる。固定長の uniform 配列に
 * 積んで 1 パスで合成すれば、点数 0 のフレームは実質コピーになるだけで
 * バッファの入れ替わり方が常に一定になる。
 */
export const splatKernel = (p: SplatKernelParams): ComputeNode => {
  const source = texture(p.source);

  return makeKernel(p.name, p.grid, p.target, ({ ix, iy, vUv }) => {
    const accumulated = tap(source, p.grid, ix, iy).xyz.toVar();

    Loop(p.maxSplats, ({ i }) => {
      If(i.lessThan(p.uSplatCount), () => {
        const point = p.points.element(i);
        const offset = vUv.sub(point.xy);
        const scaled = vec2(offset.x.mul(p.uAspect), offset.y);
        const falloff = exp(dot(scaled, scaled).negate().div(point.z));

        accumulated.addAssign(falloff.mul(p.amounts.element(i).xyz));
      });
    });

    return vec4(accumulated, 1.0);
  });
};

/* ==----------------------------------------------------
 * 渦度（curl / vorticity confinement）
 * ---------------------------------------------------- */

export interface CurlKernelParams {
  target: StorageTexture;
  velocity: StorageTexture;
  grid: FluidGrid;
}

export const curlKernel = (p: CurlKernelParams): ComputeNode => {
  const velocity = texture(p.velocity);

  return makeKernel('fluidCurl', p.grid, p.target, ({ ix, iy }) => {
    const L = tap(velocity, p.grid, ix.sub(1), iy).y;
    const R = tap(velocity, p.grid, ix.add(1), iy).y;
    const T = tap(velocity, p.grid, ix, iy.add(1)).x;
    const B = tap(velocity, p.grid, ix, iy.sub(1)).x;

    return vec4(R.sub(L).sub(T).add(B).mul(0.5), 0.0, 0.0, 1.0);
  });
};

export interface VorticityKernelParams {
  target: StorageTexture;
  velocity: StorageTexture;
  curl: StorageTexture;
  grid: FluidGrid;
  uCurl: UniformNode<number>;
  uDt: UniformNode<number>;
}

export const vorticityKernel = (p: VorticityKernelParams): ComputeNode => {
  const velocity = texture(p.velocity);
  const curl = texture(p.curl);

  return makeKernel('fluidVorticity', p.grid, p.target, ({ ix, iy }) => {
    const L = tap(curl, p.grid, ix.sub(1), iy).x;
    const R = tap(curl, p.grid, ix.add(1), iy).x;
    const T = tap(curl, p.grid, ix, iy.add(1)).x;
    const B = tap(curl, p.grid, ix, iy.sub(1)).x;
    const C = tap(curl, p.grid, ix, iy).x;

    const direction = vec2(abs(T).sub(abs(B)), abs(R).sub(abs(L))).mul(0.5);
    const normalized = direction.div(length(direction).add(0.0001));
    const force = normalized
      .mul(p.uCurl)
      .mul(C)
      .mul(vec2(1.0, VORTICITY_FORCE_Y_SIGN));

    const advanced = tap(velocity, p.grid, ix, iy).xy.add(force.mul(p.uDt));

    return vec4(clamp(advanced, vec2(-1000.0), vec2(1000.0)), 0.0, 1.0);
  });
};

/* ==----------------------------------------------------
 * 圧力投影
 * ---------------------------------------------------- */

export interface DivergenceKernelParams {
  target: StorageTexture;
  velocity: StorageTexture;
  grid: FluidGrid;
}

/**
 * Why 整数比較で境界を判定するか: 移植元は `vL.x < 0.0` のように UV で
 * 境界を検出していたが、compute では近傍座標を先に clamp するので UV からは
 * 境界情報が失われる。テクセル座標そのもので比較する。
 */
export const divergenceKernel = (p: DivergenceKernelParams): ComputeNode => {
  const velocity = texture(p.velocity);

  return makeKernel('fluidDivergence', p.grid, p.target, ({ ix, iy }) => {
    const C = tap(velocity, p.grid, ix, iy).xy;

    const L = select(
      ix.lessThan(int(1)),
      C.x.negate(),
      tap(velocity, p.grid, ix.sub(1), iy).x,
    );
    const R = select(
      ix.greaterThan(int(p.grid.width - 2)),
      C.x.negate(),
      tap(velocity, p.grid, ix.add(1), iy).x,
    );
    const T = select(
      iy.greaterThan(int(p.grid.height - 2)),
      C.y.negate(),
      tap(velocity, p.grid, ix, iy.add(1)).y,
    );
    const B = select(
      iy.lessThan(int(1)),
      C.y.negate(),
      tap(velocity, p.grid, ix, iy.sub(1)).y,
    );

    return vec4(R.sub(L).add(T).sub(B).mul(0.5), 0.0, 0.0, 1.0);
  });
};

export interface PressureClearKernelParams {
  target: StorageTexture;
  pressure: StorageTexture;
  grid: FluidGrid;
  uPressure: UniformNode<number>;
}

/** 前フレームの圧力場を減衰させて Jacobi 反復の初期値にする。 */
export const pressureClearKernel = (p: PressureClearKernelParams): ComputeNode => {
  const pressure = texture(p.pressure);

  return makeKernel('fluidPressureClear', p.grid, p.target, ({ ix, iy }) =>
    tap(pressure, p.grid, ix, iy).mul(p.uPressure),
  );
};

export interface PressureJacobiKernelParams {
  target: StorageTexture;
  pressure: StorageTexture;
  divergence: StorageTexture;
  grid: FluidGrid;
  name: string;
}

export const pressureJacobiKernel = (p: PressureJacobiKernelParams): ComputeNode => {
  const pressure = texture(p.pressure);
  const divergence = texture(p.divergence);

  return makeKernel(p.name, p.grid, p.target, ({ ix, iy }) => {
    const L = tap(pressure, p.grid, ix.sub(1), iy).x;
    const R = tap(pressure, p.grid, ix.add(1), iy).x;
    const T = tap(pressure, p.grid, ix, iy.add(1)).x;
    const B = tap(pressure, p.grid, ix, iy.sub(1)).x;
    const div = tap(divergence, p.grid, ix, iy).x;

    return vec4(L.add(R).add(B).add(T).sub(div).mul(0.25), 0.0, 0.0, 1.0);
  });
};

export interface GradientSubtractKernelParams {
  target: StorageTexture;
  pressure: StorageTexture;
  velocity: StorageTexture;
  grid: FluidGrid;
}

export const gradientSubtractKernel = (p: GradientSubtractKernelParams): ComputeNode => {
  const pressure = texture(p.pressure);
  const velocity = texture(p.velocity);

  return makeKernel('fluidGradientSubtract', p.grid, p.target, ({ ix, iy }) => {
    const L = tap(pressure, p.grid, ix.sub(1), iy).x;
    const R = tap(pressure, p.grid, ix.add(1), iy).x;
    const T = tap(pressure, p.grid, ix, iy.add(1)).x;
    const B = tap(pressure, p.grid, ix, iy.sub(1)).x;

    const projected = tap(velocity, p.grid, ix, iy).xy.sub(vec2(R.sub(L), T.sub(B)));

    return vec4(projected, 0.0, 1.0);
  });
};

/* ==----------------------------------------------------
 * 移流
 * ---------------------------------------------------- */

export interface AdvectionKernelParams {
  target: StorageTexture;
  /** 移流させる場。velocity の自己移流では `velocity` と同一を渡す */
  source: StorageTexture;
  velocity: StorageTexture;
  /** 出力グリッド。dye は sim と解像度が異なる */
  grid: FluidGrid;
  /**
   * 速度 → UV 変位の換算に使うテクセルサイズ。dye 移流でも sim 側の値を
   * 使う（移植元 `uTexelSize` が simResolution 固定なのと同じ）
   */
  motionTexel: { x: number; y: number };
  uDt: UniformNode<number>;
  uDissipation: UniformNode<number>;
  name: string;
}

/**
 * セミラグランジュ移流。バイリニア補間が必須なので、読み側は必ず
 * `texture().sample()`（`textureSampleLevel`）を通す。
 */
export const advectionKernel = (p: AdvectionKernelParams): ComputeNode => {
  const velocity = texture(p.velocity);
  /* 自己移流ではテクスチャが同一。バインドを重複させない */
  const source = p.source === p.velocity ? velocity : texture(p.source);

  return makeKernel(p.name, p.grid, p.target, ({ vUv }) => {
    const decay = p.uDissipation.mul(p.uDt).add(1.0);
    const traced = vUv.sub(
      velocity
        .sample(vUv)
        .xy.mul(vec2(p.motionTexel.x, p.motionTexel.y))
        .mul(p.uDt),
    );

    return source.sample(traced).div(decay);
  });
};
