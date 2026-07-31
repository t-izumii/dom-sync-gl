import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import type { UniformNode } from 'three/webgpu';
import type GUI from 'lil-gui';
import { BaseEffect, type BaseEffectConfig } from '../../index';
import { ditherDisplayNode, ditherSimNode } from './ditherCursorNodes';

export interface DitherCursorEffectOptions {
  ditherSize?: number;
  radius?: number;
  exponent?: number;
  decay?: number;
  intensity?: number;
  color?: string;
}

export class DitherCursorEffect extends BaseEffect {
  public ditherSize: number;
  public radius: number;
  public exponent: number;
  public decay: number;
  public intensity: number;
  public readonly color: THREE.Color;

  private readonly uSpeed = uniform(0);
  private readonly uRadius: UniformNode<number>;
  private readonly uDecay: UniformNode<number>;
  private readonly uIntensity: UniformNode<number>;
  private readonly uDitherSize: UniformNode<number>;
  private readonly uExponent: UniformNode<number>;
  private readonly uColor: UniformNode<THREE.Color>;

  private readonly _prevMouse = new THREE.Vector2(0.5, 0.5);
  private _hasPrevMouse = false;
  private _speed = 0;
  private readonly _maxDelta = 0.25;

  constructor(options: DitherCursorEffectOptions = {}) {
    super();
    this.ditherSize = options.ditherSize ?? 4;
    this.radius = options.radius ?? 0.1;
    this.exponent = options.exponent ?? 2.0;
    this.decay = options.decay ?? 0.01;
    this.intensity = options.intensity ?? 0.5;
    this.color = new THREE.Color().setStyle(
      options.color ?? '#FF9FFC',
      THREE.NoColorSpace,
    );

    this.uRadius = uniform(this.radius);
    this.uDecay = uniform(this.decay);
    this.uIntensity = uniform(this.intensity);
    this.uDitherSize = uniform(this.ditherSize);
    this.uExponent = uniform(this.exponent);
    this.uColor = uniform(this.color.clone().convertSRGBToLinear());
  }

  protected getConfig(): BaseEffectConfig {
    return {
      feedback: {
        node: ({ prev, uv }) =>
          ditherSimNode({
            uPrev: prev,
            uv,
            uTime: this.uTime,
            uMouse: this.uMouse,
            uSpeed: this.uSpeed,
            uRadius: this.uRadius,
            uDecay: this.uDecay,
            uIntensity: this.uIntensity,
          }),
        size: 'screen',
        type: THREE.HalfFloatType,
        filter: THREE.NearestFilter,
      },
      outputNode: (ctx) =>
        ditherDisplayNode(ctx, {
          tSimulation: this.feedbackTexture,
          uDitherSize: this.uDitherSize,
          uExponent: this.uExponent,
          uColor: this.uColor,
        }),
      uniforms: {
        uDitherSize: this.uDitherSize,
        uExponent: this.uExponent,
        uColor: this.uColor as UniformNode<unknown>,
      },
    };
  }

  update(_time: number, mouse?: THREE.Vector2): void {
    const m = mouse ?? this._prevMouse;
    let delta = this._hasPrevMouse ? m.distanceTo(this._prevMouse) : 0;
    if (delta > this._maxDelta) delta = 0;
    this._speed += (delta - this._speed) * 0.1;
    this._prevMouse.copy(m);
    this._hasPrevMouse = true;

    if (!this.pass) return;

    this.uSpeed.value = this._speed;
    this.uRadius.value = this.radius;
    this.uDecay.value = this.decay;
    this.uIntensity.value = this.intensity;

    this.setUniform('uDitherSize', this.ditherSize);
    this.setUniform('uExponent', this.exponent);
    this.uColor.value.copy(this.color).convertSRGBToLinear();
  }

  setupGUI(gui: GUI): GUI {
    const folder = gui.addFolder('ディザカーソル (Dither cursor)');
    folder.add(this, 'enabled').name('有効');
    folder.add(this, 'ditherSize', 1, 16, 1).name('ドットサイズ (px)');
    folder.add(this, 'radius', 0.02, 0.4, 0.005).name('半径');
    folder.add(this, 'exponent', 0.5, 8, 0.1).name('減衰カーブ (exponent)');
    folder.add(this, 'decay', 0.001, 0.05, 0.001).name('減衰速度 (decay)');
    folder.add(this, 'intensity', 0.05, 1, 0.01).name('ブラシの濃さ');
    folder.addColor(this, 'color').name('色');
    return folder;
  }

  dispose(): void {
    this.pass = null;
  }
}
