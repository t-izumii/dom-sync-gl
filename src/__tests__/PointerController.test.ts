import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three/webgpu';
import { PointerController } from '../PointerController';
import type { Camera } from '../Camera';
import type { DomPlane } from '../DomPlane';

// PointerController は単点ポインタ（マウス/タッチ/ペン）入力を Pointer Events で取り込み、
// mouse(UV) / active / pointerType を更新する。ここでは入力 → 状態のマッピングと
// フルスクリーン plane への hover 供給（update() 経由）を検証する。
// raycast は planeMeshes を空にして経路に入れない（camera は未使用）。

/** 100×100 の canvas を左上原点で固定。jsdom の bcr は全 0 なので上書きする。 */
function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  return canvas;
}

/** jsdom は PointerEvent コンストラクタが不安定なので、必要な field を載せた Event を投げる。 */
function dispatchPointer(
  type: 'pointermove' | 'pointerdown' | 'pointerup' | 'pointercancel',
  props: {
    pointerId?: number;
    pointerType?: 'mouse' | 'touch' | 'pen';
    clientX: number;
    clientY: number;
  },
): void {
  const e = new Event(type) as Event & Record<string, unknown>;
  Object.assign(e, {
    pointerId: props.pointerId ?? 1,
    pointerType: props.pointerType ?? 'mouse',
    clientX: props.clientX,
    clientY: props.clientY,
  });
  window.dispatchEvent(e);
}

interface Harness {
  pc: PointerController;
  fullscreenPlane: { element: null; setHoverInfo: ReturnType<typeof vi.fn> };
}

function makeHarness(): Harness {
  const fullscreenPlane = { element: null, setHoverInfo: vi.fn() };
  const planes = [fullscreenPlane] as unknown as DomPlane[];
  const pc = new PointerController({
    canvas: makeCanvas(),
    camera: {} as unknown as Camera, // planeMeshes 空なので raycast に入らず未使用
    planeMeshes: [],
    planeByMesh: new Map<THREE.Mesh, DomPlane>(),
    planes,
  });
  return { pc, fullscreenPlane };
}

describe('PointerController（ポインタ統合: マウス/タッチ/ペン）', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeHarness();
    harness.pc.setEnabled(true);
  });

  afterEach(() => {
    harness.pc.destroy();
  });

  it('マウス移動: canvas 内なら UV を更新し active=true / pointerType=mouse（従来挙動）', () => {
    const { pc, fullscreenPlane } = harness;
    dispatchPointer('pointermove', { pointerType: 'mouse', clientX: 50, clientY: 50 });

    expect(pc.getMouse().x).toBeCloseTo(0.5, 5);
    expect(pc.getMouse().y).toBeCloseTo(0.5, 5); // Y-up: 1 - 50/100
    expect(pc.isPointerActive()).toBe(true);
    expect(pc.getPointerType()).toBe('mouse');

    // hover は update() で確定し、フルスクリーン plane へ流れる。
    pc.update();
    expect(fullscreenPlane.setHoverInfo).toHaveBeenLastCalledWith(true, pc.getMouse());
  });

  it('マウスが canvas 外: active=false、mouse は据え置き、フルスクリーン hover も false', () => {
    const { pc, fullscreenPlane } = harness;
    dispatchPointer('pointermove', { pointerType: 'mouse', clientX: 50, clientY: 50 });
    const inX = pc.getMouse().x;

    dispatchPointer('pointermove', { pointerType: 'mouse', clientX: 200, clientY: 200 });
    expect(pc.isPointerActive()).toBe(false);
    expect(pc.getMouse().x).toBeCloseTo(inX, 5); // 外では更新しない

    pc.update();
    expect(fullscreenPlane.setHoverInfo).toHaveBeenLastCalledWith(false, pc.getMouse());
  });

  it('タッチ down: active=true / pointerType=touch、prev スナップで初フレ delta=0（force スパイク防止）', () => {
    const { pc } = harness;
    dispatchPointer('pointerdown', {
      pointerType: 'touch',
      pointerId: 1,
      clientX: 90,
      clientY: 10,
    });

    expect(pc.isPointerActive()).toBe(true);
    expect(pc.getPointerType()).toBe('touch');
    expect(pc.getMouse().x).toBeCloseTo(0.9, 5);
    expect(pc.getMouse().y).toBeCloseTo(0.9, 5); // 1 - 10/100
    // down 直後は prev が現在地にスナップされるので delta が立たない。
    expect(pc.getMouseDelta().x).toBeCloseTo(0, 5);
    expect(pc.getMouseDelta().y).toBeCloseTo(0, 5);
  });

  it('タッチ move: 主点の位置に追従し delta に反映される', () => {
    const { pc } = harness;
    dispatchPointer('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 90, clientY: 10 });
    dispatchPointer('pointermove', { pointerType: 'touch', pointerId: 1, clientX: 40, clientY: 60 });

    expect(pc.getMouse().x).toBeCloseTo(0.4, 5);
    expect(pc.getMouse().y).toBeCloseTo(0.4, 5);
    // prev は down 時の (0.9, 0.9) のまま（endFrame 未呼び）。
    expect(pc.getMouseDelta().x).toBeCloseTo(-0.5, 5);
    expect(pc.getMouseDelta().y).toBeCloseTo(-0.5, 5);
  });

  it('タッチ up: active=false / pointerType=none、フルスクリーン hover も解除', () => {
    const { pc, fullscreenPlane } = harness;
    dispatchPointer('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 50, clientY: 50 });
    dispatchPointer('pointerup', { pointerType: 'touch', pointerId: 1, clientX: 50, clientY: 50 });

    expect(pc.isPointerActive()).toBe(false);
    expect(pc.getPointerType()).toBe('none');

    pc.update();
    expect(fullscreenPlane.setHoverInfo).toHaveBeenLastCalledWith(false, pc.getMouse());
  });

  it('単点保証: 2 本目の指は主点を奪わず、主点を離すまで無視される', () => {
    const { pc } = harness;
    dispatchPointer('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 50, clientY: 50 });

    // 2 本目（id=2）の down / move は無視される（mouse は id=1 の位置のまま）。
    dispatchPointer('pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 10, clientY: 90 });
    dispatchPointer('pointermove', { pointerType: 'touch', pointerId: 2, clientX: 20, clientY: 20 });
    expect(pc.getMouse().x).toBeCloseTo(0.5, 5);
    expect(pc.getMouse().y).toBeCloseTo(0.5, 5);

    // 2 本目を離しても主点は生きたまま。
    dispatchPointer('pointerup', { pointerType: 'touch', pointerId: 2, clientX: 20, clientY: 20 });
    expect(pc.isPointerActive()).toBe(true);

    // 主点（id=1）を離すと解除。
    dispatchPointer('pointerup', { pointerType: 'touch', pointerId: 1, clientX: 50, clientY: 50 });
    expect(pc.isPointerActive()).toBe(false);
  });

  it('canvas 外で始まったタッチは主点にしない（後続の内側タッチが主点になる）', () => {
    const { pc } = harness;
    dispatchPointer('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 200, clientY: 200 });
    expect(pc.isPointerActive()).toBe(false);

    // 内側で始まったタッチが主点として捕捉される。
    dispatchPointer('pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 50, clientY: 50 });
    expect(pc.isPointerActive()).toBe(true);
    expect(pc.getPointerType()).toBe('touch');
  });

  it('setEnabled(false): フルスクリーン hover を解除し active=false', () => {
    const { pc, fullscreenPlane } = harness;
    dispatchPointer('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 50, clientY: 50 });
    pc.update();
    fullscreenPlane.setHoverInfo.mockClear();

    pc.setEnabled(false);
    expect(pc.isPointerActive()).toBe(false);
    expect(fullscreenPlane.setHoverInfo).toHaveBeenCalledWith(false, null);

    // detach 後はイベントを無視する。
    dispatchPointer('pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 10, clientY: 10 });
    expect(pc.isPointerActive()).toBe(false);
  });
});

// CR-02: 非表示 Plane が Pointer hover を奪う問題の回帰。
// Raycaster.intersectObjects は Object3D.visible を除外しないため、
// PointerController 側で可視 mesh だけを raycast に渡し、hover 中の plane が
// 非表示になったら解除する必要がある。ここでは raycaster を差し替えて、
// 「raycast に渡された配列」と hover 解除の挙動を検証する。

/**
 * setHoverInfo / isVisible / mesh を持つ最小の DomPlane モックを作る。
 * element は非 null（= DOM 追従 plane）にして、フルスクリーン hover 経路
 * ではなく raycast 経路で hover が決まるようにする。
 */
function makePlaneMock(visible: boolean): {
  plane: { isVisible: boolean; element: HTMLElement; setHoverInfo: ReturnType<typeof vi.fn> };
  mesh: THREE.Mesh;
} {
  const mesh = new THREE.Mesh();
  mesh.visible = visible;
  const plane = {
    isVisible: visible,
    element: document.createElement('div'),
    setHoverInfo: vi.fn(),
  };
  return { plane, mesh };
}

interface RaycastHarness {
  pc: PointerController;
  a: ReturnType<typeof makePlaneMock>;
  b: ReturnType<typeof makePlaneMock>;
  /** raycaster.intersectObjects に実際に渡された mesh 配列。 */
  passedTargets: THREE.Mesh[] | null;
  /** 次に intersectObjects が返す hit の対象 mesh（uv 付き）。 */
  setHit: (mesh: THREE.Mesh | null) => void;
}

/**
 * planeMeshes に可視 a と非表示 b を積んだ状態を作り、raycaster を差し替えて
 * intersectObjects の入出力を観測できるようにする。
 */
function makeRaycastHarness(): RaycastHarness {
  const a = makePlaneMock(true);
  const b = makePlaneMock(false);
  const planeByMesh = new Map<THREE.Mesh, DomPlane>();
  planeByMesh.set(a.mesh, a.plane as unknown as DomPlane);
  planeByMesh.set(b.mesh, b.plane as unknown as DomPlane);

  const pc = new PointerController({
    canvas: makeCanvas(),
    camera: { instance: {} } as unknown as Camera,
    planeMeshes: [a.mesh, b.mesh],
    planeByMesh,
    planes: [a.plane, b.plane] as unknown as DomPlane[],
  });

  const state: { passedTargets: THREE.Mesh[] | null; hit: THREE.Mesh | null } = {
    passedTargets: null,
    hit: null,
  };
  // 実 Raycaster の内部（three の実装）に依存せず、渡された配列と返り値だけを
  // 制御するためにモックへ差し替える。
  const raycaster = {
    setFromCamera: vi.fn(),
    intersectObjects: (objects: THREE.Mesh[]) => {
      state.passedTargets = objects.slice();
      if (state.hit && objects.includes(state.hit)) {
        return [{ object: state.hit, uv: new THREE.Vector2(0.5, 0.5) }];
      }
      return [];
    },
  };
  (pc as unknown as { raycaster: unknown }).raycaster = raycaster;

  pc.setEnabled(true);

  return {
    pc,
    a,
    b,
    get passedTargets() {
      return state.passedTargets;
    },
    setHit: (mesh) => {
      state.hit = mesh;
    },
  };
}

describe('PointerController（CR-02: 非表示 Plane が hover を奪わない）', () => {
  it('非表示 mesh は raycast 対象から除外される', () => {
    const h = makeRaycastHarness();
    dispatchPointer('pointermove', { pointerType: 'mouse', clientX: 50, clientY: 50 });

    h.pc.update();

    expect(h.passedTargets).not.toBeNull();
    expect(h.passedTargets).toContain(h.a.mesh); // 可視
    expect(h.passedTargets).not.toContain(h.b.mesh); // 非表示は除外
    h.pc.destroy();
  });

  it('手前の非表示 plane があっても奥の可視 plane が hover を得る', () => {
    const h = makeRaycastHarness();
    dispatchPointer('pointermove', { pointerType: 'mouse', clientX: 50, clientY: 50 });
    // 非表示 b が hit しても返らない（配列に含まれない）。可視 a を hit にする。
    h.setHit(h.a.mesh);

    h.pc.update();

    expect(h.a.plane.setHoverInfo).toHaveBeenLastCalledWith(true, expect.anything());
    expect(h.b.plane.setHoverInfo).not.toHaveBeenCalledWith(true, expect.anything());
    h.pc.destroy();
  });

  it('hover 中の plane が非表示になったら次の update() で hover が解除される', () => {
    const h = makeRaycastHarness();
    dispatchPointer('pointermove', { pointerType: 'mouse', clientX: 50, clientY: 50 });
    h.setHit(h.a.mesh);

    // 1 回目: a を hover。
    h.pc.update();
    expect(h.a.plane.setHoverInfo).toHaveBeenLastCalledWith(true, expect.anything());

    // a が画面外に出て非表示化。
    h.a.plane.isVisible = false;
    h.a.mesh.visible = false;
    h.a.plane.setHoverInfo.mockClear();

    // 2 回目: hover が解除される。
    h.pc.update();
    expect(h.a.plane.setHoverInfo).toHaveBeenCalledWith(false, null);
    h.pc.destroy();
  });
});
