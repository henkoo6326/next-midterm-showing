/* 3D 맥락 렌더(assets/sections/*.webp) 위에 현재 NEXT UI 캡처를 화면 구멍에 맞춰 합성한다
 *
 *   <div class="cmp" data-compose="cockpit-hero" data-place="intro|cover" data-pos="42 55" data-focus
 *        data-ui-cluster="assets/front/cap/cluster_40000.webp" data-ui-center="assets/front/cap/center_40000.webp">
 *
 * 층 순서(아래 → 위): 검은 바탕(화면 구멍보다 조금 넓게) → UI 캡처(matrix3d) → 렌더(구멍이 알파 0)
 *   - 렌더의 핸들 림이 화면 모서리를 가리는 부분은 렌더가 위에 있어 그대로 가려진다
 *   - 구멍 가장자리 1px 반투명 띠에는 검은 바탕이 비친다(manifest _meta.compose)
 *   - data-focus 가 있으면 렌더 층에만 --render-focus 필터(UI 층에는 걸지 않음)
 * 좌표: assets/sections/manifest.json 의 screens(TL TR BR BL, 이미지 px). 클러스터 UI(2:1)는 clusterContent 사각형에,
 *       센터 UI(16:9)는 screens.center 에 그대로. 사영변환은 js/xp/scene.js homography 와 같은 식(Heckbert)이다
 * 배치(data-place)
 *   intro: 렌더 폭 = 호스트 폭 × 1.25, 왼쪽 -20%, 렌더의 cutY(배지 위) 가 호스트 아래 변에 오게. 호스트가 아래를 자른다
 *   cover: object-fit: cover + object-position(data-pos, %)
 * 크기가 바뀌면(ResizeObserver) 다시 계산한다. 이미지 요소의 크기만 바꾸고 UI 는 최종 화면 px 기준 matrix3d 하나로 그린다 */

const MANIFEST_URL = new URL('../../assets/sections/manifest.json', import.meta.url);
const SITE = new URL('../../', import.meta.url);
const UI_SIZE = { cluster: [800, 400], center: [1280, 720] };

let manifestJob = null;
function loadManifest() {
  if (!manifestJob) {
    manifestJob = fetch(MANIFEST_URL, { cache: 'no-cache' }).then(r => {
      if (!r.ok) throw new Error('sections manifest ' + r.status);
      return r.json();
    });
  }
  return manifestJob;
}

export function homography(pxW, pxH, q) {
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
  let d = y1 - y0 + g * y1, e = y3 - y0 + h * y3;
  const c = x0, f = y0;
  a /= pxW; d /= pxW; g /= pxW;
  b /= pxH; e /= pxH; h /= pxH;
  return [a, d, 0, g, b, e, 0, h, 0, 0, 1, 0, c, f, 0, 1];
}

const m3d = m => `matrix3d(${m.map(x => (Math.abs(x) < 1e-12 ? 0 : +x.toPrecision(10))).join(',')})`;

/* 사각형을 중심에서 바깥으로 px 만큼 넓힌다(검은 바탕용) */
function grow(q, px) {
  const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
  return q.map(([x, y]) => {
    const dx = x - cx, dy = y - cy, len = Math.hypot(dx, dy) || 1;
    return [x + dx / len * px, y + dy / len * px];
  });
}

/* 렌더 사각형(호스트 기준 css px): { x, y, w } */
function placeRect(host, cut, mode) {
  const W = host.clientWidth, H = host.clientHeight;
  const aspect = cut.h / cut.w;
  if (mode === 'intro') {
    const narrow = W < 900;
    const w = W * (narrow ? 1.5 : 1.25);
    const x = W * (narrow ? -0.35 : -0.2);
    const cutY = Number(host.dataset.cutY || cut.introCutY || 0.79);   // 렌더 높이 대비: 배지 위(구멍 아래 변 0.773 ~ 배지 윗변 0.801)
    const y = H - cutY * w * aspect;
    return { x, y, w };
  }
  // cover
  const [px, py] = String(host.dataset.pos || '50 50').split(/\s+/).map(v => Number(v) / 100);
  const s = Math.max(W / cut.w, H / cut.h);
  const w = cut.w * s, h = cut.h * s;
  return { x: (W - w) * (isFinite(px) ? px : 0.5), y: (H - h) * (isFinite(py) ? py : 0.5), w };
}

function build(host, cut, id) {
  host.classList.add('cmp-ready');
  const rect = document.createElement('div');
  rect.className = 'cmp-rect';
  const layers = [];
  for (const dev of ['cluster', 'center']) {
    const src = host.dataset['ui' + dev[0].toUpperCase() + dev.slice(1)];
    if (!src || !cut.screens || !cut.screens[dev]) continue;
    const quad = dev === 'cluster' && cut.clusterContent ? cut.clusterContent : cut.screens[dev];
    const under = document.createElement('div');
    under.className = 'cmp-under';
    const ui = document.createElement('img');
    ui.className = 'cmp-ui';
    ui.alt = '';
    ui.decoding = 'async';
    ui.src = new URL(src, SITE).href;
    const [uw, uh] = UI_SIZE[dev];
    ui.width = uw; ui.height = uh;
    ui.style.width = uw + 'px';
    ui.style.height = uh + 'px';
    rect.append(under, ui);
    layers.push({ dev, under, ui, uw, uh, quad, hole: cut.screens[dev] });
  }
  const img = document.createElement('img');
  img.className = 'cmp-render';
  img.alt = '';
  img.decoding = 'async';
  img.width = cut.w; img.height = cut.h;
  img.src = new URL(cut.webp || cut.png, SITE).href;
  if (host.dataset.place === 'intro') img.fetchPriority = 'high';
  if ('focus' in host.dataset) img.classList.add('is-focus');
  rect.append(img);
  host.append(rect);

  const layout = () => {
    const r = placeRect(host, cut, host.dataset.place);
    if (!(r.w > 0)) return;
    const s = r.w / cut.w;
    const h = cut.h * s;
    rect.style.left = r.x + 'px';
    rect.style.top = r.y + 'px';
    rect.style.width = r.w + 'px';
    rect.style.height = h + 'px';
    for (const L of layers) {
      const q = L.quad.map(([x, y]) => [x * s, y * s]);
      L.ui.style.transform = m3d(homography(L.uw, L.uh, q));
      const hq = grow(L.hole.map(([x, y]) => [x * s, y * s]), 2);
      L.under.style.width = '100px';
      L.under.style.height = '100px';
      L.under.style.transform = m3d(homography(100, 100, hq));
    }
    host.dataset.composed = id;
  };
  layout();
  new ResizeObserver(layout).observe(host);
  revealWhenDecoded(host, rect, img, layers.map(L => L.ui));
  return { layout };
}

/* 렌더와 UI 캡처의 디코드가 모두 끝나면 한 번에 보인다(css .cmp-rect.is-shown, --dur-crossfade).
 * 렌더가 늦게 오면 검은 바탕(.cmp-under)만 먼저 보이는 일을 막는다. UI 캡처가 실패해도 렌더가 되면 보이고,
 * 렌더가 실패하면 계속 숨긴다(호스트에 cmp-failed). 끝없이 기다리지 않도록 10초 뒤에는 렌더가 있으면 보인다 */
const decoded = el => {
  if (el.complete && el.naturalWidth > 0) return el.decode ? el.decode().then(() => true, () => true) : Promise.resolve(true);
  return new Promise(res => {
    el.addEventListener('load', () => (el.decode ? el.decode().then(() => res(true), () => res(true)) : res(true)), { once: true });
    el.addEventListener('error', () => res(false), { once: true });
  });
};

function revealWhenDecoded(host, rect, render, uis) {
  let done = false;
  const show = () => {
    if (done) return;
    done = true;
    rect.classList.add('is-shown');
    host.dataset.composeShown = '1';
  };
  const renderJob = decoded(render);
  Promise.all([renderJob, ...uis.map(decoded)]).then(([ok]) => {
    if (ok) show();
    else host.classList.add('cmp-failed');
  });
  setTimeout(() => {
    if (!done && render.complete && render.naturalWidth > 0) show();
  }, 10000);
}

export async function composeAll(root = document) {
  const hosts = [...root.querySelectorAll('[data-compose]:not(.cmp-ready)')];
  if (!hosts.length) return;
  let man;
  try {
    man = await loadManifest();
  } catch (err) {
    console.warn('[compose]', err.message || err);
    hosts.forEach(h => h.classList.add('cmp-failed'));
    return;
  }
  for (const host of hosts) {
    const id = host.dataset.compose;
    const cut = man[id];
    if (!cut) { host.classList.add('cmp-failed'); continue; }
    build(host, cut, id);
  }
}
