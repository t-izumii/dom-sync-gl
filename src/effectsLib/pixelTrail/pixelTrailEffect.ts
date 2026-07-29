import * as THREE from 'three/webgpu';
import type { UniformNode } from 'three/webgpu';
import { clamp, floor, max, mix, texture, uniform, vec4 } from 'three/tsl';
import type GUI from 'lil-gui';
import { BaseEffect, type BaseEffectConfig } from '../../index';
import { TrailTexture } from './TrailTexture';

export interface PixelTrailEffectOptions {
  /** グリッドの分割数（短辺基準）。大きいほどセルが細かい。 */
  gridSize?: number;
  /** トレイルの半径（トレイルテクスチャ一辺に対する比率）。 */
  trailSize?: number;
  /** 打点が消えるまでの時間（ms）。 */
  maxAge?: number;
  /** 高速移動時の補間打点の細かさ。0 で無効。 */
  interpolate?: number;
  /** 点灯セルの色。 */
  color?: string;
  /** トレイルテクスチャの一辺 px。 */
  textureSize?: number;
}

/**
 * ピクセルトレイル ポストエフェクト（React Bits "Pixel Trail" の移植）。
 *
 * マウス軌跡を {@link TrailTexture}（CPU Canvas 2D）に減衰付きで蓄積し、
 * 画面をグリッドに量子化してセル中心でサンプル、通ったセルをドット状に点灯させる。
 */
export class PixelTrailEffect extends BaseEffect {
  /** グリッドの分割数。 */
  public gridSize: number;
  /** 点灯セルの色（lil-gui addColor 対応）。 */
  public readonly color: THREE.Color;

  private readonly trail: TrailTexture;
  private readonly _resolution = new THREE.Vector2(1, 1);
  private readonly _coverScale = new THREE.Vector2(1, 1);

  // uniform ノードは生成時に作り、outputNode と uniforms（setUniform の参照先）の
  // 両方から同じノードを共有する。uColor / uResolution は THREE オブジェクトを
  // そのまま value に持つため、in-place の変更（lil-gui / resize）がそのまま反映される。
  private readonly uGridSize: UniformNode<number>;
  private readonly uColor: UniformNode<THREE.Color>;
  private readonly uResolution: UniformNode<THREE.Vector2>;

  private _lastTime = 0;
  private _hasLastTime = false;
  private readonly _prevMouse = new THREE.Vector2(0.5, 0.5);
  private _hasPrevMouse = false;
  private readonly _touchUv = new THREE.Vector2();
  // 1 フレームの移動量がこれ（UV 距離）を超えたらテレポートとみなし、
  // 補間打点を切って軌跡が画面を横切るストリークを防ぐ。
  private readonly _maxDelta = 0.25;

  constructor(options: PixelTrailEffectOptions = {}) {
    super();
    this.gridSize = options.gridSize ?? 40;
    this.color = new THREE.Color(options.color ?? '#ffffff');

    this.uGridSize = uniform(this.gridSize);
    this.uColor = uniform(this.color);
    this.uResolution = uniform(this._resolution);

    // 本家 PixelTrail の useTrailTexture 設定と同値
    this.trail = new TrailTexture({
      size: options.textureSize ?? 512,
      radius: options.trailSize ?? 0.1,
      maxAge: options.maxAge ?? 250,
      interpolate: options.interpolate ?? 5,
      smoothing: 0,
      ease: (x) => x,
    });
    // 本家はトレイルテクスチャを Nearest / ClampToEdge でサンプルする
    this.trail.texture.minFilter = THREE.NearestFilter;
    this.trail.texture.magFilter = THREE.NearestFilter;
    this.trail.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.trail.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.trail.texture.generateMipmaps = false;
  }

  /** トレイルの半径（GUI 用アクセサ）。 */
  get trailSize(): number {
    return this.trail.radius;
  }
  set trailSize(value: number) {
    this.trail.radius = value;
  }

  /** 残存時間 ms（GUI 用アクセサ）。 */
  get maxAge(): number {
    return this.trail.maxAge;
  }
  set maxAge(value: number) {
    this.trail.maxAge = value;
  }

  /** 補間打点の細かさ（GUI 用アクセサ）。 */
  get interpolate(): number {
    return this.trail.interpolate;
  }
  set interpolate(value: number) {
    this.trail.interpolate = value;
  }

  protected getConfig(): BaseEffectConfig {
    // トレイルテクスチャは CanvasTexture を差し替えずに needsUpdate で更新する
    // ため、texture ノードは構築時に 1 度作って閉包で参照すればよい。
    const tTrail = texture(this.trail.texture);

    return {
      // ピクセルトレイルの描画パス。cover 補正した UV を uGridSize 個に量子化し、
      // セル中心で tTrail をサンプルしてセル単位で点灯させる（セル内グラデは出ない）。
      outputNode: ({ inputTexture, uv }) => {
        // 画面 UV → cover 補正 UV（短辺基準で正方格子を保つ。本家 coverUv と同じ）
        const s = this.uResolution.div(
          max(this.uResolution.x, this.uResolution.y),
        );
        const coverUv = clamp(uv.sub(0.5).mul(s).add(0.5), 0.0, 1.0);

        const cellCenter = floor(coverUv.mul(this.uGridSize))
          .add(0.5)
          .div(this.uGridSize);
        const trail = tTrail.sample(cellCenter).r;

        // 本家は vec4(pixelColor, trail) をページ背景にアルファ合成。
        // 本プロジェクトは前パス結果 inputTexture に自前合成する（EffectComposer の流儀）。
        return vec4(
          mix(inputTexture.rgb, this.uColor, clamp(trail, 0.0, 1.0)),
          inputTexture.a,
        );
      },
      uniforms: {
        uGridSize: this.uGridSize,
        uColor: this.uColor,
        uResolution: this.uResolution,
      },
    };
  }

  update(time: number, mouse?: THREE.Vector2): void {
    if (!this.pass) return;

    // time は経過秒。delta は自前計算（初回フレームは 0 扱い、スパイクは 1/30 に丸め）
    const dt = this._hasLastTime ? Math.min(Math.max(time - this._lastTime, 0), 1 / 30) : 0;
    this._lastTime = time;
    this._hasLastTime = true;

    const m = mouse ?? this._prevMouse;
    if (this._hasPrevMouse) {
      const delta = m.distanceTo(this._prevMouse);
      if (delta > 1e-6) {
        // 本家はマウスを cover 補正されたメッシュ UV で記録する。
        // ビューポート UV → cover UV に変換してから打点する（シェーダー側の
        // coverUv サンプルと座標系を一致させる）。
        this._touchUv
          .copy(m)
          .subScalar(0.5)
          .multiply(this._coverScale)
          .addScalar(0.5);

        if (delta > this._maxDelta) {
          // テレポート（初期位置からのワープ・画面外からの再侵入）は補間を
          // 切って 1 点だけ打つ
          const prevInterpolate = this.trail.interpolate;
          this.trail.interpolate = 0;
          this.trail.addTouch(this._touchUv);
          this.trail.interpolate = prevInterpolate;
        } else {
          this.trail.addTouch(this._touchUv);
        }
      }
    }
    this._prevMouse.copy(m);
    this._hasPrevMouse = true;

    this.trail.update(dt);

    this.setUniform('uGridSize', this.gridSize);
  }

  resize(width: number, height: number): void {
    this._resolution.set(width, height);
    const max = Math.max(width, height) || 1;
    this._coverScale.set(width / max, height / max);
    this.setUniform('uResolution', this._resolution);
  }

  setupGUI(gui: GUI): GUI {
    const folder = gui.addFolder('ピクセルトレイル (Pixel trail)');
    folder.add(this, 'enabled').name('有効');
    folder.add(this, 'gridSize', 8, 100, 1).name('グリッド数');
    folder.add(this, 'trailSize', 0.02, 0.5, 0.005).name('トレイル半径');
    folder.add(this, 'maxAge', 100, 2000, 10).name('残存時間 (ms)');
    folder.add(this, 'interpolate', 0, 10, 1).name('補間打点');
    folder.addColor(this, 'color').name('色');
    return folder;
  }

  dispose(): void {
    this.trail.dispose();
    this.pass = null;
  }
}
