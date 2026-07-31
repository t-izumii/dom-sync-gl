import * as THREE from 'three/webgpu';
import { clamp, length, screenSize, mix, pow, uniform, vec2, vec3, vec4 } from 'three/tsl';
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

  constructor(options: MouseEffectOptions = {}) {
    super();

    this.radius = options.radius?? 0.15;
    this.uRadius = uniform(this.radius);

    this.color = new THREE.Color(options.color ?? '#ff00ff');
    this.uColor = uniform(this.color);
  }

  protected getConfig(): BaseEffectConfig {
    return{
      outputNode: ({inputTexture, uv}) => {

        const aspect = screenSize.x.div(screenSize.y);
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
      uColor: this.uColor
    }
    }
  }

  update(): void {
  }

  resize(): void {
  }

  setupGUI(gui: GUI): GUI {
    const folder = gui.addFolder('マウスグロー (Mouse glow)');
    return folder;
  }

  dispose(): void {
    this.pass = null;
  }
}
