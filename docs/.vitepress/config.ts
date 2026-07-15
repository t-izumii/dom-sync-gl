import { defineConfig } from 'vitepress';
import { fileURLToPath, URL } from 'node:url';

// GitHub Pages 配信用の base path。リポジトリ名 = dom-sync-gl
const REPO_NAME = 'dom-sync-gl';

export default defineConfig({
  title: 'domSyncGL',
  description: 'DOM 要素の位置に Three.js plane を貼って、スクロール同期 + ポストエフェクトを重ねる薄いラッパー',
  base: `/${REPO_NAME}/`,
  lang: 'ja',
  lastUpdated: true,
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Demos', link: '/demos/' },
      { text: 'API', link: '/api/dom-sync-gl' },
      { text: 'GitHub', link: 'https://github.com/t-izumii/dom-sync-gl' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Scroll Sync', link: '/guide/scroll-sync' },
            { text: 'Text Planes', link: '/guide/text-planes' },
            { text: 'Post Effects', link: '/guide/post-effects' },
          ],
        },
      ],
      '/demos/': [
        {
          text: 'Demos',
          items: [
            { text: 'Overview', link: '/demos/' },
            { text: 'DOM-locked Plane', link: '/demos/plane' },
            { text: 'Scroll Sync', link: '/demos/scroll-sync' },
            { text: 'Post Effect', link: '/demos/post-effect' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API',
          items: [
            { text: 'DomSyncGL', link: '/api/dom-sync-gl' },
            { text: 'DomPlane', link: '/api/dom-plane' },
            { text: 'DomTextPlane', link: '/api/dom-text-plane' },
            { text: 'loadFont', link: '/api/load-font' },
            { text: 'Scroll', link: '/api/scroll' },
            { text: 'BaseEffect', link: '/api/base-effect' },
          ],
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/t-izumii/dom-sync-gl' }],
    search: { provider: 'local' },
    outline: { level: [2, 3], label: '目次' },
    docFooter: { prev: '前へ', next: '次へ' },
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
