import { defineConfig } from 'vitepress';
import { fileURLToPath, URL } from 'node:url';

// GitHub Pages 配信用の base path。リポジトリ名 = dom-sync-gl
const REPO_NAME = 'dom-sync-gl';

// ナビとサイドバーは言語ごとに同じ構成で、リンクの接頭辞とラベルだけが異なる。
function localeTheme(prefix: string, labels: { migration: string }) {
  return {
    nav: [
      { text: 'Guide', link: `${prefix}/guide/getting-started` },
      { text: 'Demos', link: `${prefix}/demos/` },
      { text: 'API', link: `${prefix}/api/dom-sync-gl` },
      { text: 'GitHub', link: 'https://github.com/t-izumii/dom-sync-gl' },
    ],
    sidebar: {
      [`${prefix}/guide/`]: [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: `${prefix}/guide/getting-started` },
            { text: 'Scroll Sync', link: `${prefix}/guide/scroll-sync` },
            { text: 'Text Planes', link: `${prefix}/guide/text-planes` },
            { text: 'Post Effects', link: `${prefix}/guide/post-effects` },
            { text: labels.migration, link: `${prefix}/guide/migration-v0-4` },
          ],
        },
      ],
      [`${prefix}/demos/`]: [
        {
          text: 'Demos',
          items: [
            { text: 'Overview', link: `${prefix}/demos/` },
            { text: 'DOM-locked Plane', link: `${prefix}/demos/plane` },
            { text: 'Scroll Sync', link: `${prefix}/demos/scroll-sync` },
            { text: 'Post Effect', link: `${prefix}/demos/post-effect` },
          ],
        },
      ],
      [`${prefix}/api/`]: [
        {
          text: 'API',
          items: [
            { text: 'DomSyncGL', link: `${prefix}/api/dom-sync-gl` },
            { text: 'DomPlane', link: `${prefix}/api/dom-plane` },
            { text: 'DomTextPlane', link: `${prefix}/api/dom-text-plane` },
            { text: 'loadFont', link: `${prefix}/api/load-font` },
            { text: 'Scroll', link: `${prefix}/api/scroll` },
            { text: 'BaseEffect', link: `${prefix}/api/base-effect` },
          ],
        },
      ],
    },
  };
}

export default defineConfig({
  title: 'domSyncGL',
  base: `/${REPO_NAME}/`,
  lastUpdated: true,
  cleanUrls: true,
  // 日本語はルート（既存 URL を維持）、英語は /en/ 配下。
  locales: {
    root: {
      label: '日本語',
      lang: 'ja',
      description: 'DOM 要素の位置に Three.js plane を貼って、スクロール同期 + ポストエフェクトを重ねる薄いラッパー',
      themeConfig: {
        ...localeTheme('', { migration: 'v0.3 からの移行' }),
        outline: { level: [2, 3], label: '目次' },
        docFooter: { prev: '前へ', next: '次へ' },
      },
    },
    en: {
      label: 'English',
      lang: 'en',
      link: '/en/',
      description: 'A thin wrapper that places Three.js planes at DOM elements, with scroll sync and post effects',
      themeConfig: {
        ...localeTheme('/en', { migration: 'Migrating from v0.3' }),
        outline: { level: [2, 3], label: 'On this page' },
      },
    },
  },
  themeConfig: {
    socialLinks: [{ icon: 'github', link: 'https://github.com/t-izumii/dom-sync-gl' }],
    search: { provider: 'local' },
  },
  vite: {
    resolve: {
      alias: {
        // ローカル src を import 解決対象にする。
        // demo コンポーネントは `import { DomSyncGL } from 'dom-sync-gl'` で書け、
        // dev / build の両方で src/index.ts を見にいく。
        'dom-sync-gl': fileURLToPath(new URL('../../src/index.ts', import.meta.url)),
      },
    },
    ssr: {
      // three は CJS と ESM が混在しがちで SSR で詰まるので除外
      noExternal: ['three'],
    },
  },
});
