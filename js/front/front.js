/* 앞부분 장(01~07)과 D 근거·출처의 동작
 * main.js 가 import 해 init() 을 부른다. 자동 소리·자동 진행 없음(발표자가 누른다) */

import { cap, DEVICE_SIZE, DEVICE_NAME, WHO_STEPS, PRIORITY, MOMENTS, DEVICE_BLOCKS, STATE_TABS } from './data.js';
import { DeviceView, loadMockups } from './device-view.js';
import { buildWire } from './rules-wire.js';
import { renderCredits } from './credits.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* 탭 묶음: 클릭·좌우 화살표 키. role=tab 버튼과 aria-selected 를 맞춘다 */
function tabs(buttons, onSelect, initial) {
  const select = (btn, focus = false) => {
    for (const b of buttons) {
      const on = b === btn;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    if (focus) btn.focus();
    onSelect(btn);
  };
  buttons.forEach((b, i) => {
    b.addEventListener('click', () => select(b));
    b.addEventListener('keydown', e => {
      const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!dir) return;
      e.preventDefault();
      e.stopPropagation();
      select(buttons[(i + dir + buttons.length) % buttons.length], true);
    });
  });
  select(initial || buttons[0]);
  return select;
}

/* ---------- 세 기기를 같은 축척으로 한 줄에 ---------- */

const BEZEL_UNITS = { cluster: 18, center: 20, phone: 11 };
function trioLayout(box, views, { maxH = () => Infinity } = {}) {
  const run = () => {
    const W = box.clientWidth;
    if (!W) return;
    const stacked = W < 640;
    box.classList.toggle('is-stacked', stacked);
    if (stacked) {
      // 좁은 화면: 한 줄에 하나씩, 각자 폭에 맞춘다
      views.forEach(v => {
        const px = Math.floor(Math.min(W, (v.device === 'phone' ? 0.72 : 1) * W, 520 * v.aspect));
        v.el.parentElement.style.width = px + 'px';
        v.setWidth(px);
      });
      return;
    }
    const gap = parseFloat(getComputedStyle(box).columnGap) || 32;
    const units = views.map(v => ({ w: v.size.w + 2 * BEZEL_UNITS[v.device], h: v.size.h + 2 * BEZEL_UNITS[v.device] }));
    const sumW = units.reduce((a, u) => a + u.w, 0);
    const maxUnitsH = Math.max(...units.map(u => u.h));
    const s = Math.min((W - gap * (views.length - 1)) / sumW, maxH() / maxUnitsH);
    views.forEach((v, i) => {
      const px = Math.floor(units[i].w * s);
      v.el.parentElement.style.width = px + 'px';
      v.setWidth(px);
    });
  };
  new ResizeObserver(run).observe(box);
  window.addEventListener('resize', run, { passive: true });
  run();
  return run;
}

function trioFigure(view, device) {
  const fig = document.createElement('figure');
  fig.className = 'trio-item';
  fig.dataset.device = device;
  fig.append(view.el);
  const cap = document.createElement('figcaption');
  cap.innerHTML = '<strong></strong><span></span>';
  cap.querySelector('strong').textContent = DEVICE_NAME[device];
  fig.append(cap);
  return fig;
}

/* ---------- 01 누가·언제 ---------- */

function initWho() {
  const root = $('[data-front="who"]');
  if (!root) return;
  const list = $('[data-steps]', root);
  const deviceBox = $('[data-who-device]', root);
  const views = {};
  const show = device => {
    for (const [d, v] of Object.entries(views)) v.el.hidden = d !== device;
    return views[device];
  };
  for (const d of ['center', 'phone', 'cluster']) {
    views[d] = new DeviceView({ device: d });
    views[d].el.hidden = true;
    deviceBox.append(views[d].el);
  }
  const fitDevice = () => {
    const box = deviceBox.getBoundingClientRect();
    for (const v of Object.values(views)) {
      const w = Math.min(box.width, box.height * v.aspect);
      v.setWidth(Math.floor(w));
    }
  };
  new ResizeObserver(fitDevice).observe(deviceBox);

  const buttons = WHO_STEPS.map((step, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.dataset.step = String(i);
    b.innerHTML = '<span class="step-n"></span><span class="step-name"></span>';
    b.querySelector('.step-n').textContent = String(i + 1);
    b.querySelector('.step-name').textContent = step.name;
    li.append(b);
    list.append(li);
    return b;
  });
  const count = $('[data-who-count]', root), name = $('[data-who-name]', root);
  const desc = $('[data-who-desc]', root), capEl = $('[data-who-cap]', root);
  let last = null;
  tabs(buttons, btn => {
    const i = Number(btn.dataset.step);
    const step = WHO_STEPS[i];
    const view = show(step.device);
    view.setImage(cap(step.img), `${DEVICE_NAME[step.device]} 화면 · ${step.name}`);
    if (last !== step.device) fitDevice();
    last = step.device;
    count.textContent = `${i + 1} / ${WHO_STEPS.length} · ${DEVICE_NAME[step.device]}`;
    name.textContent = step.name;
    desc.textContent = step.desc;
    capEl.textContent = `현재 NEXT UI · ${step.src}`;
    root.style.setProperty('--step', String(i));
  });
  // 미리 받아 두기(작은 WebP)
  const idle = window.requestIdleCallback || (fn => setTimeout(fn, 1200));
  idle(() => WHO_STEPS.forEach(s => { const im = new Image(); im.src = cap(s.img); }));
}

/* ---------- 02 정보 설계 순서 ---------- */

function initPriority() {
  const root = $('[data-front="priority"]');
  if (!root) return;
  const big = $('[data-prio-big]', root);
  const crop = $('[data-prio-crop]', root);
  const capEl = $('[data-prio-cap]', root);
  const imgs = {};
  for (const [k, p] of Object.entries(PRIORITY)) {
    const box = document.createElement('div');
    box.className = 'crop-item';
    box.dataset.k = k;
    box.style.aspectRatio = `${p.crop.w} / ${p.crop.h}`;
    const img = document.createElement('img');
    img.src = cap(p.img);
    img.alt = p.cap;
    img.decoding = 'async';
    img.loading = 'lazy';
    const { w, h } = DEVICE_SIZE.phone;
    Object.assign(img.style, {
      width: (w / p.crop.w) * 100 + '%',
      left: -(p.crop.x / p.crop.w) * 100 + '%',
      top: -(p.crop.y / p.crop.h) * 100 + '%',
    });
    box.append(img);
    crop.append(box);
    imgs[k] = box;
  }
  const buttons = $$('[data-prio]', root);
  tabs(buttons, btn => {
    const k = btn.dataset.prio;
    big.textContent = k;
    for (const [key, el] of Object.entries(imgs)) el.classList.toggle('is-on', key === k);
    capEl.textContent = PRIORITY[k].cap;
    root.dataset.current = k;
  });
}

/* ---------- 03 짧은 시선 ---------- */

function initGlance() {
  const root = $('[data-front="glance"]');
  if (!root) return;
  const trio = $('[data-glance-trio]', root);
  const views = ['cluster', 'center', 'phone'].map(d => {
    const v = new DeviceView({ device: d });
    trio.append(trioFigure(v, d));
    return v;
  });
  trioLayout(trio, views, { maxH: () => Math.max(300, Math.min(560, innerHeight * 0.46)) });
  tabs($$('[data-glance]', root), btn => {
    const m = MOMENTS[btn.dataset.glance];
    root.dataset.state = btn.dataset.glance;
    views.forEach(v => {
      v.setImage(cap(m.img[v.device]), `${DEVICE_NAME[v.device]} · ${m.text[v.device]}`);
      v.el.parentElement.querySelector('figcaption span').textContent = m.text[v.device];
    });
  });
}

/* ---------- 04 레이아웃·스타일 규칙 ---------- */

function initRules() {
  const root = $('[data-front="rules"]');
  if (!root) return;
  const svg = buildWire();
  $('[data-rules-wire]', root).append(svg);
  const btn = $('[data-rules-overlay]', root);
  btn.addEventListener('click', () => {
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(on));
    svg.classList.toggle('show-ui', on);
    btn.textContent = on ? '와이어만 보기' : '실제 화면 겹치기';
  });
}

/* ---------- 05 기기 화면 ---------- */

function initDevices() {
  const host = $('[data-front="devices"]');
  if (!host) return;
  for (const block of DEVICE_BLOCKS) {
    const art = document.createElement('article');
    art.className = 'dev';
    art.dataset.device = block.device;
    art.innerHTML = `
      <div class="wrap grid">
        <div class="dev-text">
          <p class="dev-head"><span class="sec-num"></span><span class="dev-name"></span><span class="dev-size mute"></span></p>
          <h3 class="dev-role t-m"></h3>
          <p class="dev-desc"></p>
          <div class="seg seg--sm" role="tablist"></div>
          <p class="dev-state" aria-live="polite"></p>
          <p class="cap dev-cap"></p>
        </div>
        <div class="dev-visual"><div class="dev-fit"></div></div>
      </div>`;
    $('.sec-num', art).textContent = block.num;
    $('.dev-name', art).textContent = DEVICE_NAME[block.device];
    $('.dev-size', art).textContent = `${block.size} 설계 캔버스`;
    $('.dev-role', art).textContent = block.role;
    $('.dev-desc', art).textContent = block.desc;
    const seg = $('.seg', art);
    seg.setAttribute('aria-label', `${DEVICE_NAME[block.device]} 상태`);
    const view = new DeviceView({
      device: block.device, mock: block.mock, live: true,
      img: cap(block.states.park.img), ms: block.states.park.ms,
      alt: `${DEVICE_NAME[block.device]} 화면`,
    });
    const fitBox = $('.dev-fit', art);
    fitBox.append(view.el);
    const fit = () => {
      const r = fitBox.getBoundingClientRect();
      if (!r.width) return;
      const maxH = Math.max(300, Math.min(innerHeight - 190, block.device === 'phone' ? 780 : 680));
      const natural = block.device === 'phone' ? Infinity : (block.device === 'cluster' ? 836 : 1180);
      view.setWidth(Math.floor(Math.min(r.width, maxH * view.aspect, natural)));
    };
    new ResizeObserver(fit).observe(fitBox);
    window.addEventListener('resize', fit, { passive: true });
    view.el.addEventListener('dv:layout', () => {
      // 목업이 늦게 오면 비율이 바뀐다
      if (view._lastAspect !== view.aspect) { view._lastAspect = view.aspect; fit(); }
    });
    const state = $('.dev-state', art);
    const capEl = $('.dev-cap', art);
    const buttons = STATE_TABS.map(t => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.dataset.state = t.id;
      b.textContent = t.label;
      seg.append(b);
      return b;
    });
    const setCap = () => {
      const st = block.states[art.dataset.state];
      const live = view.el.dataset.live === 'on';
      capEl.textContent = `현재 NEXT UI${live ? ' 실제 화면' : ' 캡처'} · 연결 시연 ${st.ms / 1000}초`;
    };
    tabs(buttons, btn => {
      const st = block.states[btn.dataset.state];
      art.dataset.state = btn.dataset.state;
      view.setImage(cap(st.img), `${DEVICE_NAME[block.device]} · ${st.text}`);
      view.setMs(st.ms);
      state.textContent = st.text;
      setCap();
    }, buttons.find(b => b.dataset.state === 'park'));
    view.el.addEventListener('dv:live', setCap);
    host.append(art);
  }
}

/* ---------- 06 하나의 서비스 ---------- */

function initConnect() {
  const root = $('[data-front="connect"]');
  if (!root) return;
  const conn = $('[data-conn]', root);
  const trio = $('[data-conn-trio]', root);
  const svg = $('[data-conn-lines]', root);
  const node = $('[data-conn-node]', root);
  // 선언 순서 주의: DeviceView 생성·trioLayout 이 dv:layout 을 동기로 보낼 수 있으므로
  // views·raf 는 let 으로 먼저 두고, schedule·draw 는 끌어올려지는 함수 선언으로 쓴다(선언 전 사용 오류 방지)
  let raf = 0;
  let views = [];
  function schedule() { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); }
  views = ['cluster', 'center', 'phone'].map(d => {
    const v = new DeviceView({ device: d, live: true, img: cap(MOMENTS.park.img[d]), ms: MOMENTS.park.ms });
    trio.append(trioFigure(v, d));
    v.el.addEventListener('dv:layout', schedule);
    return v;
  });
  trioLayout(trio, views, { maxH: () => Math.max(280, Math.min(520, innerHeight * 0.44)) });

  function draw() {
    const box = conn.getBoundingClientRect();
    if (!box.width || views.length !== 3) return;
    svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    svg.setAttribute('width', box.width);
    svg.setAttribute('height', box.height);
    const n = node.getBoundingClientRect();
    const sx = n.left + n.width / 2 - box.left;
    const sy = n.bottom - box.top;
    // 기기 위쪽 가장자리보다 위에 가로 버스를 두고, 버스에서 각 기기의 표시 상자 위로 내려간다(기기 화면을 가로지르지 않게)
    const tops = views.map(v => v.el.getBoundingClientRect().top - box.top);
    const busY = Math.max(sy + 16, Math.min(...tops) - Math.max(18, (Math.min(...tops) - sy) * 0.45));
    const R = 10;
    let paths = '';
    for (const [i, v] of views.entries()) {
      const m = v.marks.get('item');
      if (!m) continue;
      const r = m.getBoundingClientRect();
      const ex = r.left + r.width / 2 - box.left;
      const ey = r.top - box.top;
      const top = tops[i];
      const dir = Math.sign(ex - sx);
      let d;
      if (Math.abs(ex - sx) < 2 * R) d = `M${sx},${sy} V${busY} H${ex} V${top}`;
      else d = `M${sx},${sy} V${busY - R} Q${sx},${busY} ${sx + dir * R},${busY} H${ex - dir * R} Q${ex},${busY} ${ex},${busY + R} V${top}`;
      paths += `<path class="halo" d="${d}"/><path class="line" d="${d}"/>`;
      if (ey > top + 2) paths += `<path class="line line--in" d="M${ex},${top} V${ey}"/>`;
      paths += `<circle class="dot" cx="${ex}" cy="${ey}" r="4"/>`;
    }
    paths += `<circle class="dot" cx="${sx}" cy="${sy}" r="4"/>`;
    svg.innerHTML = paths;
  }
  new ResizeObserver(schedule).observe(conn);
  window.addEventListener('load', schedule, { once: true });

  tabs($$('[data-connect]', root), btn => {
    const key = btn.dataset.connect;
    const m = MOMENTS[key];
    root.dataset.state = key;
    views.forEach(v => {
      v.setImage(cap(m.img[v.device]), `${DEVICE_NAME[v.device]} · ${m.connect[v.device]}`);
      v.setMs(m.ms);
      v.setMarks({ item: m.marks[v.device] });
      v.el.parentElement.querySelector('figcaption span').textContent = m.connect[v.device];
    });
    schedule();
  }, $('[data-connect="park"]', root));
}

/* ---------- D 자산 출처 ---------- */

function initCredits() {
  const host = $('[data-front="credits"]');
  if (host) renderCredits(host);
}

export async function init() {
  loadMockups();
  for (const fn of [initWho, initPriority, initGlance, initRules, initDevices, initConnect, initCredits]) {
    try { fn(); } catch (err) { console.error('[front]', fn.name, err); }
  }
}
