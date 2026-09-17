/** Scene-pass structure informed by three.js r186 RenderPixelatedPass (MIT).
 * Independent shader: alpha-safe edges, silhouette dilation and palette quantization.
 * Attribution and full license: ../THIRD_PARTY.md. Never patches node_modules. */
import {
  DepthTexture,
  HalfFloatType,
  MeshNormalMaterial,
  NearestFilter,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
} from "three";
import type { Camera, Scene, WebGLRenderer } from "three";
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js";
import type { PixelStyle } from "./style.ts";
export class AlphaPixelPass extends Pass {
  readonly beauty = new WebGLRenderTarget(1, 1, {
    type: HalfFloatType,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
  });
  readonly normals = new WebGLRenderTarget(1, 1, {
    minFilter: NearestFilter,
    magFilter: NearestFilter,
  });
  readonly normalMaterial = new MeshNormalMaterial();
  readonly material = new ShaderMaterial({
    uniforms: {
      colorTex: { value: null },
      depthTex: { value: null },
      normalTex: { value: null },
      texel: { value: new Vector2(1, 1) },
      outline: { value: 1 },
      depthStrength: { value: 0.25 },
      normalStrength: { value: 0 },
      palette: { value: 0.45 },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader: `
      uniform sampler2D colorTex,depthTex,normalTex;
      uniform vec2 texel; uniform float outline,depthStrength,normalStrength,palette; varying vec2 vUv;
      void main(){
        vec4 c=texture2D(colorTex,vUv);float depth=texture2D(depthTex,vUv).r;
        float alphaNeighbor=0.;float de=0.;float ne=0.;
        vec3 normal=vec3(0.);if(normalStrength>0.)normal=texture2D(normalTex,vUv).xyz*2.-1.;
        for(int i=0;i<4;i++){
          vec2 dir= i==0?vec2(1.,0.):i==1?vec2(-1.,0.):i==2?vec2(0.,1.):vec2(0.,-1.);
          vec2 uv=vUv+dir*texel;vec4 neighbor=texture2D(colorTex,uv);
          alphaNeighbor=max(alphaNeighbor,neighbor.a);
          if(c.a>.99&&neighbor.a>.99){
            float nd=texture2D(depthTex,uv).r;
            de=max(de,step(.0015,nd-depth));
            if(normalStrength>0.)ne=max(ne,step(.24,1.-dot(normal,texture2D(normalTex,uv).xyz*2.-1.)));
          }
        }
        // RGB changes never darken coverage. Only silhouette dilation adds alpha.
        c.rgb*=1.-min(.85,de*depthStrength+ne*normalStrength*.5);
        c.rgb=mix(c.rgb,floor(clamp(c.rgb,0.,1.)*7.+.5)/7.,palette);
        if(outline>.5&&c.a<.01&&alphaNeighbor>.99)c=vec4(.044,.018,.013,1.);
        gl_FragColor=c;
      }`,
  });
  readonly quad = new FullScreenQuad(this.material);
  normalRenders = 0;
  constructor(
    readonly scene: Scene,
    readonly camera: Camera,
  ) {
    super();
    this.beauty.depthTexture = new DepthTexture(1, 1);
  }
  setStyle(style: PixelStyle) {
    const u = this.material.uniforms;
    u.outline.value = Number(style.outline);
    u.depthStrength.value = style.depthEdgeStrength;
    u.normalStrength.value = style.normalEdgeStrength;
    u.palette.value = style.paletteStrength;
  }
  override setSize(w: number, h: number) {
    this.beauty.setSize(w, h);
    this.normals.setSize(w, h);
    this.material.uniforms.texel.value.set(1 / w, 1 / h);
  }
  override render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget) {
    const old = this.scene.overrideMaterial;
    renderer.setRenderTarget(this.beauty);
    renderer.render(this.scene, this.camera);
    this.normalRenders = 0;
    if (this.material.uniforms.normalStrength.value > 0) {
      try {
        this.scene.overrideMaterial = this.normalMaterial;
        renderer.setRenderTarget(this.normals);
        renderer.render(this.scene, this.camera);
        this.normalRenders = 1;
      } finally {
        this.scene.overrideMaterial = old;
      }
    }
    const u = this.material.uniforms;
    u.colorTex.value = this.beauty.texture;
    u.depthTex.value = this.beauty.depthTexture;
    u.normalTex.value = this.normals.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  override dispose() {
    this.beauty.dispose();
    this.normals.dispose();
    this.material.dispose();
    this.normalMaterial.dispose();
    this.quad.dispose();
  }
}
