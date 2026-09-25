---
layout: home

hero:
  name: domSyncGL
  text: Connect the DOM and the GPU in one frame
  tagline: A thin wrapper that places Three.js planes at the position of DOM elements, with scroll sync and TSL post effects on top. WebGPU by default, with automatic fallback to WebGL 2.
  actions:
    - theme: brand
      text: Get Started
      link: /en/guide/getting-started
    - theme: alt
      text: Demos
      link: /en/demos/
    - theme: alt
      text: API
      link: /en/api/dom-sync-gl
    - theme: alt
      text: GitHub
      link: https://github.com/t-izumii/dom-sync-gl

features:
  - title: DOM-locked plane
    details: createPlane(selector) creates a Three.js mesh that follows the bounding box of an element and tracks page scrolling pixel for pixel.
  - title: WebGPU / WebGL 2 fallback
    details: Uses WebGPU by default and switches to WebGL 2 where it is unavailable. Shaders are written in TSL, so one implementation covers both WGSL and GLSL.
  - title: Scroll sync
    details: Corrects the offset between native scrolling and the canvas every frame, without breaking the rubber-band effect or pull-to-refresh on iOS Safari.
  - title: Text planes
    details: createTextPlane() turns DOM text into a plane. Styles come from CSS and the DOM stays in place, so layout, accessibility, and selection keep working.
  - title: Composable post effects
    details: Extend BaseEffect and return a TSL outputNode to compose passes with ping-pong buffers, per plane or across the whole screen.
---

## Live demo

A plane locked to a DOM element, running a TSL shader.

<DemoPlane />

→ See [Demos](/en/demos/) for the full list with code.

## Install

```bash
npm install dom-sync-gl three
```

```ts
import { DomSyncGL, TSL } from 'dom-sync-gl';
const { vec4, sin } = TSL;

const app = new DomSyncGL('#canvas');

app.createPlane('.hero-card', {
  colorNode: ({ uv, uTime }) => vec4(uv, sin(uTime).mul(0.5).add(0.5), 1),
});
```
