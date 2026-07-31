import * as THREE from 'three/webgpu';
import { clamp, length, screenSize, uniform, vec2, vec4 } from 'three/tsl';
import type { Node, UniformNode } from 'three/webgpu';
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

    this.radius = options.radius?? 0.05;
    this.uRadius = uniform(this.radius);
    this.color = new THREE.Color(options.color ?? '#ff00ff');
    this.uColor = uniform(this.color);
  }

  protected getConfig(): BaseEffectConfig {
    return{
    feedback: {
      node: ({ prev, uv }) =>
        vec4(prev.rgb.mul(0.9).add(this.uColor.mul(this.glowAt(uv))), 1.0),
    },
    outputNode: ({ inputTexture }) =>
      vec4(inputTexture.rgb.add(this.feedbackTexture.rgb), inputTexture.a),
    uniforms: {
      uRadius: this.uRadius,
      uColor: this.uColor
    }
    }
  }

  private glowAt(uvNode: Node): Node {
    const aspect = screenSize.x.div(screenSize.y);
    const p = uvNode.sub(this.uMouse);
    const aspectP = p.mul(vec2(aspect, 1.0));
    const l = length(aspectP);
    const move = clamp(this.uMove, 0, 1);
    const glow = clamp(l.div(this.uRadius), 0, 1).oneMinus()
    return clamp(glow.mul(move));
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
