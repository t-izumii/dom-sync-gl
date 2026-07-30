import * as THREE from 'three/webgpu';
import { clamp, length, mix, pow, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { UniformNode } from 'three/webgpu';
import type GUI from 'lil-gui';
import { BaseEffect, type BaseEffectConfig } from '../../index';

export interface MouseEffectOptions {
  radius?: number;
  color?: string;
}

export class MouseEffect extends BaseEffect {
  public radius: number;
  private readonly uRadius: UniformNode<number>;
   public readonly color: THREE.Color;
  private readonly uColor: UniformNode<THREE.Color>;
  private readonly uMouse: UniformNode<THREE.Vector2>;
  private readonly uResolution = uniform(new THREE.Vector2(1, 1));

  constructor(options: MouseEffectOptions = {}) {
    super();

    this.radius = options.radius?? 0.15;
    this.uRadius = uniform(this.radius);

    this.color = new THREE.Color(options.color ?? '#ff00ff');
    this.uColor = uniform(this.color);

    this.uMouse = uniform(new THREE.Vector2(0.5,0.5));
  }

  protected getConfig(): BaseEffectConfig {
    return{
      outputNode: ({inputTexture, uv}) => {

        const aspect = this.uResolution.x.div(this.uResolution.y);
        const p = uv.sub(this.uMouse);
        const aspectP = p.mul(vec2(aspect, 1.0));
        const l = length(aspectP);
        const glow = clamp(l.div(this.uRadius), 0, 1).oneMinus();

        const color = this.uColor.mul(glow)
        const finalColor= inputTexture.rgb.add(color);

        return vec4(finalColor, inputTexture.a);
      },
    uniforms: {
      uRadius: this.uRadius,
      uResolution: this.uResolution,
      uColor: this.uColor
    }
    }
  }

  update(_time: number, mouse?: THREE.Vector2): void {
    if(!mouse) return
    this.uMouse.value.copy(mouse);
  }

  resize(width: number, height: number): void {
    this.uResolution.value.set(width, height)
  }

  setupGUI(gui: GUI): GUI {
    const folder = gui.addFolder('マウスグロー (Mouse glow)');
    return folder;
  }

  dispose(): void {
    this.pass = null;
  }
}
