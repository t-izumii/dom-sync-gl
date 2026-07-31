import * as THREE from 'three/webgpu';
import {
  clamp,
  distance,
  float,
  length,
  select,
  smoothstep,
  uniform,
  vec2,
  vec4,
} from 'three/tsl';
import type { UniformNode } from 'three/webgpu';
import type GUI from 'lil-gui';
import { BaseEffect, type BaseEffectConfig } from '../../index';

export interface MouseFlowEffectOptions {
  size?: number;
  strength?: number;
  dissipation?: number;
  falloff?: number;
}

export class MouseFlowEffect extends BaseEffect {
  public strength: number;
  public dissipation: number;
  public falloff: number;

  public size: number;

  private readonly uDeltaMouse: UniformNode<THREE.Vector2>;
  private readonly uDissipation: UniformNode<number>;
  private readonly uFalloff: UniformNode<number>;
  private readonly uStrength: UniformNode<number>;

  private readonly _prevMouse = new THREE.Vector2(0.5, 0.5);
  private readonly _delta = new THREE.Vector2();
  private _hasPrevMouse = false;
  private readonly _maxDelta = 0.1;

  constructor(options: MouseFlowEffectOptions = {}) {
    super();
    this.size = Math.max(16, Math.floor(options.size ?? 64));
    this.strength = options.strength ?? 2.5;
    this.dissipation = options.dissipation ?? 0.8;
    this.falloff = options.falloff ?? 0.2;

    this.uDeltaMouse = uniform(new THREE.Vector2());
    this.uDissipation = uniform(this.dissipation);
    this.uFalloff = uniform(this.falloff);
    this.uStrength = uniform(this.strength);
  }

  protected getConfig(): BaseEffectConfig {
    return {
      outputNode: ({ inputTexture, uv }) => {
        const flow = this.feedbackTexture.rg.mul(2.0).sub(1.0);
        const shifted = uv.sub(flow.mul(this.uStrength));
        return inputTexture.sample(clamp(shifted, 0.0, 1.0));
      },
      uniforms: {
        uStrength: this.uStrength,
      },
      feedback: {
        node: ({ prev, uv }) => {
          const prevFlow = prev.rg.mul(2.0).sub(1.0).mul(prev.a);

          const deltaLength = length(this.uDeltaMouse).mul(0.5);
          const dist = float(1.0).sub(
            smoothstep(0.0, this.uFalloff, distance(uv, this.uMouse)),
          );
          const injected = select(
            deltaLength.greaterThan(0.0001),
            this.uDeltaMouse.mul(dist),
            vec2(0.0),
          );

          const flow = prevFlow.add(injected).mul(this.uDissipation);
          return vec4(flow.mul(0.5).add(0.5), 0.0, 1.0);
        },
        size: this.size,
        type: THREE.FloatType,
        filter: THREE.NearestFilter,
      },
    };
  }

  update(_time: number, mouse?: THREE.Vector2): void {
    if (!this.pass) return;

    const m = mouse ?? this._prevMouse;
    if (this._hasPrevMouse) {
      this._delta.copy(m).sub(this._prevMouse);
      if (this._delta.lengthSq() > this._maxDelta * this._maxDelta) {
        this._delta.set(0, 0);
      }
    } else {
      this._delta.set(0, 0);
    }
    this._prevMouse.copy(m);
    this._hasPrevMouse = true;

    this.uDeltaMouse.value.copy(this._delta);
    this.uDissipation.value = this.dissipation;
    this.uFalloff.value = this.falloff;

    this.setUniform('uStrength', this.strength);
  }

  setupGUI(gui: GUI): GUI {
    const folder = gui.addFolder('マウスフロー (Mouse flow)');
    folder.add(this, 'enabled').name('有効');
    folder.add(this, 'strength', 0.0, 10.0, 0.1).name('歪みの強さ');
    folder.add(this, 'dissipation', 0.8, 1.0, 0.001).name('減衰（消える速さ）');
    folder.add(this, 'falloff', 0.01, 1.0, 0.01).name('影響半径');
    return folder;
  }

  dispose(): void {
    this.pass = null;
  }
}
