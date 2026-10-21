/* ⑥ #center 센터페시아 (소유: center 담당). 사용자 선택 시안 docs/proposals-v3/center-a.html 이식(2026-10-21)
 *
 * main.js 가 partials/center.html 을 넣은 뒤 init(root) 를 부른다.
 *   - ③ 대표 타일: PV5 v8 렌더(assets/sections/center-context, 화면은 알파 0 구멍) 아래에
 *     현재 NEXT UI 정차 캡처(센터 center_40000 · 클러스터 cluster_40000)를 렌더 카메라의 화면 네 모서리로 사영변환해 깐다.
 *     모서리는 assets/sections/manifest.json(common.js loadManifest) 에서 읽는다. 렌더 층에만 --render-focus.
 *   - 타일 cover: 센터 화면 중심(렌더 x 1230)을 타일 가로 58% 에, 세로(렌더 y 640)를 43% 에 두고 넘치지 않게 클램프.
 *   - 화면 위 정차 카드(UI 24,24 ~ 334,239)를 타일 좌표로 사영해 테두리를 그리고, 왼쪽 아래 확대 조각(.ctr-zoom)과 선으로 잇는다.
 *   - ①② 타일과 근거는 partial 의 정적 HTML + CSS 다(스크립트 없이도 보인다).
 * 모두 설명용 이미지다. 버튼·링크·호버를 두지 않는다. */

import { assetUrl, loadManifest, homography, whenNear, revealText } from './common.js';

const CUT_ID = 'center-context';
const SHOTS = {
  center: 'assets/captures/center_40000.png',   // 정차 캡처(지난 경로선 교체 대상, 다음 캡처 재생성에서 같은 경로로 바뀜)
  cluster: 'assets/captures/cluster_40000.png',
};
const SLOT = { center: { w: 1280, h: 720 }, cluster: { w: 1600, h: 900 } };
/* 화면 위 정차 카드(UI 24,24 ~ 334,239) */
const CARD = [24, 24, 334, 239];
/* 센터 화면 중심(렌더 px)을 타일의 어느 비율에 둘지 */
const FOCUS = { rx: 1230, ry: 640, ax: 0.58, ay: 0.43, zoom: 1.06 };

function project(m, x, y) {
  const X = m[0] * x + m[4] * y + m[12], Y = m[1] * x + m[5] * y + m[13], W = m[3] * x + m[7] * y + m[15];
  return [X / W, Y / W];
}

function loadImg(src, cls, style) {
  const im = document.createElement('img');
  im.alt = '';
  im.decoding = 'async';
  im.draggable = false;
  if (cls) im.className = cls;
  if (style) Object.assign(im.style, style);
  const done = new Promise(res => { im.addEventListener('load', res, { once: true }); im.addEventListener('error', res, { once: true }); });
  im.src = assetUrl(src);
  return { im, done };
}

function build(root, cut) {
  const main = root.querySelector('[data-ctr-main]');
  const stage = root.querySelector('[data-ctr-stage]');
  const art = root.querySelector('[data-ctr-art]');
  const zoom = root.querySelector('[data-ctr-zoom]');
  const link = root.querySelector('[data-ctr-link]');
  art.style.width = cut.w + 'px';
  art.style.height = cut.h + 'px';

  const M = {};
  const loads = [];
  for (const device of ['cluster', 'center']) {
    const q = cut.screens && cut.screens[device];
    if (!q) continue;
    const box = document.createElement('div');
    box.className = 'ctr-screen';
    box.dataset.screen = device;
    const { w, h } = SLOT[device];
    Object.assign(box.style, { width: w + 'px', height: h + 'px' });
    // 클러스터: 16:9 슬롯 안 2:1 UI 를 폭 맞춤(위아래 50, 3D 체험과 같음)
    const imgStyle = device === 'cluster'
      ? { top: '50px', width: '1600px', height: '800px' }
      : { width: '1280px', height: '720px' };
    const { im, done } = loadImg(SHOTS[device], '', imgStyle);
    box.append(im);
    // 센터 지도 오른쪽 아래 출처 글자(UI 1053,621 ~ 1266,633)만 지도 바탕색으로 덮는다. 출처는 #sources 에 남긴다
    if (device === 'center') {
      const mask = document.createElement('i');
      mask.className = 'ctr-mask';
      box.append(mask);
    }
    loads.push(done);
    M[device] = homography(w, h, q);
    box.style.transform = `matrix3d(${M[device].map(v => (Math.abs(v) < 1e-12 ? 0 : +v.toPrecision(10))).join(',')})`;
    art.append(box);
  }
  const render = loadImg(cut.webp, 'ctr-render', { width: cut.w + 'px', height: cut.h + 'px' });
  art.append(render.im);
  loads.push(render.done);

  function layout() {
    const W = main.clientWidth, H = main.clientHeight;
    if (!W || !H || !M.center) return;
    const s = Math.max(W / cut.w, H / cut.h) * FOCUS.zoom;
    const aw = cut.w * s, ah = cut.h * s;
    const left = Math.min(0, Math.max(W - aw, W * FOCUS.ax - FOCUS.rx * s));
    const top = Math.min(0, Math.max(H - ah, H * FOCUS.ay - FOCUS.ry * s));
    art.style.transform = `translate(${left}px, ${top}px) scale(${s})`;

    // 화면 위 카드 네 모서리를 타일 좌표로
    const P = (x, y) => { const [rx, ry] = project(M.center, x, y); return [left + rx * s, top + ry * s]; };
    const tl = P(CARD[0], CARD[1]), tr = P(CARD[2], CARD[1]), br = P(CARD[2], CARD[3]), bl = P(CARD[0], CARD[3]);

    // 확대 조각: 타일 왼쪽 아래 영역
    const zx = W * 0.045, zy = H * 0.36;
    zoom.style.left = zx + 'px';
    zoom.style.top = zy + 'px';
    const zw = zoom.offsetWidth;

    link.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const quad = `M${tl}L${tr}L${br}L${bl}Z`;
    // 원래 카드 왼쪽 아래 모서리 → 확대 조각 위 모서리. 밝은 테 + 잉크 선 두 겹(흰 카드·지도·어두운 베젤 모두에서 보이게)
    const from = bl, to = [zx + zw * 0.62, zy];
    const seg = `M${from[0]},${from[1]} L${to[0]},${to[1]}`;
    link.innerHTML = `<path class="halo" d="${quad}"/><path class="halo" d="${seg}"/>`
      + `<path class="ink" d="${quad}"/><path class="ink" d="${seg}"/>`
      + `<circle cx="${from[0]}" cy="${from[1]}" r="4"/>`;
    main.dataset.ctrReady = '';
  }

  if ('ResizeObserver' in window) new ResizeObserver(layout).observe(main);
  else window.addEventListener('resize', layout);
  layout();
  return Promise.all(loads).then(() => { stage.dataset.renderState = 'ready'; layout(); });
}

export async function init(root) {
  const main = root.querySelector('[data-ctr-main]');
  if (!main) throw new Error('center partial 없음');
  revealText(root);

  let job = null;
  const mount = () => {
    if (!job) {
      root.querySelector('[data-ctr-stage]').dataset.renderState = 'loading';
      job = loadManifest()
        .then(manifest => {
          const cut = manifest[CUT_ID];
          if (!cut) throw new Error(`manifest 에 ${CUT_ID} 없음`);
          return build(root, cut);
        })
        .catch(err => {
          root.querySelector('[data-ctr-stage]').dataset.renderState = 'failed';
          console.error('[center] 렌더 합성 실패', err);
        });
    }
    return job;
  };

  // 섹션 가까이 오면 합성(렌더 webp 를 미리 받지 않게). 멀리 있을 때도 init 이 오래 매달리지 않게 2.5s 뒤 끝낸다
  await new Promise(resolve => {
    whenNear(root, () => { mount().then(resolve); }, '120% 0px');
    setTimeout(resolve, 2500);
  });
}
