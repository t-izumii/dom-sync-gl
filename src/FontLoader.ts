/**
 * 任意の Web フォントを FontFace API で動的に読み込む独立ユーティリティ。
 *
 * DomTextPlane からは分離されており、フォントの取得・登録は完全に呼び出し側の責務。
 * 使い方: アプリコードで `await loadFont(...)` してから CSS で font-family を指定し、
 * createTextPlane 側は既存の getComputedStyle 由来のスタイルをそのまま使う。
 * これにより font-size / font-weight は常に CSS（fluid/liquid な clamp() 等も含む）由来を維持できる。
 *
 * 同じフォントを複数箇所で使う場合は、呼び出しごとに FontFaceSource を組み立てるのではなく
 * `const fooReady = loadFont({...})` のように一度だけ呼んで Promise を変数にキャッシュし、
 * 各利用箇所はその変数を await するとよい（内部キャッシュのキーは呼び出し引数の一致に依存するため）。
 */

/** 動的ロードする Web フォントの指定。 */
export interface FontFaceSource {
  /** CSSのfont-familyに指定する名前 */
  family: string;
  /** フォントファイルのURL（woff2/woff/ttf等）。CSSFontFace source構文の文字列を渡してもよいし単一URLでもよい */
  url: string;
  /** font-weight（例: "400", "700", "400 700"） */
  weight?: string;
  /** font-style（例: "normal", "italic"） */
  style?: string;
  /** その他のFontFaceDescriptors（unicode-range等） */
  descriptors?: FontFaceDescriptors;
}

/**
 * 同一フォント（family+url+weight+style+descriptors）のロード処理を共有するためのキャッシュ。
 * 同じフォントを複数回要求しても FontFace の再生成・再フェッチが起きないようにする。
 * - 値は「成功・失敗どちらでも解決する（reject しない）Promise」。呼び出し側が毎回 catch しなくて済む。
 * - 成功したエントリは残し続ける（＝二度とロードしない）。
 * - 失敗したエントリは削除し、次回呼び出し時に再試行できるようにする（一時的なネットワークエラーからの回復のため）。
 */
const fontLoadCache = new Map<string, Promise<void>>();

/** family+url+weight+style+descriptors から安定したキャッシュキーを組み立てる。 */
function fontCacheKey(src: FontFaceSource): string {
  return `${src.family}::${src.url}::${src.weight ?? ""}::${src.style ?? ""}::${JSON.stringify(
    src.descriptors ?? {},
  )}`;
}

/**
 * 単一の FontFace を生成・ロードして document.fonts へ登録する。
 * 失敗時は reject する（キャッシュ側の catch で削除・warn を行うため）。
 */
async function loadSingleFontFace(src: FontFaceSource): Promise<void> {
  // weight/style は個別指定を descriptors 側にマージする（descriptors 側を優先）。
  const descriptors: FontFaceDescriptors = { ...src.descriptors };
  if (src.weight !== undefined && descriptors.weight === undefined) {
    descriptors.weight = src.weight;
  }
  if (src.style !== undefined && descriptors.style === undefined) {
    descriptors.style = src.style;
  }
  // 単一 URL でも CSS source 構文（url(...)）でもよいよう url() で包む。
  const source = /^\s*(url|local)\(/i.test(src.url) ? src.url : `url(${src.url})`;
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  const face = new FontFace(src.family, source, descriptors);
  await face.load();
  fonts?.add(face);
}

/**
 * 任意の Web フォントを FontFace API で動的に読み込み document.fonts へ登録する。
 * 単体オブジェクトでも配列でも受け取れる。
 * - FontFace / document.fonts が無い環境（旧ブラウザ・一部テスト環境）では何もせず即 resolve。
 * - 失敗したフォントは console.warn でログして無視し、全体は失敗させない。
 * - モジュールスコープの fontLoadCache で同一フォントのロードを共有し、重複した new FontFace / フェッチを防ぐ。
 *   同一マイクロタスク付近で並行に同じフォントが要求されても、2 件目以降は進行中の Promise にぶら下がるだけ。
 *
 * 返り値の Promise が解決した時点で「そのフォントがロード完了した」ことを意味する（呼び出し側は
 * これを await してから font-family を適用すればよい）。
 */
export async function loadFont(source: FontFaceSource | FontFaceSource[]): Promise<void> {
  const sources = Array.isArray(source) ? source : [source];
  if (typeof FontFace === "undefined") return;
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts || typeof fonts.add !== "function") return;
  if (sources.length === 0) return;

  await Promise.all(
    sources.map((src) => {
      const key = fontCacheKey(src);
      let cached = fontLoadCache.get(key);
      if (!cached) {
        // 成功・失敗どちらでも resolve する Promise をキャッシュする。
        // 失敗時はキャッシュから該当エントリを削除し、次回呼び出しでの再試行を許容する。
        cached = loadSingleFontFace(src).catch((e) => {
          fontLoadCache.delete(key);
          console.warn(
            `[dom-sync-gl] Failed to load FontFace: ${src.family} (${src.url})`,
            e,
          );
        });
        fontLoadCache.set(key, cached);
      }
      return cached;
    }),
  );
}

/**
 * テスト専用: モジュールスコープの fontLoadCache をクリアする。
 * テスト間でキャッシュ状態が漏れて各テストが独立に挙動検証できなくなるのを防ぐために使う。
 * 本番コードパスからは呼び出さない想定。
 */
export function __resetFontLoadCacheForTests(): void {
  fontLoadCache.clear();
}
