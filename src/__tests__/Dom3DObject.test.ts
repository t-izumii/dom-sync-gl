import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three/webgpu';

// GLTFLoader は実ファイル取得を行うため、load() を同期的にフェイクシーンで
// 解決するようにモックする。three/webgpu 自体はこのファイルではモックしないため、
// factory 内で改めて import してジオメトリ/マテリアル/テクスチャを本物で作る
// （vi.mock は import 文より前にホイストされるため、外側の THREE 束縛には頼らない）。
// src 本体と同じ three/webgpu から import しないと instanceof が二重化して壊れる。
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', async () => {
  const RealTHREE = await import('three/webgpu');
  return {
    GLTFLoader: class {
      load(
        _path: string,
        onLoad: (gltf: { scene: InstanceType<typeof RealTHREE.Group> }) => void,
      ) {
        const group = new RealTHREE.Group();
        const geometry = new RealTHREE.BoxGeometry(1, 1, 1);
        const texture = new RealTHREE.Texture();
        const material = new RealTHREE.MeshStandardMaterial({ map: texture });
        const mesh = new RealTHREE.Mesh(geometry, material);
        group.add(mesh);
        onLoad({ scene: group });
      }
    },
  };
});

import { Dom3DObject } from '../Dom3DObject';
import type { DomPositionCalculator } from '../DomPositionCalculator';

// positionCalculator は private フィールドだが、テストでは spy を仕込むために参照する
// （プロジェクト内の他テストでも private フィールドはキャスト経由で参照する慣習）。
type WithInternals = {
  positionCalculator: DomPositionCalculator | null;
};

describe('Dom3DObject', () => {
  let scene: THREE.Scene;
  let disconnectSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scene = new THREE.Scene();
    disconnectSpy = vi.fn();
    // Dom3DObject の observer コールバックは `if (this.model)` で防御されているため、
    // DomPlane と異なり同期発火でも安全（model は observe() 呼び出し後にセットされる）。
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        private callback: IntersectionObserverCallback;
        constructor(callback: IntersectionObserverCallback) {
          this.callback = callback;
        }
        observe(target: Element) {
          this.callback(
            [{ isIntersecting: true, target } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver
          );
        }
        unobserve() {}
        disconnect = disconnectSpy;
      }
    );
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function makeElement(width: number, height: number): HTMLElement {
    const el = document.createElement('div');
    document.body.appendChild(el);
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, width, height)
    );
    return el;
  }

  it('要素ロック: モデルは Group にラップされ mainScene に追加される', () => {
    const el = makeElement(100, 100);
    const obj = new Dom3DObject(el, scene, new DOMRect(0, 0, 1000, 1000), { x: 0, y: 0 }, {
      modelPath: 'dummy.glb',
    });

    const model = obj.getModel();
    expect(model).not.toBeNull();
    expect(model).toBeInstanceOf(THREE.Group);
    expect(scene.children).toContain(model);
    obj.destroy();
  });

  it('全画面(element無し): モデルはラップされず、userScale がそのまま適用される', () => {
    const obj = new Dom3DObject(null, scene, new DOMRect(0, 0, 1000, 1000), { x: 0, y: 0 }, {
      modelPath: 'dummy.glb',
      scale: 3,
    });

    const model = obj.getModel()!;
    expect(model.scale.x).toBeCloseTo(3);
    expect(model.scale.y).toBeCloseTo(3);
    expect(model.scale.z).toBeCloseTo(3);
    obj.destroy();
  });

  describe('fitMode', () => {
    it('既定 (maxSide) は DOM 矩形の長辺に合わせてスケールする', () => {
      const el = makeElement(300, 100); // 長辺 300
      const obj = new Dom3DObject(el, scene, new DOMRect(0, 0, 1000, 1000), { x: 0, y: 0 }, {
        modelPath: 'dummy.glb',
      });

      expect(obj.getModel()!.scale.x).toBeCloseTo(300);
      obj.destroy();
    });

    it('contain は DOM 矩形の短辺に合わせてスケールする', () => {
      const el = makeElement(300, 100); // 短辺 100
      const obj = new Dom3DObject(el, scene, new DOMRect(0, 0, 1000, 1000), { x: 0, y: 0 }, {
        modelPath: 'dummy.glb',
        fitMode: 'contain',
      });

      expect(obj.getModel()!.scale.x).toBeCloseTo(100);
      obj.destroy();
    });

    it('userScale と乗算される', () => {
      const el = makeElement(300, 100);
      const obj = new Dom3DObject(el, scene, new DOMRect(0, 0, 1000, 1000), { x: 0, y: 0 }, {
        modelPath: 'dummy.glb',
        fitMode: 'contain',
        scale: 2,
      });

      expect(obj.getModel()!.scale.x).toBeCloseTo(200); // 100 * 2
      obj.destroy();
    });
  });

  describe('destroy() のリソース解放', () => {
    it('geometry / material / テクスチャ(map) を dispose し、mainScene から取り除く', () => {
      const el = makeElement(100, 100);
      const obj = new Dom3DObject(el, scene, new DOMRect(0, 0, 1000, 1000), { x: 0, y: 0 }, {
        modelPath: 'dummy.glb',
      });
      const model = obj.getModel()!;
      // 要素ロック時は setupModel() が元の Group を新しい wrapper Group でラップするため、
      // 実際の mesh は traverse で探す（wrapper 直下とは限らない）。
      let mesh: THREE.Mesh | undefined;
      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) mesh = child as THREE.Mesh;
      });
      if (!mesh) throw new Error('mesh not found in model');
      const material = mesh.material as THREE.MeshStandardMaterial;
      const geoDisposeSpy = vi.spyOn(mesh.geometry, 'dispose');
      const matDisposeSpy = vi.spyOn(material, 'dispose');
      const texDisposeSpy = vi.spyOn(material.map!, 'dispose');

      obj.destroy();

      expect(geoDisposeSpy).toHaveBeenCalledTimes(1);
      expect(matDisposeSpy).toHaveBeenCalledTimes(1);
      expect(texDisposeSpy).toHaveBeenCalledTimes(1);
      expect(scene.children).not.toContain(model);
      expect(obj.getModel()).toBeNull();
      expect(disconnectSpy).toHaveBeenCalledTimes(1);
    });

    it('destroy() は冪等（2 回呼んでも例外にならない）', () => {
      const el = makeElement(100, 100);
      const obj = new Dom3DObject(el, scene, new DOMRect(0, 0, 1000, 1000), { x: 0, y: 0 }, {
        modelPath: 'dummy.glb',
      });

      obj.destroy();
      expect(() => obj.destroy()).not.toThrow();
      expect(disconnectSpy).toHaveBeenCalledTimes(1); // 2 回目は早期 return
    });

    it('_setOnDestroy の callback は destroy() で一度だけ呼ばれる（CR-14）', () => {
      const el = makeElement(100, 100);
      const obj = new Dom3DObject(el, scene, new DOMRect(0, 0, 1000, 1000), { x: 0, y: 0 }, {
        modelPath: 'dummy.glb',
      });
      const onDestroy = vi.fn();
      obj._setOnDestroy(onDestroy);

      obj.destroy();
      obj.destroy(); // 冪等 & 一度きり

      expect(onDestroy).toHaveBeenCalledTimes(1);
    });
  });

  describe('position: sticky（毎フレーム再計測の回帰）', () => {
    it('sticky 要素は updateRectEveryFrame: false でも毎フレーム rect を読み直す', () => {
      const el = makeElement(100, 100);
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        position: 'sticky',
      } as CSSStyleDeclaration);

      const obj = new Dom3DObject(el, scene, new DOMRect(0, 0, 1000, 1000), { x: 0, y: 0 }, {
        modelPath: 'dummy.glb',
      });
      const calc = (obj as unknown as WithInternals).positionCalculator!;
      const updateSpy = vi.spyOn(calc, 'updatePositionInfo');

      obj._tickRead(0, 0);
      obj._tickRead(0, 10);

      expect(updateSpy).toHaveBeenCalledTimes(2);
      obj.destroy();
    });

    it('非 sticky 要素は updateRectEveryFrame: false だと毎フレームは再計測しない', () => {
      const el = makeElement(100, 100);
      // getComputedStyle の既定 position は 'static'（jsdom 既定）

      const obj = new Dom3DObject(el, scene, new DOMRect(0, 0, 1000, 1000), { x: 0, y: 0 }, {
        modelPath: 'dummy.glb',
      });
      const calc = (obj as unknown as WithInternals).positionCalculator!;
      const updateSpy = vi.spyOn(calc, 'updatePositionInfo');

      obj._tickRead(0, 0);
      obj._tickRead(0, 10);

      expect(updateSpy).not.toHaveBeenCalled();
      obj.destroy();
    });
  });

  describe('resize / setCanvasRect', () => {
    it('resize() は要素の最新矩形でスケールと位置を再計算する', () => {
      const el = makeElement(100, 100);
      const obj = new Dom3DObject(el, scene, new DOMRect(0, 0, 1000, 1000), { x: 0, y: 0 }, {
        modelPath: 'dummy.glb',
      });
      expect(obj.getModel()!.scale.x).toBeCloseTo(100);

      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, 0, 400, 200)
      );
      obj.resize();

      expect(obj.getModel()!.scale.x).toBeCloseTo(400); // maxSide 更新後
      obj.destroy();
    });

    it('setCanvasRect() は positionCalculator に新しい canvasRect を伝える', () => {
      const el = makeElement(100, 100);
      const obj = new Dom3DObject(el, scene, new DOMRect(0, 0, 1000, 1000), { x: 0, y: 0 }, {
        modelPath: 'dummy.glb',
      });
      const calc = (obj as unknown as WithInternals).positionCalculator!;
      const setCanvasRectSpy = vi.spyOn(calc, 'setCanvasRect');

      const newRect = new DOMRect(0, 0, 500, 500);
      obj.setCanvasRect(newRect);

      expect(setCanvasRectSpy).toHaveBeenCalledWith(newRect);
      obj.destroy();
    });
  });
});
