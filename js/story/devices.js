/* 하루 이야기: 기기 자리(slot) 구성
 *
 * 한 자리 = 화면 상자(screen) + (목업 PNG 또는 코드 베젤) + 정지 캡처 자리표시 + ui-bridge iframe
 * - 목업: assets/mockups/manifest.json 이 있고 해당 id(cluster-front, center-34, phone-34, 직접 해 보기는 phone-front 우선)가 있으면
 *   투명 PNG 를 화면 상자 위에 겹치고(pointer-events:none), iframe·캡처는 화면 네 모서리로 matrix3d 변환한다.
 *   없거나 읽지 못하면 코드 베젤(CSS 테두리)로 그린다.
 * - iframe 은 ui-bridge 의 fit:false 로 만들고 크기 맞춤(scale 또는 matrix3d)은 여기서 한다.
 */

import { createDevice, DEVICES } from '../ui-bridge.js';

const SITE = new URL('../../', import.meta.url);
const MOCKUP_MANIFEST = new URL('assets/mockups/manifest.json', SITE);
/* 값이 배열이면 앞에서부터 manifest 에 있는 첫 id 를 쓴다. 직접 해 보기 폰은 정면 목업(phone-front)이 있으면 그것을,
   없으면 3/4 목업(phone-34)을 쓴다 */
export const MOCKUP_IDS = { cluster: 'cluster-front', center: 'center-34', phone: 'phone-34', try: ['phone-front', 'phone-34'] };

export function pickMockup(mockups, ids) {
  if (!mockups) return null;
  for (const id of [].concat(ids)) if (mockups.has(id)) return mockups.get(id);
  return null;
}

/* ---------- 목업 manifest (형식을 넓게 받아들인다) ---------- */

let mockupJob = null;

function toPoint(p) {
  if (Array.isArray(p) && p.length >= 2) return [Number(p[0]), Number(p[1])];
  if (p && typeof p === 'object' && 'x' in p && 'y' in p) return [Number(p.x), Number(p.y)];
  return null;
}

function toQuad(raw) {
  if (!raw) return null;
  let pts = null;
  if (Array.isArray(raw) && raw.length === 4) pts = raw.map(toPoint);
  else if (Array.isArray(raw) && raw.length === 8 && raw.every(n => typeof n === 'number')) {
    pts = [[raw[0], raw[1]], [raw[2], raw[3]], [raw[4], raw[5]], [raw[6], raw[7]]];
  } else if (typeof raw === 'object') {
    const pick = (...keys) => { for (const k of keys) if (raw[k]) return toPoint(raw[k]); return null; };
    pts = [pick('tl', 'topLeft', 'top_left'), pick('tr', 'topRight', 'top_right'), pick('br', 'bottomRight', 'bottom_right'), pick('bl', 'bottomLeft', 'bottom_left')];
  }
  if (!pts || pts.some(p => !p || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return null;
  return pts;
}

function normaliseEntry(id, v, base) {
  if (!v || typeof v !== 'object') return null;
  const src = v.webp || v.file || v.src || v.png || v.image || v.path || v.url;
  if (!src || typeof src !== 'string') return null;
  const quad = toQuad(v.screen?.corners || v.screen?.quad || v.screen || v.corners || v.quad || v.screenCorners || v.screen_corners || v.screenQuad);
  if (!quad) return null;
  const size = v.size || v.imageSize || v.image_size;
  const w = Number(v.width || v.w || v.pngWidth || (Array.isArray(size) ? size[0] : size?.width || size?.w)) || 0;
  const h = Number(v.height || v.h || v.pngHeight || (Array.isArray(size) ? size[1] : size?.height || size?.h)) || 0;
  const url = /^(assets|ui|css|js)\//.test(src) ? new URL(src, SITE).href : new URL(src, base).href;
  return { id, url, w, h, quad, normalised: quad.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1) };
}

export function loadMockups() {
  if (mockupJob) return mockupJob;
  mockupJob = (async () => {
    const map = new Map();
    try {
      const res = await fetch(MOCKUP_MANIFEST, { cache: 'no-cache' });
      if (!res.ok) return map;
      const json = await res.json();
      let entries = [];
      if (Array.isArray(json)) entries = json.map(v => [v && v.id, v]);
      else if (Array.isArray(json?.mockups)) entries = json.mockups.map(v => [v && v.id, v]);
      else if (Array.isArray(json?.items)) entries = json.items.map(v => [v && v.id, v]);
      else if (json && typeof json === 'object') {
        const src = json.mockups && typeof json.mockups === 'object' ? json.mockups : json;
        entries = Object.entries(src).map(([k, v]) => [v?.id || k, v]);
      }
      for (const [id, v] of entries) {
        if (!id) continue;
        const entry = normaliseEntry(id, v, MOCKUP_MANIFEST);
        if (!entry) continue;
        // 크기를 모르면 이미지를 읽어 확인한다(실패하면 이 목업은 쓰지 않는다)
        try {
          const img = new Image();
          img.decoding = 'async';
          img.src = entry.url;
          await img.decode();
          entry.w = entry.w || img.naturalWidth;
          entry.h = entry.h || img.naturalHeight;
          if (entry.normalised) entry.quad = entry.quad.map(([x, y]) => [x * entry.w, y * entry.h]);
          // 불투명한 하우징의 맨 아래(접지 그림자 제외)를 찾아 설명 줄 위치에 쓴다
          try {
            const cw = 160;
            const ch = Math.max(1, Math.round(cw * img.naturalHeight / img.naturalWidth));
            const canvas = document.createElement('canvas');
            canvas.width = cw;
            canvas.height = ch;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0, cw, ch);
            const data = ctx.getImageData(0, 0, cw, ch).data;
            let minX = cw, maxX = -1, minY = ch, maxY = -1;
            for (let y = 0; y < ch; y++) {
              for (let x = 0; x < cw; x++) {
                if (data[(y * cw + x) * 4 + 3] > 200) {
                  if (x < minX) minX = x;
                  if (x > maxX) maxX = x;
                  if (y < minY) minY = y;
                  if (y > maxY) maxY = y;
                }
              }
            }
            if (maxX >= 0) {
              entry.opaque = { x0: (minX / cw) * entry.w, x1: ((maxX + 1) / cw) * entry.w, y0: (minY / ch) * entry.h, y1: ((maxY + 1) / ch) * entry.h };
            }
          } catch { /* 읽지 못하면 추정값 */ }
          map.set(id, entry);
        } catch { /* 목업 이미지 없음 → 코드 베젤 */ }
      }
    } catch { /* manifest 없음 → 코드 베젤 */ }
    return map;
  })();
  return mockupJob;
}

/* ---------- 호모그래피: (0,0)(w,0)(w,h)(0,h) → q[0..3] (docs/research/06 5.3) ---------- */

export function quadMatrix3d(w, h, q) {
  const src = [[0, 0], [w, 0], [w, h], [0, h]];
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = q[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const [a, bb, c, d, e, f, g, hh] = b.map((v, i) => v / A[i][i]);
  return `matrix3d(${a},${d},0,${g},${bb},${e},0,${hh},0,0,1,0,${c},${f},0,1)`;
}

function bbox(quad) {
  const xs = quad.map(p => p[0]);
  const ys = quad.map(p => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/* ---------- 자리 ---------- */

export class Slot {
  /* el: .story-slot, device: 'cluster'|'center'|'phone', mockupId */
  constructor(el, device, { mode = 'autoplay', mockup = null, query = {}, onReady = null, injectHref = null } = {}) {
    this.injectHref = injectHref;
    this.el = el;
    this.device = device;
    this.size = DEVICES[device];
    this.mode = mode;
    this.query = query;
    this.mockup = mockup;
    this.onReady = onReady;
    this.screen = el.querySelector('[data-screen]');
    this.handle = null;
    this.job = null;
    this.gen = 0;          // release() 가 올리는 세대 번호. 생성 도중 해제되면 늦게 도착한 iframe 을 버린다
    this.placeholder = document.createElement('img');
    this.placeholder.className = 'story-placeholder';
    this.placeholder.alt = '';
    this.placeholder.decoding = 'async';
    this.placeholder.hidden = true;
    this.overlay = document.createElement('img');
    this.overlay.className = 'story-overlay';
    this.overlay.alt = '';
    this.overlay.decoding = 'async';
    this.overlayNext = document.createElement('img');
    this.overlayNext.className = 'story-overlay';
    this.overlayNext.alt = '';
    this.overlayNext.decoding = 'async';
    this.layer = document.createElement('div');
    this.layer.className = 'story-layer';
    this.layer.append(this.placeholder, this.overlay, this.overlayNext);
    this.screen.append(this.layer);
    this.frameBox = document.createElement('div');
    this.frameBox.className = 'story-framebox';
    this.screen.prepend(this.frameBox);
    this.png = null;
    if (mockup) {
      el.classList.add('has-mockup');
      this.png = document.createElement('img');
      this.png.className = 'story-mockup';
      this.png.alt = '';
      this.png.src = mockup.url;
      this.png.decoding = 'async';
      el.append(this.png);
    } else {
      el.classList.add('has-bezel');
    }
    el.dataset.device = device;
    this.scale = 1;
    this.transform = 'scale(1)';
    this.overlaySrc = null;
  }

  /* 화면 상자 비율(코드 베젤은 기기 비율, 목업은 화면 네 모서리 bbox 비율) */
  get aspect() {
    if (this.mockup) {
      const b = bbox(this.mockup.quad);
      return b.w / b.h;
    }
    return this.size.width / this.size.height;
  }

  /* 목업 하우징(불투명 부분)이 화면 상자 밖으로 나가는 길이. 화면 상자 폭 1 당 비율 {l, r, t, b}
     (접지 그림자처럼 반투명한 부분은 넣지 않는다). 코드 베젤은 0 */
  get ext() {
    if (!this.mockup) return { l: 0, r: 0, t: 0, b: 0 };
    const q = bbox(this.mockup.quad);
    const o = this.mockup.opaque || { x0: q.x, x1: q.x + q.w, y0: q.y, y1: this.mockup.h * 0.92 };
    return {
      l: Math.max(0, q.x - o.x0) / q.w,
      r: Math.max(0, o.x1 - (q.x + q.w)) / q.w,
      t: Math.max(0, q.y - o.y0) / q.w,
      b: Math.max(0, o.y1 - (q.y + q.h)) / q.w,
    };
  }

  get belowPerWidth() { return this.ext.b; }

  /* 화면 상자 폭(px)을 정하면 transform 을 계산해 iframe·캡처에 건다 */
  setWidth(px) {
    const { width: w, height: h } = this.size;
    const boxW = Math.max(1, px);
    const boxH = boxW / this.aspect;
    this.el.style.width = boxW + 'px';
    this.screen.style.width = boxW + 'px';
    this.screen.style.height = boxH + 'px';
    if (this.mockup) {
      const b = bbox(this.mockup.quad);
      const k = boxW / b.w;
      const q = this.mockup.quad.map(([x, y]) => [(x - b.x) * k, (y - b.y) * k]);
      this.transform = quadMatrix3d(w, h, q);
      this.scale = k;
      Object.assign(this.png.style, {
        width: this.mockup.w * k + 'px',
        height: this.mockup.h * k + 'px',
        left: (this.screen.offsetLeft - b.x * k) + 'px',
        top: (this.screen.offsetTop - b.y * k) + 'px',
      });
    } else {
      this.scale = boxW / w;
      this.transform = `scale(${this.scale})`;
    }
    this.layer.style.width = w + 'px';
    this.layer.style.height = h + 'px';
    this.layer.style.transform = this.transform;
    this.frameBox.style.width = w + 'px';
    this.frameBox.style.height = h + 'px';
    this.frameBox.style.transform = this.transform;
    this.el.style.setProperty('--slot-scale', String(this.scale));
    this.el.style.setProperty('--below', (this.belowPerWidth * boxW).toFixed(1) + 'px');
    return { w: boxW, h: boxH };
  }

  /* 목업 PNG 위치는 화면 상자 위치가 정해진 뒤 다시 맞춘다 */
  relayoutMockup() {
    if (!this.mockup) return;
    const b = bbox(this.mockup.quad);
    const k = this.scale;
    this.png.style.left = (this.screen.offsetLeft - b.x * k) + 'px';
    this.png.style.top = (this.screen.offsetTop - b.y * k) + 'px';
  }

  setPlaceholder(src) {
    if (!src) { this.placeholder.hidden = true; return; }
    if (this.placeholder.getAttribute('src') !== src) this.placeholder.src = src;
    this.placeholder.hidden = false;
  }

  /* 폰 자리에 정지 이미지(수동 모드 캡처)를 0.4s 크로스페이드로 겹친다. src 가 null 이면 걷어낸다 */
  setOverlay(src) {
    if (src === this.overlaySrc) return;
    this.overlaySrc = src;
    const [cur, next] = [this.overlay, this.overlayNext];
    if (!src) {
      this.overlayShown = false;
      cur.classList.remove('is-on');
      next.classList.remove('is-on');
      this.el.classList.remove('has-overlay');
      return;
    }
    this.el.classList.add('has-overlay');
    next.onload = null;
    const show = () => {
      next.onload = null;
      if (this.overlaySrc !== src) return;   // 늦게 끝난 로드가 지금 상태를 덮지 않게
      this.overlayShown = true;
      next.classList.add('is-on');
      cur.classList.remove('is-on');
      this.overlay = next;
      this.overlayNext = cur;
    };
    if (next.getAttribute('src') === src && next.complete) show();
    else { next.onload = show; next.src = src; }
  }

  get active() { return !!this.handle; }

  async start() {
    if (this.job) return this.job;
    const gen = ++this.gen;
    const stale = () => gen !== this.gen;
    const aborted = () => Object.assign(new Error('released'), { name: 'AbortError' });
    const job = (async () => {
      const handle = await createDevice({ device: this.device, mode: this.mode, container: this.frameBox, fit: false, query: this.query });
      if (stale()) { handle.destroy(); throw aborted(); }
      this.handle = handle;
      Object.assign(handle.iframe.style, { position: 'absolute', left: '0', top: '0' });
      if (this.mode === 'manual') handle.iframe.tabIndex = 0;
      else {
        // 하루 이야기 무대는 읽기 전용 시연: 키보드 초점·클릭이 iframe 안 버튼에 가지 않게 한다(직접 해 보기 폰은 제외)
        handle.iframe.tabIndex = -1;
        handle.iframe.inert = true;
        handle.iframe.setAttribute('aria-hidden', 'true');
      }
      await handle.ready;
      if (stale()) throw aborted();
      if (this.injectHref) await handle.inject({ href: this.injectHref }).catch(err => console.warn('[story] 주입 실패', err));
      if (stale()) throw aborted();
      this.el.classList.add('is-live');
      this.onReady?.(handle);
      return handle;
    })().catch(err => {
      // 생성 도중 release() 됐으면 실패로 표시하지 않는다(정지 캡처가 그대로 자리를 지킨다)
      if (stale() || err?.name === 'AbortError') throw err;
      console.warn('[story] 기기 화면을 불러오지 못했습니다', this.device, err);
      this.el.classList.add('is-failed');
      this.handle?.destroy();
      this.handle = null;
      this.job = null;
      throw err;
    });
    this.job = job;
    return job;
  }

  release() {
    this.gen++;
    if (this.handle) this.handle.destroy();
    this.handle = null;
    this.job = null;
    this.el.classList.remove('is-live', 'is-failed');
  }
}
