import * as THREE from 'three/webgpu';
import type { UniformNode } from 'three/webgpu';
import { clamp, floor, max, mix, texture, uniform, vec4 } from 'three/tsl';
import type GUI from 'lil-gui';
import { BaseEffect, type BaseEffectConfig } from '../../index';
import { TrailTexture } from './TrailTexture';

export interface PixelTrailEffectOptions {
  gridSize?: number;
  trailSize?: number;
  maxAge?: number;
  interpolate?: number;
  color?: string;
  textureSize?: number;
}
export class PixelTrailEffect extends BaseEffect {
  public gridSize: number;
  public readonly color: THREE.Color;

  private readonly trail: TrailTexture;
  private readonly _resolution = new THREE.Vector2(1, 1);
  private readonly _coverScale = new THREE.Vector2(1, 1);
  private readonly uGridSize: UniformNode<number>;
  private readonly uColor: UniformNode<THREE.Color>;
  private readonly uResolution: UniformNode<THREE.Vector2>;

  private _lastTime = 0;
  private _hasLastTime = false;
  private readonly _touchUv = new THREE.Vector2();
  private readonly _maxDelta = 0.25;

  constructor(options: PixelTrailEffectOptions = {}) {
    super();
    this.gridSize = options.gridSize ?? 40;
    this.color = new THREE.Color(options.color ?? '#ffffff');

    this.uGridSize = uniform(this.gridSize);
    this.uColor = uniform(this.color);
    this.uResolution = uniform(this._resolution);

    this.trail = new TrailTexture({
      size: options.textureSize ?? 512,
      radius: options.trailSize ?? 0.1,
      maxAge: options.maxAge ?? 250,
      interpolate: options.interpolate ?? 5,
      smoothing: 0,
      ease: (x) => x,
    });
    this.trail.texture.minFilter = THREE.NearestFilter;
    this.trail.texture.magFilter = THREE.NearestFilter;
    this.trail.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.trail.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.trail.texture.generateMipmaps = false;
  }

  get trailSize(): number {
    return this.trail.radius;
  }
  set trailSize(value: number) {
    this.trail.radius = value;
  }

  get maxAge(): number {
    return this.trail.maxAge;
  }
  set maxAge(value: number) {
    this.trail.maxAge = value;
  }

  get interpolate(): number {
    return this.trail.interpolate;
  }
  set interpolate(value: number) {
    this.trail.interpolate = value;
  }

  protected getConfig(): BaseEffectConfig {
    const tTrail = texture(this.trail.texture);

    return {
      outputNode: ({ inputTexture, uv }) => {
        const s = this.uResolution.div(
          max(this.uResolution.x, this.uResolution.y),
        );
        const coverUv = clamp(uv.sub(0.5).mul(s).add(0.5), 0.0, 1.0);

        const cellCenter = floor(coverUv.mul(this.uGridSize))
          .add(0.5)
          .div(this.uGridSize);
        const trail = tTrail.sample(cellCenter).r;
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

    const dt = this._hasLastTime ? Math.min(Math.max(time - this._lastTime, 0), 1 / 30) : 0;
    this._lastTime = time;
    this._hasLastTime = true;

    const delta = mouse
      ? this.uMouse.value.distanceTo(this.mouseMotion.prev)
      : 0;
    if (delta > 1e-6) {
      this._touchUv
        .copy(this.uMouse.value)
        .subScalar(0.5)
        .multiply(this._coverScale)
        .addScalar(0.5);

      if (delta > this._maxDelta) {
        const prevInterpolate = this.trail.interpolate;
        this.trail.interpolate = 0;
        this.trail.addTouch(this._touchUv);
        this.trail.interpolate = prevInterpolate;
      } else {
        this.trail.addTouch(this._touchUv);
      }
    }

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
