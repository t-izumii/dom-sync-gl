import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
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
