import * as THREE from 'three/webgpu';
import { uniform, uniformArray } from 'three/tsl';
import type { UniformNode } from 'three/webgpu';
import type GUI from 'lil-gui';
import { BaseEffect, type BaseEffectConfig } from '../../index';
import { smoothCursorNode } from './smoothCursorNode';

/** uniform 配列の固定長（uPoints の uniformArray 長と一致させる）。 */
const MAX_POINTS = 64;

export interface SmoothCursorEffectOptions {
  /** ばね連鎖の点数 = トレイルの長さ（2〜64）。 */
  pointsCount?: number;
  /** ばね定数。先頭の点だけ 0.4 倍に弱められる（本家仕様）。 */
  springStrength?: number;
  /**
   * 速度保持率（0.1〜0.99）。毎フレーム `v *= dampening`。
   * 名前に反して「大きいほど揺れが長く残る」ことに注意（本家仕様）。
   */
  dampening?: number;
  /** ポリラインの折れを均すスムーズ係数（0 = 折れ線そのまま、1 = 最も滑らか）。 */
  smoothFactor?: number;
  /** 太さの係数 px。実際の線幅は `lineWidth * (pointsCount - i)`。 */
  lineWidth?: number;
  /** 発光の広がり（ストローク半幅に対する倍率）。本家の CSS blur 相当。 */
  glow?: number;
  /** 速度 → 太さの倍率。0 で無効（本家 velocityScale 相当）。 */
  velocityScale?: number;
  /** トレイル全体の不透明度。 */
  trailOpacity?: number;
  /** トレイルの色。 */
  color?: string;
  /** 静止からフェードアウト開始までの秒数。 */
  idleFadeDelay?: number;
}

/**
 * スムーズカーソル ポストエフェクト（React Bits Pro "Smooth Cursor" の移植）。
 *
 * 「各点が 1 つ前の点をばねで追いかける」連鎖を CPU で更新し（先頭のみマウスを
 * 追い、ばね定数 0.4 倍で意図的に鈍化）、点列を `uPoints`（vec4 配列）として
 * シェーダーへ渡して SDF ポリライン帯として描画する。本家は Canvas 2D の
 * 可変 lineWidth stroke だが、本移植は完全シェーダー実装。
 */
export class SmoothCursorEffect extends BaseEffect {
  /** ばね連鎖の点数。 */
  public pointsCount: number;
  /** ばね定数。 */
  public springStrength: number;
  /** 速度保持率（大きいほど揺れが残る）。 */
  public dampening: number;
  /** ポリラインのスムーズ係数。 */
  public smoothFactor: number;
  /** 太さの係数 px。 */
  public lineWidth: number;
  /** 発光の広がり。 */
  public glow: number;
  /** 速度 → 太さの倍率。 */
  public velocityScale: number;
  /** トレイル全体の不透明度。 */
  public trailOpacity: number;
  /** トレイルの色（lil-gui addColor 対応）。 */
  public readonly color: THREE.Color;
  /** 合成モード（GUI 切替用）。 */
  public blendMode: 'screen' | 'add' = 'screen';

  // ばね連鎖の状態（UV 座標・y 上向き）。常に MAX_POINTS 全点を更新するので
  // GUI で pointsCount を増やしても尾側の点が未初期化にならない。
  private readonly _px = new Float32Array(MAX_POINTS);
  private readonly _py = new Float32Array(MAX_POINTS);
  private readonly _vx = new Float32Array(MAX_POINTS);
  private readonly _vy = new Float32Array(MAX_POINTS);

  private readonly _pointsUniform: THREE.Vector4[] = Array.from(
    { length: MAX_POINTS },
    () => new THREE.Vector4(0.5, 0.5, 0, 0),
  );

  // TSL の uniform ノード。ノードグラフは register 時に一度だけ組まれるため、
  // 以後の毎フレーム更新は各ノードの .value 差し替えのみで行う。uPoints は
  // uniformArray が保持する Vector4 参照を毎レンダーで転送するので、
  // _pointsUniform への書き込みがそのまま GPU へ反映される（旧 IUniform と同じ）。
  private readonly _uPoints = uniformArray(this._pointsUniform, 'vec4');
  private readonly _uCount = uniform(2, 'int');
  private readonly _uColor: UniformNode<THREE.Color>;
  private readonly _uGlow = uniform(1);
  private readonly _uAspect = uniform(1);
  private readonly _uBlendMode = uniform(0, 'int');

  private _lastTime = 0;
  private _hasLastTime = false;
  private readonly _prevMouse = new THREE.Vector2();
  private _hasPrevMouse = false;

  // mouseenter/leave 相当の存在感フェード。マウスが動かない時間が続いたら
  // presence を lerp で 0 へ、動き出したら 1 へ戻す（本家は document の
  // mouseenter/leave だが、EffectManager からは移動量しか分からないため
  // アイドル時間で代替する）。
  private _presence = 0;
  private _idleTime = Infinity;
  private readonly _idleFadeDelay: number;

  private _height = 1;
  private _aspect = 1;

  // 1 フレームの移動量がこれ（UV 距離）を超えたらテレポートとみなし、
  // 全点をマウス位置へリセットして帯が画面を横切るのを防ぐ。
  private readonly _maxDelta = 0.2;

  constructor(options: SmoothCursorEffectOptions = {}) {
    super();
    this.pointsCount = options.pointsCount ?? 40;
    this.springStrength = options.springStrength ?? 0.4;
    this.dampening = options.dampening ?? 0.5;
    this.smoothFactor = options.smoothFactor ?? 1;
    this.lineWidth = options.lineWidth ?? 0.3;
    this.glow = options.glow ?? 1;
    this.velocityScale = options.velocityScale ?? 1;
    this.trailOpacity = options.trailOpacity ?? 0.8;
    this.color = new THREE.Color(options.color ?? '#ffffff');
    this._idleFadeDelay = options.idleFadeDelay ?? 2;

    // color は lil-gui の addColor がインスタンスを直接書き換えるため、
    // 同じ Color オブジェクトを uniform ノードに共有させる（毎レンダー転送）。
    this._uColor = uniform(this.color);
    this._uCount.value = Math.min(Math.max(Math.round(this.pointsCount), 2), MAX_POINTS);
    this._uGlow.value = this.glow;

    this._px.fill(0.5);
    this._py.fill(0.5);
  }

  protected getConfig(): BaseEffectConfig {
    return {
      outputNode: (ctx) =>
        smoothCursorNode(ctx, {
          uPoints: this._uPoints,
          uCount: this._uCount,
          uColor: this._uColor,
          uGlow: this._uGlow,
          uAspect: this._uAspect,
          uBlendMode: this._uBlendMode,
        }),
      // uPoints は UniformNode ではなく uniformArray（BufferNode）なので
      // setUniform 経由ではなく _pointsUniform への直接書き込みで更新する。
      uniforms: {
        uCount: this._uCount,
        uColor: this._uColor,
        uGlow: this._uGlow,
        uAspect: this._uAspect,
        uBlendMode: this._uBlendMode,
      },
    };
  }

  update(time: number, mouse?: THREE.Vector2): void {
    if (!this.pass) return;

    // time は経過秒。delta は自前計算（初回フレームは 0 扱い、スパイクは 1/30 に丸め）
    const dt = this._hasLastTime ? Math.min(Math.max(time - this._lastTime, 0), 1 / 30) : 0;
    this._lastTime = time;
    this._hasLastTime = true;

    // 本家は rAF 毎（60fps 基準）の逐次更新なので、係数を「60fps 換算の
    // フレーム数」でスケールしてフレームレート差を吸収する。
    const f = Math.min(dt * 60, 2);

    const m = mouse ?? this._prevMouse;

    if (!this._hasPrevMouse) {
      // 初回はマウス位置に全点を畳んでおく（画面中央からのストリーク防止）
      this._resetPoints(m.x, m.y);
      this._prevMouse.copy(m);
      this._hasPrevMouse = true;
    }

    const delta = m.distanceTo(this._prevMouse);
    if (delta > this._maxDelta) {
      // テレポート（画面外からの再侵入など）は全点をマウス位置へリセット
      this._resetPoints(m.x, m.y);
    }

    // アイドル検出 → presence フェード（lerp 0.15/frame 相当）
    if (delta > 1e-5) this._idleTime = 0;
    else this._idleTime += dt;
    const presenceTarget = this._idleTime < this._idleFadeDelay ? 1 : 0;
    this._presence += (presenceTarget - this._presence) * (1 - Math.pow(0.85, f));

    this._prevMouse.copy(m);

    // ばね連鎖: 各点 i は 1 つ前の点 i-1 を目標にばね追従。
    // 先頭のみマウスを追い、ばね定数を 0.4 倍して鈍化（遅れが連鎖に伝播する）。
    const damp = Math.pow(
      Math.min(Math.max(this.dampening, 0.1), 0.99), // 本家と同じ 0.1〜0.99 クランプ
      f,
    );
    const px = this._px;
    const py = this._py;
    const vx = this._vx;
    const vy = this._vy;
    for (let i = 0; i < MAX_POINTS; i++) {
      const tx = i === 0 ? m.x : px[i - 1];
      const ty = i === 0 ? m.y : py[i - 1];
      const k = (i === 0 ? this.springStrength * 0.4 : this.springStrength) * f;
      vx[i] += (tx - px[i]) * k;
      vy[i] += (ty - py[i]) * k;
      vx[i] *= damp;
      vy[i] *= damp;
      // ばね強さ×減衰の組み合わせによっては連鎖が共振して数値発散する
      // （本家アルゴリズムも同様）。見た目の挙動を変えない大きさで速度を
      // キャップし、Infinity/NaN への暴走だけを防ぐ。
      const sp = Math.hypot(vx[i], vy[i]);
      if (sp > 2) {
        const s = 2 / sp;
        vx[i] *= s;
        vy[i] *= s;
      }
      px[i] += vx[i] * f;
      py[i] += vy[i] * f;
    }

    this._writeUniforms();

    this.setUniform('uCount', Math.min(Math.max(Math.round(this.pointsCount), 2), MAX_POINTS));
    this.setUniform('uGlow', this.glow);
    this.setUniform('uBlendMode', this.blendMode === 'add' ? 1 : 0);
  }

  /** ばね連鎖の点列を uPoints（xy = 位置, z = 半幅 UV, w = 強度）へ書き戻す。 */
  private _writeUniforms(): void {
    const count = Math.min(Math.max(Math.round(this.pointsCount), 2), MAX_POINTS);
    const alpha = this._presence * this.trailOpacity;
    const s = Math.min(Math.max(this.smoothFactor, 0), 1) * 0.5;

    for (let i = 0; i < count; i++) {
      // 本家の「制御点 = 現在点、終点 = 中点」quadraticCurveTo スムージングの
      // 近似として、描画点列に軽いラプラシアン平滑を掛けて折れを均す。
      let x = this._px[i];
      let y = this._py[i];
      if (i > 0 && i < count - 1) {
        x += ((this._px[i - 1] + this._px[i + 1]) * 0.5 - x) * s;
        y += ((this._py[i - 1] + this._py[i + 1]) * 0.5 - y) * s;
      }

      // 太さ: lineWidth * (pointsCount - i) の先頭太 → 尾細テーパー。
      // velocityScale 有効時は速い部分ほど太くなる（本家と同じ +min(0.5*|v|px, 2)）。
      let velFactor = 1;
      if (this.velocityScale > 0) {
        const speedPx = Math.hypot(this._vx[i], this._vy[i]) * this._height;
        velFactor = 1 + Math.min(0.5 * this.velocityScale * speedPx, 2);
      }
      const widthPx = this.lineWidth * (count - i) * velFactor;
      const halfWidthUv = (0.5 * widthPx) / this._height;

      this._pointsUniform[i].set(x, y, halfWidthUv, alpha);
    }
  }

  private _resetPoints(x: number, y: number): void {
    this._px.fill(x);
    this._py.fill(y);
    this._vx.fill(0);
    this._vy.fill(0);
  }

  resize(width: number, height: number): void {
    this._height = Math.max(height, 1);
    this._aspect = width / Math.max(height, 1);
    // register 前に resize が呼ばれても値が失われないよう、pass 経由の
    // setUniform ではなく保持している uniform ノードへ直接書き込む。
    this._uAspect.value = this._aspect;
  }

  setupGUI(gui: GUI): GUI {
    const folder = gui.addFolder('スムーズカーソル (Smooth cursor)');
    folder.add(this, 'enabled').name('有効');
    folder.add(this, 'pointsCount', 2, MAX_POINTS, 1).name('ポイント数');
    folder.add(this, 'springStrength', 0.05, 1, 0.01).name('ばね強さ');
    folder.add(this, 'dampening', 0.1, 0.99, 0.01).name('減衰（揺れ残り）');
    folder.add(this, 'smoothFactor', 0, 1, 0.01).name('スムーズ係数');
    folder.add(this, 'lineWidth', 0.05, 2, 0.01).name('線幅');
    folder.add(this, 'glow', 0, 4, 0.05).name('発光幅');
    folder.add(this, 'velocityScale', 0, 3, 0.05).name('速度→太さ');
    folder.add(this, 'trailOpacity', 0, 1, 0.01).name('不透明度');
    folder.addColor(this, 'color').name('色');
    folder.add(this, 'blendMode', ['screen', 'add']).name('合成モード');
    return folder;
  }

  dispose(): void {
    this.pass = null;
  }
}
