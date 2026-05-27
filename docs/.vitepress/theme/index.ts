import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import DemoPlane from '../components/DemoPlane.vue';
import DemoScrollSync from '../components/DemoScrollSync.vue';
import DemoEffect from '../components/DemoEffect.vue';
import './custom.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('DemoPlane', DemoPlane);
    app.component('DemoScrollSync', DemoScrollSync);
    app.component('DemoEffect', DemoEffect);
  },
} satisfies Theme;
