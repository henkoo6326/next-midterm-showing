/* 3D 체험 장면: 차량 GLB, 창밖 배경 구, 조명, 카메라(기본 시점 ↔ 센터 집중 시점), CSS3D 펀치스루 화면, 레이캐스트, 렌더 루프
 *
 * 펀치스루: WebGL 캔버스(alpha, 투명 클리어) 아래에 CSS3DRenderer 레이어를 둔다. 화면 메시는 NoBlending + (0,0,0,0) 재질로
 * 바꿔 캔버스에 구멍을 내고, 그 자리에 같은 출처 iframe 을 CSS3DObject 로 붙인다. 손은 WebGL 로 그려 화면 위를 가린다.
 * 좌표: three(x,y,z) = blender(x,z,-y). 화면 메시 법선은 -Z(운전자 반대). UV (0,0) = 운전자가 보는 왼쪽 위.
 * 카메라 값은 docs/research/03_camera.json 그대로다. */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';

const SITE = new URL('../../', import.meta.url);
export const assetUrl = path => new URL(path, SITE).href;

/* ---------- 고정 값 (03_camera.json) ---------- */

export const VIEW = Object.freeze({
  eye: [-0.36024, 0.36039, 1.21840],
  quat: [-0.0714337, -0.0004620, -0.0000327, 0.9974452],
  hfovDeg: 71.508,
  shiftY: 0.019,          // 가로 폭 대비 세로 렌즈 시프트(Blender shift_y = -0.019). 내용이 위로 0.019·W px
  minAspect: 1.5,         // 이보다 좁으면 세로 FOV 를 고정하고 좌우를 자른다
  near: 0.01,
  far: 500,
});

export const FOCUS = Object.freeze({
  quat: [-0.151891, -0.151063, -0.023497, 0.976502], // center_focus_from_ref_eye
  target: [0.0, -0.01969, 0.08194],                  // 센터 화면 중심
  move: 0.18,                                        // 눈을 센터 쪽으로 옮기는 거리(최대 0.18 m)
  widthFrac: 0.55,                                   // 센터 화면이 뷰포트 폭에서 차지할 비율
});

export const ENV = Object.freeze({
  image4k: 'assets/env/learner_park_4k.jpg',
  image2k: 'assets/env/learner_park_2k.jpg',
  yawDeg: 0,               // experience 에서 덮어쓴다(ENV_YAW)
  radius: 120,
  saturation: 0.78,        // 창밖 저채도
  exposure: 1.12,          // 창밖 약간 과노출
});

/* 03_camera.json collision_aabbs_three (손 경로 검사용) */
export const COLLIDERS = Object.freeze({
  steering_rim: [[-0.571, -0.209, 0.284], [-0.175, 0.162, 0.402]],
  steering_hub_airbag: [[-0.461, -0.125, 0.313], [-0.286, 0.036, 0.398]],
  column_shroud: [[-0.432, -0.131, 0.074], [-0.314, 0.013, 0.32]],
  column_selector_wing: [[-0.324, -0.205, 0.024], [-0.163, -0.126, 0.108]],
  dash_main_shell: [[-0.846, -0.296, -0.565], [0.846, 0.054, -0.003]],
  driver_tray_lid: [[-0.69, -0.004, -0.32], [-0.258, 0.054, -0.12]],
  center_display_bezel: [[-0.154, -0.115, 0.064], [0.154, 0.074, 0.088]],
  cluster_bezel: [[-0.465, -0.046, 0.049], [-0.277, 0.075, 0.074]],
  centre_stack_casing: [[-0.157, -0.728, -0.169], [0.157, -0.254, 0.083]],
  rear_view_mirror_housing: [[-0.166, 0.539, 0.105], [0.098, 0.617, 0.215]],
});

/* ---------- 화면 평면 맞추기 ---------- */

/* 메시 정점 위치를 UV 의 1차식(O + u·A + v·B)으로 최소제곱 근사한다(로컬 좌표). 화면은 평면이고 UV 는 선형 투영이다 */
export function fitScreenLocal(geometry) {
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  // 정규방정식 [1 u v] 3x3
  let s1 = 0, su = 0, sv = 0, suu = 0, suv = 0, svv = 0;
  const rx = [0, 0, 0], ry = [0, 0, 0], rz = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    s1 += 1; su += u; sv += v; suu += u * u; suv += u * v; svv += v * v;
    const b = [1, u, v];
    for (let k = 0; k < 3; k++) { rx[k] += b[k] * x; ry[k] += b[k] * y; rz[k] += b[k] * z; }
  }
  const M = new THREE.Matrix3().set(s1, su, sv, su, suu, suv, sv, suv, svv).invert();
  const solve = r => new THREE.Vector3(...r).applyMatrix3(M);
  const cx = solve(rx), cy = solve(ry), cz = solve(rz);
  return {
    O: new THREE.Vector3(cx.x, cy.x, cz.x),
    A: new THREE.Vector3(cx.y, cy.y, cz.y),
    B: new THREE.Vector3(cx.z, cy.z, cz.z),
  };
}

function frameToWorld(local, matrixWorld) {
  const O = local.O.clone().applyMatrix4(matrixWorld);
  const A = local.O.clone().add(local.A).applyMatrix4(matrixWorld).sub(O);
  const B = local.O.clone().add(local.B).applyMatrix4(matrixWorld).sub(O);
  const normal = new THREE.Vector3().crossVectors(B, A).normalize(); // 운전자 쪽
  return { O, A, B, normal };
}

/* CSS3DObject 행렬: 요소 px(W×H)을 화면 네 모서리에 맞춘다. 요소 +x = A 방향, 요소 아래 = B 방향 */
function cssMatrixFor(frame, pxW, pxH, out = new THREE.Matrix4()) {
  const X = frame.A.clone().divideScalar(pxW);
  const Y = frame.B.clone().divideScalar(-pxH); // CSS3DRenderer 는 객체 +Y 를 화면 위로 본다
  const Z = new THREE.Vector3().crossVectors(X, Y).normalize().multiplyScalar(X.length());
  const C = frame.O.clone().addScaledVector(frame.A, 0.5).addScaledVector(frame.B, 0.5);
  out.makeBasis(X, Y, Z);
  out.setPosition(C);
  return out;
}

/* 화면 레이어(기본): 화면 네 모서리를 매 프레임 투영해 요소에 사영변환 matrix3d 를 건다.
   CSS3DRenderer 와 같은 결과(원근 정확)지만 preserve-3d 3D 렌더링 컨텍스트를 만들지 않는다.
   측정: CSS3DRenderer 는 WebGL 캔버스가 매 프레임 바뀌면 합성 비용이 커서 1600×900 에서 13~34fps, 이 방식은 docs/XP_TIMING.md 참고 */
export function homography(pxW, pxH, q) {
  // 단위 정사각형 → 사각형(Heckbert), 입력을 요소 px 로 스케일
  const [x0, y0] = q[0], [x1, y1] = q[1], [x2, y2] = q[2], [x3, y3] = q[3];
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let a, b, c, d, e, f, g = 0, h = 0;
  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
  }
  a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; c = x0;
  d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; f = y0;
  a /= pxW; d /= pxW; g /= pxW;
  b /= pxH; e /= pxH; h /= pxH;
  return [a, d, 0, g, b, e, 0, h, 0, 0, 1, 0, c, f, 0, 1];
}

class ScreenLayer {
  constructor() {
    this.domElement = document.createElement('div');
    this.items = [];
    this.size = { w: 1, h: 1 };
  }
  setSize(w, h) { this.size = { w, h }; this.domElement.style.width = w + 'px'; this.domElement.style.height = h + 'px'; }
  add(item) {
    const el = item.element;
    el.style.position = 'absolute';
    el.style.left = '0';
    el.style.top = '0';
    el.style.transformOrigin = '0 0';
    el.style.backfaceVisibility = 'hidden';
    this.domElement.append(el);
    item.last = '';
    this.items.push(item);
  }
  update(camera) {
    const { w, h } = this.size;
    const v = new THREE.Vector4();
    for (const item of this.items) {
      const frame = item.frame();
      if (!frame) { if (item.last !== 'none') { item.element.style.display = 'none'; item.last = 'none'; } continue; }
      const corners = [frame.O, frame.O.clone().add(frame.A), frame.O.clone().add(frame.A).add(frame.B), frame.O.clone().add(frame.B)];
      const q = [];
      let behind = false;
      for (const p of corners) {
        v.set(p.x, p.y, p.z, 1).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
        if (v.w <= 0.02) { behind = true; break; }
        q.push([(v.x / v.w + 1) / 2 * w, (1 - v.y / v.w) / 2 * h]);
      }
      // 화면 밖(네 모서리가 모두 한쪽 바깥) 이거나 투영이 비정상적으로 크면 숨긴다(거대한 래스터·GPU 메모리 방지)
      if (!behind) {
        const xs = q.map(p => p[0]), ys = q.map(p => p[1]);
        const lim = 6 * Math.max(w, h);
        if (Math.max(...xs) < 0 || Math.min(...xs) > w || Math.max(...ys) < 0 || Math.min(...ys) > h) behind = true;
        else if (xs.some(x => Math.abs(x) > lim) || ys.some(y => Math.abs(y) > lim)) behind = true;
      }
      if (behind) { if (item.last !== 'none') { item.element.style.display = 'none'; item.last = 'none'; } continue; }
      const m = homography(item.pxW, item.pxH, q).map(x => (Math.abs(x) < 1e-12 ? 0 : +x.toPrecision(10)));
      const style = `matrix3d(${m.join(',')})`;
      if (style !== item.last) {
        if (item.last === 'none' || item.last === '') item.element.style.display = '';
        item.element.style.transform = style;
        item.last = style;
      }
    }
  }
}

/* ---------- 라이트맵 비교(?lightmap=1) ----------
 * assets/models/lightmaps/lightmaps.json 의 recommended 와 scripts/bake/preview_lm.html 을 그대로 따른다.
 *   텍스처: channel 1(uv1), SRGB, flipY false, 밉맵 끔(Linear), lightMapIntensity = π · scale · gain
 *   환경: scene.environment = learner_park HDR 을 배경 구와 같은 지오메트리·회전(yaw)으로 입힌 장면의 PMREM, 세기 1.0(?lmenv=)
 *   톤: AgX, 노출 1.3 기본(?lmexp=). 라이트맵 면은 IBL 확산 0 + 라이트맵으로 반사 가림(셰이더 패치)
 *   직접광: 사이트의 Hemisphere·Directional 은 주행 세계·손·폰 때문에 그대로 둔다. 대신 라이트맵 면에서만 직접광 확산과
 *           반구광(irradiance)을 셰이더에서 0 으로 만든다(라이트맵이 확산 전부를 담고 있어 두 번 밝아지지 않게)
 *   손·폰: material.envMap 에 같은 HDR PMREM, envMapIntensity 0.55(applyDynamic)
 * 비교용으로만 둔다: ?lightmap=1 일 때만 불린다. 기본은 cockpit_v8.glb 와 기존 조명(v2 계약: PV5 v8 외형·재질 보존, 라이트맵 산출물 미사용).
 * 2026-10-21 04시에 기본값으로 바꿨던 것을 같은 날 통합 검수(R2-REQ-01·RT2-01)에 따라 되돌렸다 */
const LIGHTMAP = Object.freeze({
  model: 'assets/models/cockpit_v8_lm.glb',
  json: 'assets/models/lightmaps/lightmaps.json',
  dir: 'assets/models/lightmaps/',
  hdr: 'assets/env/learner_park_1k.hdr',
  exposure: 1.3,
  envIntensity: 1.0,
  dynamicEnv: 0.55,
});

async function setupLightmap({ renderer, scene, model, envYawDeg }) {
  const Q = new URLSearchParams(location.search);
  const num = (k, d) => { const v = parseFloat(Q.get(k)); return Number.isFinite(v) ? v : d; };
  const exposure = num('lmexp', LIGHTMAP.exposure);
  const envIntensity = num('lmenv', LIGHTMAP.envIntensity);
  const gain = num('lmgain', 1);
  const lm = await (await fetch(assetUrl(LIGHTMAP.json))).json();
  const loader = new THREE.TextureLoader();
  const texs = await Promise.all(lm.maps.map(async m => {
    const t = await loader.loadAsync(assetUrl(LIGHTMAP.dir + m.file + (m.sha256 ? '?v=' + m.sha256 : '')));
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false;
    t.channel = 1;
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }));
  const { HDRLoader } = await import('three/addons/loaders/HDRLoader.js');
  const hdr = await new HDRLoader().loadAsync(assetUrl(LIGHTMAP.hdr));
  const envScene = new THREE.Scene();
  const g = new THREE.SphereGeometry(ENV.radius, 96, 48);
  g.scale(-1, 1, 1);
  const sphere = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: hdr, depthWrite: false, toneMapped: false }));
  sphere.position.set(...VIEW.eye);
  sphere.rotation.y = THREE.MathUtils.degToRad(envYawDeg);
  envScene.add(sphere);
  const pm = new THREE.PMREMGenerator(renderer);
  const envTex = pm.fromScene(envScene, 0, 0.1, 1000).texture;
  pm.dispose(); g.dispose(); sphere.material.dispose(); hdr.dispose();
  scene.environment = envTex;
  scene.environmentIntensity = envIntensity;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = exposure;

  const clones = new Map();
  let applied = 0;
  const missing = [];
  model.traverse(o => {
    if (!o.isMesh || /^SCREEN_/.test(o.name) || Array.isArray(o.material)) return;
    const info = lm.meshes[o.name];
    if (!info) return;
    if (!o.geometry.attributes.uv1) { missing.push(o.name); return; }
    const src = o.material;
    const key = src.uuid + '|' + info.map;
    let m = clones.get(key);
    if (!m) {
      m = src.clone();
      m.lightMap = texs[info.map];
      m.lightMapIntensity = Math.PI * lm.maps[info.map].scale * gain;
      m.onBeforeCompile = s => {
        s.fragmentShader = s.fragmentShader.replace('#include <lights_fragment_maps>', `
          #if defined( RE_IndirectDiffuse ) && defined( USE_LIGHTMAP )
            reflectedLight.directDiffuse = vec3( 0.0 );   // 직접광 확산 제거(라이트맵이 대신)
            irradiance = vec3( 0.0 );                     // 반구광·주변광 제거
          #endif
          #include <lights_fragment_maps>
          #if defined( USE_LIGHTMAP ) && defined( USE_ENVMAP ) && defined( STANDARD )
          {
            vec3 lumW = vec3( 0.2126, 0.7152, 0.0722 );
            float envL = dot( iblIrradiance, lumW ) / max( envMapIntensity, 1e-4 );
            float lmL = dot( texture2D( lightMap, vLightMapUv ).rgb * lightMapIntensity, lumW );
            radiance *= clamp( lmL / max( envL, 1e-4 ), 0.0, 1.0 );   // 라이트맵으로 반사 가리기
            iblIrradiance *= 0.0;                                      // IBL 확산 끄기(라이트맵이 대신)
          }
          #endif`);
      };
      m.customProgramCacheKey = () => 'xp-lm-v1';
      clones.set(key, m);
    }
    o.material = m;
    applied++;
  });

  return {
    applied, missing, exposure, envIntensity, gain, maps: lm.maps.length, envTexture: envTex,
    /* 움직이는 물체(손·폰): 같은 HDR 반사를 재질에 직접 넣는다 */
    applyDynamic(roots) {
      let n = 0;
      for (const root of [].concat(roots || [])) {
        root?.traverse(o => {
          if (!o.isMesh) return;
          for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
            if (!m || !m.isMeshStandardMaterial) continue;
            m.envMap = envTex;
            m.envMapIntensity = LIGHTMAP.dynamicEnv;
            m.needsUpdate = true;
            n++;
          }
        });
      }
      this.dynamic = n;
      return n;
    },
  };
}

/* ---------- 장면 ---------- */

export async function createScene({ viewport, onProgress = () => {}, envYawDeg = 0, debug = false }) {
  const stage = viewport;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.className = 'xp-gl';

  // 화면 레이어: 기본은 사영변환(ScreenLayer). ?xpscreens=css3d 면 CSS3DRenderer(비교용)
  const useCSS3D = new URLSearchParams(location.search).get('xpscreens') === 'css3d';
  const css = useCSS3D ? new CSS3DRenderer() : new ScreenLayer();
  css.domElement.className = 'xp-css';
  stage.append(css.domElement, renderer.domElement);

  const scene = new THREE.Scene();
  const cssScene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, VIEW.near, VIEW.far);

  /* 조명: v8 app.js 와 같은 구성(RoomEnvironment PMREM 0.72, Hemisphere 1.25, Directional 2.4) */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envRT = pmrem.fromScene(room, 0.035);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.72;
  room.dispose();
  pmrem.dispose();
  const hemi = new THREE.HemisphereLight('#eaf2fb', '#9aa49e', 1.15);
  const sun = new THREE.DirectionalLight('#fff6e8', 2.1);
  sun.position.set(-5.5, 9, -5);
  sun.target.position.set(0, -0.25, -0.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -2.5, right: 2.5, top: 2.5, bottom: -2.5, near: 0.1, far: 22 });
  sun.shadow.normalBias = 0.015;
  sun.shadow.bias = -0.00015;
  scene.add(hemi, sun, sun.target);

  /* 로더 */
  const draco = new DRACOLoader();
  draco.setDecoderPath(assetUrl('vendor/three/draco/'));
  const gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(draco);

  const progress = { model: 0, env: 0 };
  const report = () => onProgress(progress);

  const loadGLB = (path, key) => new Promise((resolve, reject) => {
    gltfLoader.load(assetUrl(path), gltf => { if (key) { progress[key] = 1; report(); } resolve(gltf); },
      e => { if (key && e.lengthComputable) { progress[key] = e.loaded / e.total; report(); } },
      reject);
  });

  /* 창밖: 큰 구(안쪽 면)에 등장방형 사진. 구 중심 = 기본 시점 눈 위치 → 지평선이 눈높이에 온다 */
  // ImageBitmap 은 메인 스레드 밖에서 디코딩한다. TextureLoader(<img>)는 첫 업로드 때 메인 스레드에서 디코딩해
  // 4096×2048 한 장에 약 0.3s 멈췄다(통합 검수 RT-03). 방향은 TextureLoader 기본(flipY)과 같게 비트맵을 뒤집어 만든다
  const envTexture = await new Promise((resolve, reject) => {
    const small = window.innerWidth < 900;
    const url = assetUrl(small ? ENV.image2k : ENV.image4k);
    const done = t => { progress.env = 1; report(); resolve(t); };
    const viaImage = () => new THREE.TextureLoader().load(url, done, undefined, reject);
    if (typeof createImageBitmap !== 'function') { viaImage(); return; }
    const loader = new THREE.ImageBitmapLoader();
    loader.setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none' });
    loader.load(url, bitmap => {
      const t = new THREE.Texture(bitmap);
      t.flipY = false;
      t.needsUpdate = true;
      done(t);
    }, undefined, viaImage);
  });
  envTexture.colorSpace = THREE.SRGBColorSpace;
  envTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const envGeo = new THREE.SphereGeometry(ENV.radius, 96, 48);
  envGeo.scale(-1, 1, 1); // 안쪽에서 봐도 좌우가 뒤집히지 않게
  const envMat = new THREE.MeshBasicMaterial({ map: envTexture, depthWrite: false, toneMapped: false, fog: false });
  /* uHaze/uHazeColor: 첫 배송지 주행(drive.js)에서 출발지 창밖을 안개색으로 넘길 때만 쓴다. uHaze 0 이면 기존과 같은 색 */
  const envUniforms = {
    uSat: { value: ENV.saturation },
    uExp: { value: ENV.exposure },
    uHaze: { value: 0 },
    uHazeColor: { value: new THREE.Color(1, 1, 1) },
  };
  envMat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, envUniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSat;\nuniform float uExp;\nuniform float uHaze;\nuniform vec3 uHazeColor;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float l = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = mix(vec3(l), diffuseColor.rgb, uSat) * uExp;
        diffuseColor.rgb = mix(diffuseColor.rgb, uHazeColor, uHaze);`);
  };
  const envMesh = new THREE.Mesh(envGeo, envMat);
  envMesh.position.set(...VIEW.eye);
  envMesh.rotation.y = THREE.MathUtils.degToRad(envYawDeg);
  envMesh.renderOrder = -10;
  envMesh.frustumCulled = false;
  envMesh.name = 'ENV_SPHERE';
  scene.add(envMesh);

  /* 차량(?lightmap=1 이면 라이트맵 UV 가 든 cockpit_v8_lm.glb, 아니면 지금과 같은 cockpit_v8.glb) */
  // 라이트맵·재질 디테일(materials.js)은 ?lightmap=1 비교 모드에서만. 기본은 cockpit_v8.glb(통합 검수 R2-REQ-01)
  const useLightmap = new URLSearchParams(location.search).get('lightmap') === '1';
  const gltf = await loadGLB(useLightmap ? LIGHTMAP.model : 'assets/models/cockpit_v8.glb', 'model');
  const model = gltf.scene;
  scene.add(model);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const punchMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000, opacity: 0, transparent: false, blending: THREE.NoBlending,
    side: THREE.DoubleSide, toneMapped: false, depthWrite: true,
  });
  punchMaterial.name = 'PUNCH_THROUGH';
  const screens = {};
  const occluders = [];
  /* 배지(핸들 허브·앞 범퍼의 로고 판, 'BADGE · emblem mask' 알파 텍스처 평면)는 GLB 재질을 그대로 쓴다(원 v8/web/app.js 와 같음).
     판이 허브 면에 거의 붙어 있어 깊이 다툼(z-fighting)이 나지 않게 polygonOffset 으로 앞으로 당기고, 반투명 판은 깊이를 쓰지 않는다 */
  model.traverse(obj => {
    if (!obj.isMesh) return;
    for (const m of (Array.isArray(obj.material) ? obj.material : [obj.material])) {
      if (!m || !/BADGE|logo/i.test(m.name)) continue;
      m.polygonOffset = true;
      m.polygonOffsetFactor = -2;
      m.polygonOffsetUnits = -2;
      if (m.transparent) m.depthWrite = false;
      obj.renderOrder = 1;
    }
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!m) continue;
      for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
        if (m[slot]) m[slot].anisotropy = maxAniso;
      }
    }
    obj.castShadow = !mats.every(m => m.transparent && m.opacity < 0.3);
    obj.receiveShadow = true;
    if (obj.name === 'SCREEN_CENTER' || obj.name === 'SCREEN_CLUSTER') {
      // GLB 안의 옛 UI 텍스처는 쓰지 않는다
      obj.material = punchMaterial;
      obj.castShadow = false;
      obj.receiveShadow = false;
      const key = obj.name === 'SCREEN_CENTER' ? 'center' : 'cluster';
      screens[key] = { mesh: obj, local: fitScreenLocal(obj.geometry) };
    }
    if (!(mats.every(m => m.transparent && m.opacity < 0.3))) occluders.push(obj);
  });
  model.updateMatrixWorld(true);
  for (const s of Object.values(screens)) s.frame = frameToWorld(s.local, s.mesh.matrixWorld);
  renderer.shadowMap.needsUpdate = true;
  let lightmap = null;
  if (useLightmap) {
    try { lightmap = await setupLightmap({ renderer, scene, model, envYawDeg }); }
    catch (err) { console.warn('[xp] 라이트맵 적용 실패(기본 조명으로 둔다)', err); }
    // 실내 재질 디테일(가죽·TPO·원단 결, materials.js). 실패해도 라이트맵 장면은 그대로 둔다
    if (lightmap) {
      try { lightmap.detail = await (await import('./materials.js')).applyMaterialDetail({ THREE, renderer, model, assetUrl }); }
      catch (err) { console.warn('[xp] 재질 디테일 생략', err); }
    }
  }

  /* ---------- 카메라 ---------- */

  const qDefault = new THREE.Quaternion(...VIEW.quat).normalize();
  const qFocus = new THREE.Quaternion(...FOCUS.quat).normalize();
  const eyeDefault = new THREE.Vector3(...VIEW.eye);
  const focusTarget = new THREE.Vector3(...FOCUS.target);
  const eyeFocus = eyeDefault.clone().addScaledVector(focusTarget.clone().sub(eyeDefault).normalize(), FOCUS.move);
  let size = { w: 1, h: 1 };
  let blend = 0; // 0 기본 시점, 1 센터 집중
  let focusTanH = 0.25;
  const tanDefault = Math.tan(THREE.MathUtils.degToRad(VIEW.hfovDeg / 2));

  function computeFocusTan() {
    // 센터 화면 네 모서리를 집중 시점 카메라 공간으로 옮겨 폭 비율이 widthFrac 이 되는 tan(hfov/2) 를 구한다
    const f = screens.center.frame;
    const inv = new THREE.Matrix4().compose(eyeFocus, qFocus, new THREE.Vector3(1, 1, 1)).invert();
    const xs = [f.O, f.O.clone().add(f.A), f.O.clone().add(f.B), f.O.clone().add(f.A).add(f.B)].map(p => {
      const c = p.clone().applyMatrix4(inv);
      return c.x / -c.z;
    });
    focusTanH = (Math.max(...xs) - Math.min(...xs)) / (2 * FOCUS.widthFrac);
  }

  let debugCam = null; // 검수용 측면 카메라 { pos:[x,y,z], target:[x,y,z], fov }
  function applyCamera() {
    const aspect = size.w / size.h;
    if (debugCam) {
      camera.clearViewOffset();
      camera.position.set(...debugCam.pos);
      camera.up.set(0, 1, 0);
      camera.lookAt(...debugCam.target);
      camera.fov = debugCam.fov || 40;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      return;
    }
    const k = blend;
    camera.position.lerpVectors(eyeDefault, eyeFocus, k);
    camera.quaternion.slerpQuaternions(qDefault, qFocus, k);
    // 가로 FOV 는 tan 공간에서 보간. 좁은 화면은 minAspect 기준 세로 FOV 로 고정
    const tanH = THREE.MathUtils.lerp(tanDefault, focusTanH, k);
    const fovAspect = Math.max(aspect, VIEW.minAspect);
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tanH / fovAspect));
    camera.aspect = aspect;
    camera.near = VIEW.near;
    camera.far = VIEW.far;
    // 세로 렌즈 시프트: 기본 시점에서만, 집중 시점으로 갈수록 0
    const shiftPx = VIEW.shiftY * fovAspect * size.h * (1 - k);
    camera.setViewOffset(size.w, size.h, 0, shiftPx, size.w, size.h);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }

  function resize() {
    const r = stage.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    if (w === size.w && h === size.h) return;
    size = { w, h };
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = w + 'px';
    renderer.domElement.style.height = h + 'px';
    css.setSize(w, h);
    applyCamera();
    requestRender();
  }

  computeFocusTan();

  /* ---------- CSS3D 화면 ---------- */

  const cssItems = [];
  function attachStatic(name, element, pxW, pxH) {
    const s = screens[name];
    element.style.width = pxW + 'px';
    element.style.height = pxH + 'px';
    const item = { name, pxW, pxH, dynamic: false, element };
    if (useCSS3D) {
      const obj = new CSS3DObject(element);
      obj.matrixAutoUpdate = false;
      cssMatrixFor(s.frame, pxW, pxH, obj.matrix);
      obj.matrixWorldNeedsUpdate = true;
      cssScene.add(obj);
      item.obj = obj;
    } else {
      item.frame = () => s.frame;
      css.add(item);
    }
    cssItems.push(item);
    return item;
  }
  /* 움직이는 메시(폰 화면)에 붙인다. 매 프레임 메시 행렬로 갱신 */
  function attachDynamic(name, mesh, element, pxW, pxH) {
    const local = fitScreenLocal(mesh.geometry);
    element.style.width = pxW + 'px';
    element.style.height = pxH + 'px';
    const item = { name, pxW, pxH, dynamic: true, mesh, local, element };
    const shown = () => { for (let p = mesh; p; p = p.parent) if (p.visible === false) return false; return true; };
    if (useCSS3D) {
      item.localMatrix = cssMatrixFor(local, pxW, pxH);
      const obj = new CSS3DObject(element);
      obj.matrixAutoUpdate = false;
      cssScene.add(obj);
      item.obj = obj;
    } else {
      item.frame = () => (shown() ? frameToWorld(local, mesh.matrixWorld) : null);
      css.add(item);
    }
    item.shown = shown;
    cssItems.push(item);
    return item;
  }
  function syncDynamic() {
    if (!useCSS3D) return;
    for (const item of cssItems) {
      if (!item.dynamic) continue;
      const visible = item.shown();
      item.obj.visible = visible;
      if (!visible) continue;
      item.obj.matrix.multiplyMatrices(item.mesh.matrixWorld, item.localMatrix);
      item.obj.matrixWorldNeedsUpdate = true;
    }
  }
  function renderScreens() {
    if (useCSS3D) css.render(cssScene, camera);
    else { scene.updateMatrixWorld(); css.update(camera); }
  }
  /* 동적 화면의 현재 월드 프레임 */
  function dynamicFrame(item) {
    return frameToWorld(item.local, item.mesh.matrixWorld);
  }

  /* ---------- 레이캐스트 ---------- */

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function raycast(clientX, clientY, objects, recursive = true) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(objects, recursive);
    const shown = o => { for (let p = o; p; p = p.parent) if (p.visible === false) return false; return true; };
    return hits.find(h => shown(h.object) && h.object.material?.visible !== false) || null;
  }

  /* 월드 점 → 스테이지 px */
  function project(point) {
    const v = point.clone().project(camera);
    return { x: (v.x + 1) / 2 * size.w, y: (1 - v.y) / 2 * size.h, z: v.z };
  }

  /* ---------- 렌더 루프 ---------- */

  const frameFns = new Set();
  let raf = 0;
  let active = false;       // 섹션이 보이는가
  let continuous = false;   // 연속 렌더가 필요한가(체험 진행 중)
  let dirty = true;
  const stats = { frames: 0, last: 0, samples: [] };

  function renderNow(now = performance.now()) {
    for (const fn of frameFns) fn(now);
    syncDynamic();
    renderer.render(scene, camera);
    renderScreens();
    dirty = false;
    if (stats.last) {
      stats.samples.push(now - stats.last);
      if (stats.samples.length > 600) stats.samples.shift();
    }
    stats.last = now;
    stats.frames++;
  }
  function loop(now) {
    raf = 0;
    if (!active || document.hidden) { stats.last = 0; return; }
    if (continuous || dirty) renderNow(now); else stats.last = 0;
    raf = requestAnimationFrame(loop);
  }
  function kick() { if (!raf && active && !document.hidden) raf = requestAnimationFrame(loop); }
  function requestRender() { dirty = true; kick(); }
  /* 섹션이 화면 밖이면 렌더 루프를 멈추고(아래 loop), 화면 레이어를 visibility:hidden 으로 둬 iframe 그리기·합성도 멈춘다.
     display:none 은 쓰지 않는다(iframe 안 배치가 0 크기가 되어 rectOf 좌표가 틀어진다) */
  function setActive(v) {
    active = v;
    css.domElement.style.visibility = v ? '' : 'hidden';
    if (v) { dirty = true; kick(); }
  }
  function setContinuous(v) { continuous = v; if (v) kick(); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) requestRender(); });

  const ro = new ResizeObserver(() => resize());
  ro.observe(stage);
  resize();
  applyCamera();

  return {
    THREE, renderer, css, scene, cssScene, camera, renderScreens, useCSS3D, model, screens, occluders, envMesh, envUniforms, gltfLoader, loadGLB, lightmap,
    get size() { return size; },
    get active() { return active; },
    get blend() { return blend; },
    setBlend(k) { blend = Math.min(1, Math.max(0, k)); applyCamera(); requestRender(); },
    setDebugCamera(v) { debugCam = v || null; applyCamera(); requestRender(); },
    eyeDefault, eyeFocus, qDefault, qFocus,
    attachStatic, attachDynamic, dynamicFrame,
    raycast, project,
    onFrame(fn) { frameFns.add(fn); return () => frameFns.delete(fn); },
    requestRender, setActive, setContinuous, renderNow,
    stats,
    setEnvYaw(deg) { envMesh.rotation.y = THREE.MathUtils.degToRad(deg); requestRender(); },
    uvToWorld(name, u, v) {
      const f = screens[name].frame;
      return f.O.clone().addScaledVector(f.A, u).addScaledVector(f.B, v);
    },
    dispose() {
      ro.disconnect();
      cancelAnimationFrame(raf);
      renderer.dispose();
      draco.dispose();
    },
  };
}
