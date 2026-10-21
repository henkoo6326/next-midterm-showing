/* 기기 섹션(#cluster #center #mobile) 공용 합성 헬퍼
 *
 * 소유: cluster(⑤) 담당. center·mobile 담당은 import 해서 쓰기만 한다. 바꿀 일이 있으면 cluster 담당에게 보고.
 * 의존성 없음(three.js 를 부르지 않는다). 경로는 이 파일 위치(import.meta.url) 기준이라 GitHub Pages 하위 경로에서도 맞다.
 * 구조용 스타일은 모두 인라인으로 건다. 섹션 CSS 는 크기·모서리·그림자만 정하면 된다.
 *
 * ─ API ─────────────────────────────────────────────────────────────────────────
 *   assetUrl(path) → string
 *       사이트 루트 기준 경로('assets/captures/cluster_30000.png')를 절대 URL 로.
 *
 *   loadManifest() → Promise<object>
 *       assets/sections/manifest.json 을 한 번만 불러 캐시. 컷 id: cluster-context, cluster-close,
 *       center-context, center-front, cockpit-hero. 각 컷 { webp, png, w, h, screens:{center|cluster:[TL,TR,BR,BL]} }.
 *
 *   UI_SIZE  { cluster:{w:800,h:400}, center:{w:1280,h:720}, phone:{w:390,h:844} }   UI 설계 캔버스(CSS px)
 *   SLOT     { cluster:{w:1600,h:900}, center:{w:1280,h:720} }   렌더 구멍에 까는 요소 크기(3D 체험과 같음)
 *
 *   homography(pxW, pxH, quad) → number[16]
 *       site/js/xp/scene.js 와 같은 식. pxW×pxH 요소를 quad([[x,y]×4], TL TR BR BL) 에 맞추는 matrix3d 값.
 *
 *   placeQuad(el, pxW, pxH, quad)
 *       el 을 absolute(0,0), transform-origin 0 0 으로 두고 matrix3d 를 건다. 크기도 pxW×pxH 로 맞춘다.
 *
 *   screenNode(device, src, { alt = '' } = {}) → HTMLElement
 *       렌더 구멍 아래 깔 화면 요소. device 'cluster': 1600×900 검정 슬롯에 2:1 캡처를 폭 맞춤(위아래 50px 검정,
 *       3D 체험의 contain 과 같음). device 'center': 1280×720 에 캡처 그대로. src 는 2x 캡처 경로(사이트 루트 기준).
 *
 *   mountRender(stage, opts) → { cut, ready: Promise, update(), destroy() }
 *       stage(크기를 CSS 로 정한 요소) 안에 렌더 컷을 cover/contain 으로 깔고, 화면 구멍 아래 캡처를 matrix3d 로 맞춘다.
 *       opts = {
 *         cut: 'cluster-context',                  manifest 컷 id
 *         fit: 'cover' | 'contain',                기본 'cover'
 *         position: [0.5, 0.5],                    object-position 과 같은 뜻(0~1)
 *         screens: { cluster: 'assets/captures/cluster_30000.png', center: '…' },  구멍별 캡처(없으면 검정)
 *         focus: true,                             렌더 층에만 var(--render-focus) 필터(UI 층에는 걸지 않음)
 *         alt: '설명'                               stage 에 role=img + aria-label 로 붙인다(설명용 이미지)
 *       }
 *       stage 크기가 바뀌면(ResizeObserver) 다시 맞춘다. 표시 배율 s = cover ? max(W/w, H/h) : min(…),
 *       화면 좌표 = manifest 모서리 × s + 오프셋. stage 바탕은 --night(구멍 가장자리 1px 반투명이 검정 위로 섞이게).
 *       stage.dataset.renderState = 'ready' 가 되면 합성 완료(검증용).
 *
 *   cropShot({ src, ui, crop, alt, eager }) → HTMLElement(div.dv-crop)
 *       테 없는 평면 화면 조각. ui = {w,h} UI 캔버스, crop = [x0,y0,x1,y1](UI CSS px, 생략하면 전체).
 *       요소는 aspect-ratio 로 높이가 정해지고 폭은 섹션 CSS 가 정한다(반응형). 모서리·그림자는 섹션 CSS 에서.
 *       role=img + aria-label=alt. 눌리는 요소가 아니다(cursor 기본, 포인터 이벤트 없음).
 *
 *   whenNear(el, fn, margin = '100% 0px') → () => void(해제)
 *       el 이 뷰포트 근처에 오면 fn 을 한 번 부른다(지연 로드). IntersectionObserver 가 없으면 바로 부른다.
 *
 *   revealText(root)
 *       root 안 [data-reveal] 요소를 main.js 가 관찰하지 못했을 때를 위한 보조(이미 보이면 아무것도 안 함).
 * ──────────────────────────────────────────────────────────────────────────────── */

const ROOT = new URL('../../', import.meta.url);

export function assetUrl(path) {
  return new URL(path, ROOT).href;
}

export const UI_SIZE = Object.freeze({
  cluster: Object.freeze({ w: 800, h: 400 }),
  center: Object.freeze({ w: 1280, h: 720 }),
  phone: Object.freeze({ w: 390, h: 844 }),
});

export const SLOT = Object.freeze({
  cluster: Object.freeze({ w: 1600, h: 900 }),
  center: Object.freeze({ w: 1280, h: 720 }),
});

let manifestJob = null;
export function loadManifest() {
  if (!manifestJob) {
    manifestJob = fetch(assetUrl('assets/sections/manifest.json'))
      .then(r => { if (!r.ok) throw new Error(`manifest ${r.status}`); return r.json(); })
      .catch(err => { manifestJob = null; throw err; });
  }
  return manifestJob;
}

export function homography(pxW, pxH, q) {
  // 단위 정사각형 → 사각형(Heckbert), 입력을 요소 px 로 스케일. site/js/xp/scene.js homography 와 같은 식
  const [x0, y0] = q[0], [x1, y1] = q[1], [x2, y2] = q[2], [x3, y3] = q[3];
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let g = 0, h = 0;
  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
  }
  let a = x1 - x0 + g * x1, b = x3 - x0 + h * x3;
  const c = x0;
  let d = y1 - y0 + g * y1, e = y3 - y0 + h * y3;
  const f = y0;
  a /= pxW; d /= pxW; g /= pxW;
  b /= pxH; e /= pxH; h /= pxH;
  return [a, d, 0, g, b, e, 0, h, 0, 0, 1, 0, c, f, 0, 1];
}

export function placeQuad(el, pxW, pxH, quad) {
  const m = homography(pxW, pxH, quad).map(x => (Math.abs(x) < 1e-12 ? 0 : +x.toPrecision(10)));
  Object.assign(el.style, {
    position: 'absolute', left: '0', top: '0',
    width: pxW + 'px', height: pxH + 'px',
    transformOrigin: '0 0',
    transform: `matrix3d(${m.join(',')})`,
  });
}

function img(src, { alt = '', eager = false } = {}) {
  const el = document.createElement('img');
  el.decoding = 'async';
  el.loading = eager ? 'eager' : 'lazy';
  el.alt = alt;
  el.draggable = false;
  el.src = assetUrl(src);
  return el;
}

export function screenNode(device, src, { alt = '' } = {}) {
  const slot = SLOT[device];
  if (!slot) throw new Error(`screenNode: 모르는 기기 ${device}`);
  const box = document.createElement('div');
  box.className = `dv-screen dv-screen--${device}`;
  box.dataset.device = device;
  Object.assign(box.style, { width: slot.w + 'px', height: slot.h + 'px', background: '#000', overflow: 'hidden' });
  if (!src) return box;
  const im = img(src, { alt, eager: true });
  if (device === 'cluster') {
    // 16:9 슬롯 안 2:1 UI 를 폭 맞춤 contain: 1600×800, 위아래 50
    const ui = UI_SIZE.cluster;
    const h = slot.w * ui.h / ui.w;
    Object.assign(im.style, { position: 'absolute', left: '0', top: ((slot.h - h) / 2) + 'px', width: slot.w + 'px', height: h + 'px' });
  } else {
    Object.assign(im.style, { position: 'absolute', left: '0', top: '0', width: slot.w + 'px', height: slot.h + 'px' });
  }
  box.append(im);
  return box;
}

export function mountRender(stage, opts = {}) {
  const { cut: cutId, fit = 'cover', position = [0.5, 0.5], screens = {}, focus = true, alt = '' } = opts;
  stage.dataset.renderState = 'loading';
  Object.assign(stage.style, { position: stage.style.position || 'relative', overflow: 'hidden' });
  if (!getComputedStyle(stage).backgroundColor || getComputedStyle(stage).backgroundColor === 'rgba(0, 0, 0, 0)') {
    stage.style.background = 'var(--night, #0D1013)';
  }
  if (alt) { stage.setAttribute('role', 'img'); stage.setAttribute('aria-label', alt); }

  const art = document.createElement('div');
  art.className = 'dv-render__art';
  art.setAttribute('aria-hidden', 'true');
  Object.assign(art.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none' });
  const under = document.createElement('div');
  under.className = 'dv-render__screens';
  Object.assign(under.style, { position: 'absolute', inset: '0' });
  art.append(under);
  stage.append(art);

  let cut = null;
  let ro = null;
  const nodes = {};
  const api = { cut: null, update, destroy, ready: null };

  function update() {
    if (!cut) return;
    const W = stage.clientWidth, H = stage.clientHeight;
    if (!W || !H) return;
    const s = fit === 'contain' ? Math.min(W / cut.w, H / cut.h) : Math.max(W / cut.w, H / cut.h);
    const aw = cut.w * s, ah = cut.h * s;
    const left = (W - aw) * position[0], top = (H - ah) * position[1];
    Object.assign(art.style, { left: left + 'px', top: top + 'px', width: aw + 'px', height: ah + 'px' });
    for (const [device, node] of Object.entries(nodes)) {
      const quad = cut.screens[device].map(([x, y]) => [x * s, y * s]);
      placeQuad(node, SLOT[device].w, SLOT[device].h, quad);
    }
    stage.dataset.renderScale = s.toFixed(5);
  }

  function destroy() {
    if (ro) ro.disconnect();
    art.remove();
  }

  api.ready = loadManifest().then(manifest => {
    cut = manifest[cutId];
    if (!cut) throw new Error(`mountRender: manifest 에 ${cutId} 없음`);
    api.cut = cut;
    for (const [device, src] of Object.entries(screens)) {
      if (!cut.screens || !cut.screens[device] || !SLOT[device]) continue;
      const node = screenNode(device, src);
      nodes[device] = node;
      under.append(node);
    }
    const render = img(cut.webp, { eager: true });
    render.className = 'dv-render__img';
    Object.assign(render.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
    if (focus) render.style.filter = 'var(--render-focus, brightness(.78) saturate(.5))';
    art.append(render);
    update();
    if ('ResizeObserver' in window) { ro = new ResizeObserver(update); ro.observe(stage); }
    else window.addEventListener('resize', update);
    const loads = [render, ...stage.querySelectorAll('.dv-screen img')].map(im =>
      im.complete ? Promise.resolve() : new Promise(res => { im.addEventListener('load', res, { once: true }); im.addEventListener('error', res, { once: true }); }));
    return Promise.all(loads).then(() => { stage.dataset.renderState = 'ready'; return api; });
  }).catch(err => {
    stage.dataset.renderState = 'failed';
    console.error('[devices/common] 렌더 합성 실패', cutId, err);
    throw err;
  });
  return api;
}

export function cropShot({ src, ui, crop, alt = '', eager = false }) {
  const [x0, y0, x1, y1] = crop || [0, 0, ui.w, ui.h];
  const cw = x1 - x0, ch = y1 - y0;
  const box = document.createElement('div');
  box.className = 'dv-crop';
  if (alt) { box.setAttribute('role', 'img'); box.setAttribute('aria-label', alt); }
  Object.assign(box.style, { position: 'relative', overflow: 'hidden', aspectRatio: `${cw} / ${ch}`, cursor: 'default' });
  const im = img(src, { eager });
  im.setAttribute('aria-hidden', 'true');
  Object.assign(im.style, {
    position: 'absolute', display: 'block', maxWidth: 'none', pointerEvents: 'none', userSelect: 'none',
    width: (ui.w / cw * 100) + '%',
    height: (ui.h / ch * 100) + '%',
    left: (-x0 / cw * 100) + '%',
    top: (-y0 / ch * 100) + '%',
  });
  box.append(im);
  return box;
}

export function whenNear(el, fn, margin = '100% 0px') {
  if (!('IntersectionObserver' in window)) { fn(); return () => {}; }
  let done = false;
  const io = new IntersectionObserver(entries => {
    if (done) return;
    if (entries.some(e => e.isIntersecting)) { done = true; io.disconnect(); fn(); }
  }, { rootMargin: margin });
  io.observe(el);
  return () => io.disconnect();
}

export function revealText(root) {
  // main.js 의 observeReveal 이 partial 삽입 때 [data-reveal] 를 관찰한다. 관찰 밖에서 남은 요소가 영영 숨지 않게 1.5s 뒤 강제로 보인다
  setTimeout(() => {
    for (const el of root.querySelectorAll('[data-reveal]')) {
      if (getComputedStyle(el).opacity === '0' && el.getBoundingClientRect().top < innerHeight) el.classList.add('is-in');
    }
  }, 1500);
}
