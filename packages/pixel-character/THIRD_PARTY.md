# Three.js addon reference and license

Installed and pinned version: **three 0.186.0 (r186)**.

- Official baseline: https://github.com/mrdoob/three.js/blob/r186/examples/jsm/postprocessing/RenderPixelatedPass.js
- Composer: https://github.com/mrdoob/three.js/blob/r186/examples/jsm/postprocessing/EffectComposer.js
- Output: https://github.com/mrdoob/three.js/blob/r186/examples/jsm/postprocessing/OutputPass.js
- Docs: https://threejs.org/docs/pages/RenderPixelatedPass.html and https://threejs.org/docs/pages/OutputPass.html
- Renderer: https://threejs.org/docs/pages/WebGLRenderer.html

`AlphaPixelPass` follows the addon's scene → beauty/depth → optional normals → full-screen rendering structure. Its shader is a separate implementation. No node_modules files are modified and no private addon fields are accessed by production code. The smoke test inspects r186 private target dimensions solely to verify the unchanged official baseline.

Changes relative to the official reference:

1. Fixed low resolution, pixelSize=1, explicit DPR=1.
2. Skip the normal render when normal edges are disabled. The official r186 render method always renders normals.
3. Modify RGB only for internal edges, instead of the official `gl_FragColor = texel * Strength`, which also modifies alpha.
4. Add one-pixel four-neighbor opaque silhouette dilation independently of depth/normal edges.
5. Add GPU palette quantization. Keep color conversion in OutputPass.
6. Expose render-target dimensions and per-frame normal-render count for tests.

## MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
