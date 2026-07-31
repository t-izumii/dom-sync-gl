import { Vector2 } from "three/webgpu";

/**
 * マウスの「前フレーム位置」と「移動強度」を算出する共通ヘルパー。
 *
 * plane の colorNode（`PlaneNodeContext`）/ `plane.addFeedback()`
 * （`FeedbackContext`）/ post effect（`BaseEffect`）の 3 経路で同じ数式・同じ
 * 既定値を配るための正本。移動量ベクトル・移動距離・アイドル時間・真偽ゲートと
 * いった派生形は、この 2 つのプリミティブから消費側が導出する。
 *
 * @example
 * const motion = new MouseMotion();
 * motion.update(mouseUV, width / height);
 * uPrevMouse.value.copy(motion.prev);
 * uMove.value = motion.move;
 */
export class MouseMotion {
  /**
   * 前フレームのマウス位置。初回は現在位置と同値になるため、消費側は
   * 「前回値がまだ無い」フラグを持たずに差分を取れる（差分が自然に 0 になる）。
   */
  readonly prev = new Vector2();

  /** この移動距離以下は 0 として扱う（手ぶれ・サブピクセルの揺れの除去） */
  threshold = 0.0008;
  /** この移動距離で 1 に到達する。これを超えても 1 で頭打ち */
  scale = 0.01;
  /** 静止時に毎フレーム掛かる減衰率 */
  release = 0.85;

  private _move = 0;
  private readonly _current = new Vector2();
  private _hasCurrent = false;

  /** 0〜1 の移動強度。立ち上がりは即座、減衰は緩やか。 */
  get move(): number {
    return this._move;
  }

  /**
   * @param mouse 今フレームのマウス位置（UV 系。座標系は呼び出し側で統一する）
   * @param aspect UV の横方向の引き伸ばし補正。有限でない値は 1 として扱う
   *   （`step()` のように外部から aspect を受け取る経路があるため、ここで最終防衛する）
   */
  update(mouse: Vector2, aspect: number): void {
    // `|| 1` ではなく isFinite 判定にしているのは、height が 0 のときの
    // Infinity が truthy で素通りしてしまうため。
    const a = Number.isFinite(aspect) ? aspect : 1;

    let move = 0;
    if (this._hasCurrent) {
      // UV の横方向は画面の横長分だけ引き伸ばされているため、dx に掛けて戻す。
      const dx = (mouse.x - this._current.x) * a;
      const dy = mouse.y - this._current.y;
      const dist = Math.hypot(dx, dy);
      // scale で割って 1 でクランプすることで、テレポート級の移動でも 1 に
      // 収まる（別途のテレポート判定を不要にしている）。
      move = dist > this.threshold ? Math.min(1, dist / this.scale) : 0;
    }

    this.prev.copy(this._hasCurrent ? this._current : mouse);
    this._current.copy(mouse);
    this._hasCurrent = true;
    // 立ち上がりは即座・減衰は緩やか、という非対称。動き出しに反応が遅れると
    // 入力が鈍く感じられ、止めた瞬間に消えると残像が途切れて見えるため。
    this._move = Math.max(move, this._move * this.release);
  }

  /**
   * 今フレームのマウス位置が取れないときに減衰だけ進める
   * （移動情報が無い＝動いていない、と解釈する）。`update()` に前回位置を
   * 渡し直す形にしないのは、まだ一度もマウスを観測していない状態で
   * ダミー初期値を「観測済み」にしてしまい、最初の実入力が巨大な移動として
   * 誤検出されるため。
   */
  decay(): void {
    this._move *= this.release;
  }
}
