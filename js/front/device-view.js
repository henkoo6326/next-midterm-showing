/* 기기 보기: 현재 UI 캡처(또는 실제 iframe)를 기기 외형 안에 넣는다
 *
 * 외형 두 가지
 *   bezel   코드로 그린 단순 베젤(무광 흑연 프레임 + 얇은 검정 테두리). 목업 PNG 가 없을 때 기본
 *   mockup  assets/mockups/manifest.json 의 투명 PNG + 화면 네 모서리 → matrix3d(호모그래피)로 화면을 맞춘다
 *           manifest: { "<id>": { png, w, h, screen:[[x,y]×4 좌상·우상·우하·좌하, PNG px], device } }
 *
 * 화면 층(.dv-screen)은 항상 기기 원래 크기(px)로 두고 transform 으로 줄인다. 그래서 캡처·iframe·표시 상자를
 * 기기 px 좌표 그대로 놓을 수 있다.
 *
 * live: true 이면 화면에 들어왔을 때만 ui-bridge 로 실제 iframe(autoplay, seek)을 만들고 벗어나면 destroy 한다.
 * iframe 이 준비되기 전과 실패했을 때는 캡처가 그대로 보인다.
 */

import { DEVICE_SIZE, asset } from './data.js';

/* ---------- 목업 manifest ---------- */

let manifestJob = null;
export function loadMockups() {
  if (!manifestJob) {
    manifestJob = fetch(asset('assets/mockups/manifest.json'), { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : null))
      .then(m => (m && typeof m === 'object' ? m : null))
      .catch(() => null);
  }
  return manifestJob;
}

function validMock(entry, device) {
  if (!entry || !entry.png || !entry.w || !entry.h) return false;
  if (entry.device && entry.device !== device) return false;
  const q = entry.screen;
  return Array.isArray(q) && q.length === 4 && q.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite));
}

/* (0,0)(w,0)(w,h)(0,h) → q[0..3] 로 보내는 CSS matrix3d (docs/research/06 5.3) */
export function quadMatrix3d(w, h, q) {
  const src = [[0, 0], [w, 0], [w, h], [0, h]];
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = q[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) if (r !== c) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const [a, bb, c, d, e, f, g, hh] = b.map((v, i) => v / A[i][i]);
  return `matrix3d(${a},${d},0,${g},${bb},${e},0,${hh},0,0,1,0,${c},${f},0,1)`;
}

/* ---------- 베젤 치수(기기 px) ---------- */

const BEZEL = {
  cluster: { b: 18, r: 26, inner: 6 },
  center: { b: 20, r: 26, inner: 6 },
  phone: { b: 11, r: 58, inner: 47 },
};

/* ---------- 실제 iframe 관리: 동시에 최대 3개 ---------- */

const MAX_LIVE = 3;
const liveSet = new Set();
const liveViews = new Set();   // live 를 원하는 모든 보기(자리가 나면 다시 시도)
let bridgeJob = null;
function bridge() {
  if (!bridgeJob) bridgeJob = import('../ui-bridge.js');
  return bridgeJob;
}

const liveObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  for (const entry of entries) {
    const view = entry.target.__deviceView;
    if (view) view._onVisible(entry.isIntersecting);
  }
}, { rootMargin: '0px 0px 0px 0px', threshold: 0.15 }) : null;

export class DeviceView {
  /**
   * @param {object} o
   * @param {'cluster'|'center'|'phone'} o.device
   * @param {string} [o.img]       캡처 URL
   * @param {string} [o.mock]      목업 id(manifest). 없거나 manifest 가 없으면 베젤
   * @param {boolean} [o.live]     화면에 들어오면 실제 iframe
   * @param {number} [o.ms]        live 일 때 seek 시점
   * @param {string} [o.alt]
   */
  constructor({ device, img = '', mock = null, live = false, ms = 0, alt = '' }) {
    this.device = device;
    this.size = DEVICE_SIZE[device];
    this.mockId = mock;
    this.mock = null;
    this.liveWanted = live;
    this.ms = ms;
    this.handle = null;
    this.visible = false;
    this.marks = new Map();

    const el = document.createElement('div');
    el.className = 'dv';
    el.dataset.device = device;
    el.dataset.skin = 'bezel';
    el.innerHTML = `
      <div class="dv-stage">
        <div class="dv-frame" aria-hidden="true"><div class="dv-rim"></div></div>
        <div class="dv-screen">
          <img class="dv-cap is-on" alt="" decoding="async">
          <img class="dv-cap" alt="" decoding="async" aria-hidden="true">
          <div class="dv-live"></div>
          <div class="dv-marks"></div>
        </div>
      </div>`;
    this.el = el;
    this.stage = el.querySelector('.dv-stage');
    this.screen = el.querySelector('.dv-screen');
    this.caps = [...el.querySelectorAll('.dv-cap')];
    this.liveBox = el.querySelector('.dv-live');
    this.markBox = el.querySelector('.dv-marks');
    this.screen.style.width = this.size.w + 'px';
    this.screen.style.height = this.size.h + 'px';
    this.caps[0].alt = alt;
    if (img) this.caps[0].src = img;
    this.caps[0].loading = 'lazy';
    this.caps[1].loading = 'lazy';

    this._applySkin();
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(this.stage);
    if (mock) loadMockups().then(m => {
      if (m && validMock(m[mock], device)) { this.mock = m[mock]; this._applySkin(); this.layout(); }
    });
    if (live && liveObserver) { el.__deviceView = this; liveViews.add(this); liveObserver.observe(el); }
  }

  /* 무대 비율(가로/세로) */
  get aspect() {
    if (this.mock) return this.mock.w / this.mock.h;
    const { b } = BEZEL[this.device];
    return (this.size.w + 2 * b) / (this.size.h + 2 * b);
  }

  _applySkin() {
    const old = this.el.querySelector('.dv-mock');
    if (this.mock) {
      this.el.dataset.skin = 'mockup';
      if (!old) {
        const img = document.createElement('img');
        img.className = 'dv-mock';
        img.alt = '';
        img.setAttribute('aria-hidden', 'true');
        img.decoding = 'async';
        img.src = asset(this.mock.webp || this.mock.png);
        this.stage.append(img);
      }
    } else {
      this.el.dataset.skin = 'bezel';
      old?.remove();
    }
    this.stage.style.aspectRatio = String(this.aspect);
    this.el.style.setProperty('--dv-aspect', String(this.aspect));
  }

  layout() {
    const W = this.stage.clientWidth;
    if (!W) return;
    const { w, h } = this.size;
    if (this.mock) {
      const s = W / this.mock.w;
      const q = this.mock.screen.map(([x, y]) => [x * s, y * s]);
      this.screen.style.transform = quadMatrix3d(w, h, q);
      this.screen.style.left = '0px';
      this.screen.style.top = '0px';
      this.screen.style.borderRadius = '0px';
      this.scale = s;
    } else {
      const { b, r, inner } = BEZEL[this.device];
      const s = W / (w + 2 * b);
      this.scale = s;
      this.screen.style.left = b * s + 'px';
      this.screen.style.top = b * s + 'px';
      this.screen.style.transform = `scale(${s})`;
      this.screen.style.borderRadius = inner + 'px';
      this.stage.style.setProperty('--dv-r', r * s + 'px');
      this.stage.style.setProperty('--dv-b', b * s + 'px');
      this.stage.style.setProperty('--dv-rim', Math.max(1, b * s * 0.42) + 'px');
      this.stage.style.setProperty('--dv-inner', inner * s + 'px');
    }
    this.el.dispatchEvent(new CustomEvent('dv:layout', { bubbles: false }));
  }

  /* 무대 너비를 px 로 지정(세 기기를 같은 축척으로 맞출 때) */
  setWidth(px) {
    this.el.style.width = px + 'px';
    this.layout();
  }

  /* 캡처 교체: 0.4s 크로스페이드 */
  setImage(src, alt) {
    const [on, off] = this.caps[0].classList.contains('is-on') ? this.caps : [this.caps[1], this.caps[0]];
    if (on.getAttribute('src') === src) return;
    off.loading = 'eager';
    off.src = src;
    if (alt !== undefined) { off.alt = alt; on.alt = ''; }
    const swap = () => { off.classList.add('is-on'); on.classList.remove('is-on'); off.removeAttribute('aria-hidden'); on.setAttribute('aria-hidden', 'true'); };
    if (off.complete && off.naturalWidth) swap();
    else off.decode().then(swap, swap);
  }

  setMs(ms) {
    this.ms = ms;
    if (this.handle && this.el.dataset.live === 'on') {
      try { this.handle.seek(ms); } catch { /* noop */ }
    }
  }

  /* 기기 px 사각형 표시(연결선의 끝점). 표시 요소를 돌려준다 */
  setMarks(rects) {
    this.markBox.innerHTML = '';
    this.marks.clear();
    for (const [key, r] of Object.entries(rects || {})) {
      const m = document.createElement('span');
      m.className = 'dv-mark';
      m.dataset.key = key;
      Object.assign(m.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
      this.markBox.append(m);
      this.marks.set(key, m);
    }
  }

  /* ---------- live ---------- */

  _onVisible(on) {
    this.visible = on;
    clearTimeout(this._liveTimer);
    if (on) this._liveTimer = setTimeout(() => this._startLive(), 280);
    else this._stopLive();
  }

  async _startLive() {
    if (!this.liveWanted || this.handle || !this.visible) return;
    if (liveSet.size >= MAX_LIVE) return;
    liveSet.add(this);
    this.el.dataset.live = 'loading';
    try {
      const { createDevice } = await bridge();
      if (!this.visible) { liveSet.delete(this); this.el.dataset.live = 'off'; return; }
      const handle = await createDevice({ device: this.device, mode: 'autoplay', container: this.liveBox, fit: false });
      if (!this.visible || this.el.dataset.live !== 'loading') { handle.destroy(); this._stopLive(); return; }
      this.handle = handle;
      await handle.ready;
      if (this.handle !== handle) return;
      handle.seek(this.ms);
      this.el.dataset.live = 'on';
      this.el.dispatchEvent(new CustomEvent('dv:live', { detail: { on: true } }));
    } catch (err) {
      console.warn('[front] 실제 화면을 띄우지 못해 캡처로 둔다', this.device, err);
      this._stopLive();
    }
  }

  _stopLive() {
    if (this.handle) {
      try { this.handle.destroy(); } catch { /* noop */ }
      this.handle = null;
    }
    this.liveBox.innerHTML = '';
    if (this.el.dataset.live && this.el.dataset.live !== 'off') {
      this.el.dispatchEvent(new CustomEvent('dv:live', { detail: { on: false } }));
    }
    this.el.dataset.live = 'off';
    const freed = liveSet.delete(this);
    if (freed) {
      for (const v of liveViews) if (v !== this && v.visible && !v.handle && v.el.dataset.live !== 'loading') { v._startLive(); break; }
    }
  }
}

export function liveCount() { return liveSet.size; }
