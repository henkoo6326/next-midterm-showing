/* C. 하루 이야기 (SPEC 3장 C1~C11)
 *
 * sticky 무대: 세 기기(클러스터·센터·폰) ui-bridge autoplay iframe 을 고정하고, 왼쪽 장면 글이 지나가는 동안
 * 스크롤 진행을 연결 시연 타임라인 ms 로 연속 보간해 세 기기에 같은 값으로 seek 한다(docs/research/05 M5 원리).
 * - seek 한 번이 기기당 약 20~30ms(헤드리스 실측)라 한 프레임에 한 기기씩 돌아가며 맞춘다.
 *   센터는 가장 무거워 스크롤하는 동안에는 CENTER_GAP_MS 간격으로만, 스크롤이 멈추면 정확한 시점으로 맞춘다
 * - iframe 수명: 무대가 화면에서 1뷰포트 안으로 다가오면 미리 만들고, 1.25뷰포트보다 멀어지면 곧바로(1.2초 뒤) 해제한다.
 *   직접 해 보기 대화상자가 열려 있는 동안에도 무대 iframe 3개를 해제한다(대화상자의 수동 폰 1개만 남김).
 *   해제 중·생성 중에는 같은 시점의 정지 캡처가 자리를 지킨다. 앞부분·3D 체험 iframe 과 겹쳐 살아 있는 수를 줄이기 위함
 * - 연결 시연에 없는 상태(사진 저장, 보류, 재처리, 전송 실패)는 폰 자리에 수동 모드 캡처를 겹치고,
 *   센터·클러스터도 같은 수동 모드 상태의 정지 캡처(scenes.js PEERS)로 맞춘다. 그동안 시계는 연결 시연 시각 대신 '수동 모드 캡처'로 표기
 * - 직접 해 보기(C4 전달 기록, C5 사진, C10 업무 종료)는 try.js 의 수동 모드 폰 대화상자
 *
 * 이벤트: 'next:xp-done' {route, skipped} → 경로 안내 문구, 'next:xp-reset' → 기본 안내
 *        보냄: 'next:goto' {id:'top'|'xp'}, 'next:xp-reset'
 */

import { SCENES, PEERS, BAND, TIMELINE_MS, bandAt, isMoving, fmtClock } from './scenes.js';
import { Slot, loadMockups, MOCKUP_IDS } from './devices.js';
import { TryPanel, readUserRecords } from './try.js';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const CAPTURE_INDEX = new URL('../../assets/captures/index.json', import.meta.url);
const SITE = new URL('../../', import.meta.url);
const RELEASE_AFTER_MS = 1200;      // 1.25뷰포트 밖으로 벗어난 뒤 해제까지(경계에서 오가며 다시 만들지 않게)
const NEAR_MARGIN = '100% 0px 100% 0px';
const FAR_MARGIN = '125% 0px 125% 0px';
/* 센터 seek 은 지도 SVG 를 통째로 다시 만들고 그려 프레임을 길게 만든다(실측 JS 만 중앙값 약 30ms, 그리기까지 50ms 넘는 프레임 다수).
   스크롤하는 동안에는 센터를 CENTER_GAP_MS 에 한 번만 맞추고, 스크롤이 SCROLL_IDLE_MS 동안 멈추면 정확한 시점으로 맞춘다.
   클러스터·폰(약 5ms)은 그대로 매 프레임 따라간다 */
const SCROLL_IDLE_MS = 160;
const CENTER_GAP_MS = 500;

/* 3D 체험 결과는 모듈이 늦게 init 되어도 놓치지 않게 import 시점부터 듣는다 */
let routeResult = { route: null, skipped: false, received: false };
const routeListeners = new Set();
window.addEventListener('next:xp-done', e => {
  const d = e.detail || {};
  routeResult = { route: d.route || null, skipped: !!d.skipped, received: true };
  routeListeners.forEach(fn => fn(routeResult));
});
window.addEventListener('next:xp-reset', () => {
  routeResult = { route: null, skipped: false, received: false };
  routeListeners.forEach(fn => fn(routeResult));
});

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

async function loadCaptures() {
  try {
    const res = await fetch(CAPTURE_INDEX, { cache: 'no-cache' });
    if (!res.ok) return [];
    const json = await res.json();
    return (json.captures || []).filter(c => c.mode === 'autoplay' && Number.isFinite(c.ms));
  } catch {
    return [];
  }
}

function nearestCapture(list, device, ms) {
  let best = null;
  for (const c of list) {
    if (c.device !== device) continue;
    // 지나간 시점 중 가장 가까운 것(상태가 앞서 나가 보이지 않게)
    if (c.ms <= ms + 500 && (!best || c.ms > best.ms)) best = c;
  }
  if (!best) best = list.find(c => c.device === device) || null;
  return best ? new URL(best.file, SITE).href : null;
}

/* ---------- 장면 글 만들기 ---------- */

function stepHtml(scene) {
  const chips = (scene.chips || []).map(c => `<span class="evi">${esc(c)}</span>`).join('');
  const note = scene.note ? `<p class="story-step-note">${esc(scene.note)}</p>` : '';
  let actions = '';
  if (scene.tryTask === 'photo') {
    actions = `<div class="story-step-actions">
      <button type="button" class="btn btn--sm" data-try-open="photo" data-try-auto="camera">카메라로 찍기</button>
      <button type="button" class="btn btn--sm" data-try-open="photo" data-try-auto="file">파일에서 고르기</button>
    </div>`;
  } else if (scene.tryTask) {
    actions = `<div class="story-step-actions"><button type="button" class="btn btn--sm" data-try-open="${scene.tryTask}">${esc(scene.tryLabel)}</button></div>`;
  }
  if (scene.reopen) {
    actions += `<div class="story-step-actions"><button type="button" class="btn btn--sm btn--ghost" data-story-reopen="${scene.id}">보류 재처리 보기</button></div>`;
  }
  const user = scene.tryTask ? '<p class="story-step-user" data-step-user></p>' : '';
  const present = scene.present ? ` id="day-${scene.id}" data-present-scene="${esc(scene.present)}"` : '';
  return `<li class="story-step"${present} data-story-step="${scene.id}" style="--len:${scene.len || 1}">
    <div class="story-step-inner">
      <p class="story-step-no"><span>${esc(scene.no)}</span>${esc(scene.name)}</p>
      <h3 class="story-step-title">${esc(scene.title)}</h3>
      <p class="story-step-body">${esc(scene.body)}${chips}</p>
      ${note}${actions}${user}
    </div>
  </li>`;
}

/* ---------- 무대 배치: 세 기기를 같은 축척으로 ---------- */

function layoutDevices(devicesEl, slots) {
  const rect = devicesEl.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const narrow = rect.width < 640 || window.matchMedia('(max-width: 900px)').matches;
  const pad = narrow ? 14 : Math.max(24, Math.min(48, rect.width * 0.03));   // 베젤이 잘리지 않게
  const W = rect.width - pad * 2;
  const H = rect.height - pad * 2;
  const cap = 26;      // 기기 아래 설명 줄
  const g = narrow ? 10 : Math.max(16, Math.min(40, W * 0.025));
  const c = slots.cluster;
  const m = slots.center;
  const p = slots.phone;
  // s=1 일 때 각 기기의 외곽(하우징 포함) 폭·높이
  const foot = slot => {
    const e = slot.ext;
    const w = slot.size.width;
    return { w: w * (1 + e.l + e.r), h: w * (e.t + 1 / slot.aspect + e.b), e };
  };
  const fc = foot(c), fm = foot(m), fp = foot(p);
  devicesEl.dataset.layout = narrow ? 'narrow' : 'wide';
  let s;
  if (!narrow) {
    // [클러스터 / 센터] | 폰
    const sw = (W - g) / (Math.max(fm.w, fc.w) + fp.w);
    const sh1 = (H - g - cap * 2) / (fc.h + fm.h);
    const sh2 = (H - cap) / fp.h;
    s = Math.min(sw, sh1, sh2, 0.9);
  } else {
    // 센터 / [클러스터 | 폰]
    const sw1 = W / fm.w;
    const sw2 = (W - g) / (fc.w + fp.w);
    const sh = (H - g - cap * 2) / (fm.h + Math.max(fc.h, fp.h));
    s = Math.min(sw1, sw2, sh, 0.9);
  }
  s = Math.max(0.12, s);
  for (const slot of Object.values(slots)) slot.setWidth(slot.size.width * s);
  const F = { c: { w: fc.w * s, h: fc.h * s, e: fc.e, sw: c.size.width * s }, m: { w: fm.w * s, h: fm.h * s, e: fm.e, sw: m.size.width * s }, p: { w: fp.w * s, h: fp.h * s, e: fp.e, sw: p.size.width * s } };
  // 화면 상자 왼쪽 위 = 외곽 왼쪽 위 + (l, t) × 화면 폭
  const place = (slot, f, x, y) => { slot.el.style.transform = `translate(${Math.round(x + f.e.l * f.sw)}px, ${Math.round(y + f.e.t * f.sw)}px)`; };
  if (!narrow) {
    const leftW = Math.max(F.m.w, F.c.w);
    const totalW = leftW + g + F.p.w;
    const totalH = Math.max(F.c.h + cap + g + F.m.h + cap, F.p.h + cap);
    const ox = pad + Math.max(0, (W - totalW) / 2);
    const oy = pad + Math.max(0, (H - totalH) / 2);
    const bottom = oy + totalH;
    place(m, F.m, ox, bottom - (F.m.h + cap));
    place(c, F.c, ox, bottom - (F.m.h + cap) - g - (F.c.h + cap));
    place(p, F.p, ox + leftW + g, bottom - (F.p.h + cap));
  } else {
    const rowW = F.c.w + g + F.p.w;
    const totalW = Math.max(F.m.w, rowW);
    const rowH = Math.max(F.c.h, F.p.h);
    const totalH = F.m.h + cap + g + rowH + cap;
    const ox = pad + Math.max(0, (W - totalW) / 2);
    const oy = pad + Math.max(0, (H - totalH) / 2);
    place(m, F.m, ox + (totalW - F.m.w) / 2, oy);
    const rowY = oy + F.m.h + cap + g;
    const rowX = ox + (totalW - rowW) / 2;
    place(c, F.c, rowX, rowY + (rowH - F.c.h));
    place(p, F.p, rowX + F.c.w + g, rowY + (rowH - F.p.h));
  }
  for (const slot of Object.values(slots)) slot.relayoutMockup();
}

/* ---------- init ---------- */

export async function init(root) {
  const story = root.querySelector('[data-story]');
  if (!story) throw new Error('story partial 이 없습니다');
  const stepsEl = story.querySelector('[data-story-steps]');
  const stage = story.querySelector('[data-story-stage]');
  const devicesEl = story.querySelector('[data-story-devices]');
  const bandEl = story.querySelector('[data-story-band]');
  const clockEl = story.querySelector('[data-story-clock]');
  const driveChip = story.querySelector('[data-story-drive-chip]');
  const sceneNameEl = story.querySelector('[data-story-scene-name]');
  const phoneCaption = story.querySelector('[data-phone-caption]');
  const captions = {
    cluster: devicesEl.querySelector('[data-slot="cluster"] figcaption'),
    center: devicesEl.querySelector('[data-slot="center"] figcaption'),
    phone: phoneCaption,
  };
  const BASE_CAPTION = { cluster: '클러스터 · 800×400', center: '센터페시아 · 1280×720', phone: '휴대폰 · 390×844' };
  const endEl = story.querySelector('[data-story-end]');
  const endUser = story.querySelector('[data-story-end-user]');

  stepsEl.innerHTML = SCENES.map(stepHtml).join('');
  bandEl.innerHTML = BAND.map((name, i) => `<li data-band="${i}"><span>${esc(name)}</span></li>`).join('');
  const stepEls = [...stepsEl.querySelectorAll('[data-story-step]')];
  const bandItems = [...bandEl.children];

  /* 경로 안내 */
  const routeOrder = story.querySelector('[data-story-route-order]');
  const routeNote = story.querySelector('[data-story-route-note]');
  const routeBox = story.querySelector('[data-story-route]');
  const c1Title = stepsEl.querySelector('[data-story-step="c1"] .story-step-title');
  const c1 = SCENES.find(s => s.id === 'c1');
  function renderRoute(r) {
    routeBox.dataset.route = r.route || (r.received ? 'skipped' : 'default');
    if (c1Title && c1?.routeTitle) c1Title.textContent = c1.routeTitle[r.route] || c1.routeTitle.default;
    if (r.route === 'south-first') {
      routeOrder.textContent = '고른 순서: 상동 남측 → 상동 북측';
      routeNote.textContent = '시연 데이터가 북측 → 남측 하나뿐이라, 이어지는 화면은 북측 104동부터입니다';
    } else if (r.route === 'north-first') {
      routeOrder.textContent = '고른 순서: 상동 북측 → 상동 남측';
      routeNote.textContent = '3D 체험에서 고른 순서대로 104동부터 이어집니다';
    } else if (r.received) {
      routeOrder.textContent = '기본 순서: 상동 북측 → 상동 남측';
      routeNote.textContent = r.skipped ? '3D 체험을 건너뛰어 기본 순서로 이어집니다' : '경로를 고르지 않아 기본 순서로 이어집니다';
    } else {
      routeOrder.textContent = '기본 순서: 상동 북측 → 상동 남측';
      routeNote.textContent = '3D 체험에서 순서를 고르면 여기에 반영됩니다';
    }
  }
  renderRoute(routeResult);
  routeListeners.add(renderRoute);

  /* 기기 자리 */
  const [mockups, captures] = await Promise.all([loadMockups(), loadCaptures()]);
  // 폰 자리에 겹칠 수동 모드 캡처를 미리 받아 둔다(크로스페이드가 비지 않게)
  const preload = file => { if (!file) return; const img = new Image(); img.decoding = 'async'; img.src = new URL(file, SITE).href; };
  for (const scene of SCENES) for (const [, file] of scene.phone || []) if (file) preload(file);
  for (const peer of Object.values(PEERS)) { preload(peer.center); if (peer.cluster) preload(peer.cluster); }
  const slots = {};
  for (const device of ['cluster', 'center', 'phone']) {
    const el = devicesEl.querySelector(`[data-slot="${device}"]`);
    slots[device] = new Slot(el, device, {
      mode: 'autoplay',
      mockup: mockups.get(MOCKUP_IDS[device]) || null,
      // 클러스터·폰 iframe 은 보이지 않는 센터 지도를 다시 그리지 않게 한다(ui/showing/story-stage.js)
      injectHref: device === 'center' ? null : 'showing/story-stage.js',
    });
  }
  const order = ['center', 'cluster', 'phone'];
  const lastSeek = { center: -1, cluster: -1, phone: -1 };
  const seekTimes = [];
  let rr = 0;

  const relayout = () => layoutDevices(devicesEl, slots);
  new ResizeObserver(relayout).observe(devicesEl);
  relayout();

  /* 직접 해 보기 */
  const tryPanel = new TryPanel(story, {
    mockups,
    onChange: () => renderUser(),
    // 대화상자가 열린 동안 무대 iframe 은 가려지므로 해제하고, 닫히면 무대가 가까이 있을 때 다시 만든다
    onOpen: () => { tryOpen = true; releaseDevices(); },
    onClose: () => { tryOpen = false; if (near) { startDevices(); onScroll(); } },
  });

  function renderUser() {
    const r = readUserRecords();
    for (const el of story.querySelectorAll('[data-step-user]')) {
      const step = el.closest('[data-story-step]')?.dataset.storyStep;
      let text = '';
      if (step === 'c10') {
        text = r.closed ? '직접 기록 · 업무 종료를 직접 눌렀습니다' : '직접 기록 없음 · 위 화면은 시연입니다';
      } else {
        const a = r.items.find(i => i.id === 'A-023');
        text = a ? `직접 기록 · A-023 ${a.parts.join(' · ')} (이 브라우저)` : '직접 기록 없음 · 위 화면은 시연입니다';
      }
      el.textContent = text;
      el.dataset.kind = text.startsWith('직접 기록 ·') ? 'user' : 'demo';
    }
    if (endUser) {
      const bits = r.items.map(i => `${i.id} ${i.parts.join('·')}`);
      if (r.closed) bits.push('업무 종료');
      endUser.textContent = r.any ? `내 직접 기록: ${bits.join(' / ')} · 이 브라우저에만 있습니다` : '직접 기록 없이 시연 화면으로 끝까지 보았습니다';
    }
  }
  renderUser();

  story.addEventListener('click', async e => {
    const open = e.target.closest('[data-try-open]');
    if (open) {
      e.preventDefault();
      const auto = open.dataset.tryAuto;
      if (auto === 'file') {
        // 파일 창은 사용자 클릭 안에서 바로 연다(대화상자는 함께 연다)
        tryPanel.fileInput.click();
        tryPanel.open('photo');
        return;
      }
      await tryPanel.open(open.dataset.tryOpen);
      if (auto === 'camera') tryPanel.run('camera');
      return;
    }
    const reopen = e.target.closest('[data-story-reopen]');
    if (reopen) {
      const scene = SCENES.find(s => s.id === reopen.dataset.storyReopen);
      const el = stepEls[SCENES.indexOf(scene)];
      const r = el.getBoundingClientRect();
      const y = window.scrollY + r.top + r.height * (scene.reopen + 0.06) - anchorY();
      window.scrollTo({ top: y, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    }
  });
  story.querySelector('[data-story-top]').addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('next:goto', { detail: { id: 'top' } }));
  });
  story.querySelector('[data-story-replay]').addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('next:xp-reset'));
    window.dispatchEvent(new CustomEvent('next:goto', { detail: { id: 'xp' } }));
  });

  /* ---------- 스크롤 → 장면·ms ---------- */

  let target = { ms: SCENES[0].ms[0], scene: SCENES[0], index: 0, p: 0, overlay: null, overlayLabel: '', peer: null };
  let visible = false;   // 무대가 1뷰포트 안: seek 진행
  let near = false;      // 1뷰포트 안(생성 기준). visible 과 같지만 대화상자와 별개로 기억
  let tryOpen = false;
  let raf = 0;
  let releaseTimer = null;

  function anchorY() {
    return window.innerHeight * (devicesEl.dataset.layout === 'narrow' ? 0.8 : 0.55);
  }

  function compute() {
    const a = anchorY();
    let index = 0;
    let p = 0;
    for (let i = 0; i < stepEls.length; i++) {
      const r = stepEls[i].getBoundingClientRect();
      if (r.top <= a) { index = i; p = clamp((a - r.top) / Math.max(1, r.height)); }
    }
    const scene = SCENES[index];
    // 장면 앞뒤 10%는 멈춰 있게(글을 읽는 동안 화면이 쉬도록)
    const t = clamp((p - 0.1) / 0.8);
    // 타임라인 100ms 단위로 맞춰 같은 화면을 거듭 그리지 않게 한다
    const ms = Math.round(lerp(scene.ms[0], scene.ms[1], t) / 100) * 100;
    let overlay = null;
    let overlayLabel = '';
    let peerKey = null;
    if (scene.phone) {
      for (const [start, file, label, key] of scene.phone) if (p >= start) { overlay = file; overlayLabel = label; peerKey = file ? key || null : null; }
    }
    const peerSrc = peerKey && PEERS[peerKey];
    const peer = peerSrc ? { center: new URL(peerSrc.center, SITE).href, cluster: peerSrc.cluster ? new URL(peerSrc.cluster, SITE).href : null } : null;
    return { ms, scene, index, p, overlay: overlay ? new URL(overlay, SITE).href : null, overlayLabel, peer };
  }

  function renderChrome() {
    const { ms, scene, index, p } = target;
    stepEls.forEach((el, i) => {
      el.classList.toggle('is-current', i === index);
      el.classList.toggle('is-past', i < index);
    });
    const b = bandAt(ms, scene.id);
    bandItems.forEach((li, i) => {
      li.classList.toggle('is-done', i < b);
      li.classList.toggle('is-current', i === b);
      if (i === b) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    const { peer } = target;
    // 세 기기가 수동 모드 정지 캡처로 맞춰진 동안은 연결 시연 시각을 보이지 않는다(그 화면은 타임라인 위의 시점이 아니다)
    // 클러스터만 연결 시연(같은 정차 화면)을 쓰는 장면은 그 사실을 함께 적는다(scenes.js PEERS 의 cluster: null)
    clockEl.textContent = !peer ? `연결 시연 ${fmtClock(ms)} / ${fmtClock(TIMELINE_MS)}`
      : peer.cluster ? '수동 모드 캡처 · 세 기기 같은 상태'
        : `폰·센터 수동 모드 캡처 · 클러스터 연결 시연 ${fmtClock(ms)}`;
    stage.classList.toggle('is-manual', !!peer);
    const moving = !peer && isMoving(ms);
    driveChip.hidden = !moving;
    stage.classList.toggle('is-moving', moving);
    sceneNameEl.textContent = `${scene.no} ${scene.name}`;
    slots.phone.setOverlay(target.overlay);
    slots.center.setOverlay(peer ? peer.center : null);
    slots.cluster.setOverlay(peer?.cluster || null);
    // 폰 자리는 좁아(1600 폭에서 약 170px) 장면 이름을 둘째 줄에 둔다
    if (target.overlay) {
      captions.phone.replaceChildren(
        Object.assign(document.createElement('span'), { textContent: '휴대폰 · 수동 모드 캡처' }),
        Object.assign(document.createElement('span'), { className: 'story-cap-sub', textContent: target.overlayLabel }),
      );
    } else {
      captions.phone.textContent = BASE_CAPTION.phone;
    }
    captions.center.textContent = peer ? '센터페시아 · 수동 모드 캡처 · 폰과 같은 상태' : BASE_CAPTION.center;
    captions.cluster.textContent = peer?.cluster ? '클러스터 · 수동 모드 캡처 · 폰과 같은 상태' : BASE_CAPTION.cluster;
    for (const device of order) slots[device].setPlaceholder(nearestCapture(captures, device, ms));
    void p;
  }

  function covered(device) {
    const wanted = device === 'phone' ? target.overlay : target.peer?.[device];
    return !!wanted && !!slots[device].overlayShown;
  }

  /* 한 프레임에 한 기기씩 seek. seek 은 iframe 전체를 다시 그려 무거우므로(센터 약 50~100ms)
     직전 seek 이 걸린 시간의 0.7배만큼은 쉬어 스크롤·입력이 밀리지 않게 한다 */
  let restUntil = 0;
  let lastScrollAt = -Infinity;
  let lastCenterSeekAt = -Infinity;
  let wakeTimer = null;
  const seekCount = { center: 0, cluster: 0, phone: 0 };
  // 자리를 수동 모드 캡처가 덮고 있으면 seek 은 미룬다(보이지 않는 화면을 그리지 않게)
  const needsSeek = d => !!slots[d].handle && !slots[d].el.classList.contains('is-failed') && lastSeek[d] !== target.ms && !covered(d);
  // 센터가 스크롤 중이라 미뤄졌으면, 허용되는 시각에 tick 을 다시 깨운다
  function wakeAt(when) {
    clearTimeout(wakeTimer);
    wakeTimer = setTimeout(() => { wakeTimer = null; if (visible && !raf) raf = requestAnimationFrame(tick); }, Math.max(0, when - performance.now()) + 4);
  }
  /* 센터를 지금 맞춰도 되면 0, 아니면 맞춰도 되는 시각 */
  function centerWaitUntil(now) {
    if (now - lastScrollAt >= SCROLL_IDLE_MS) return 0;
    const gapEnd = lastCenterSeekAt + CENTER_GAP_MS;
    return now >= gapEnd ? 0 : Math.min(gapEnd, lastScrollAt + SCROLL_IDLE_MS);
  }
  function tick(now = performance.now()) {
    raf = 0;
    if (!visible) return;
    if (now < restUntil) { raf = requestAnimationFrame(tick); return; }
    let pending = false;
    let centerHeld = 0;
    for (let k = 0; k < order.length; k++) {
      const device = order[(rr + k) % order.length];
      const slot = slots[device];
      if (!needsSeek(device)) continue;
      if (device === 'center') {
        const until = centerWaitUntil(now);
        if (until) { centerHeld = until; continue; }
      }
      const t0 = performance.now();
      try { slot.handle.seek(target.ms); lastSeek[device] = target.ms; } catch { /* noop */ }
      const took = performance.now() - t0;
      restUntil = performance.now() + took * 0.7;
      if (device === 'center') lastCenterSeekAt = performance.now();
      seekTimes.push([device, took]);
      seekCount[device]++;
      if (seekTimes.length > 400) seekTimes.shift();
      rr = (rr + k + 1) % order.length;
      pending = order.some(d => d !== 'center' && needsSeek(d));
      break;
    }
    if (pending) raf = requestAnimationFrame(tick);
    else if (needsSeek('center')) {
      const until = centerHeld || centerWaitUntil(performance.now());
      if (until) wakeAt(until); else raf = requestAnimationFrame(tick);
    }
  }

  function onScroll(e) {
    if (!visible) return;
    if (e && e.type === 'scroll') lastScrollAt = performance.now();
    const next = compute();
    const changed = next.ms !== target.ms || next.index !== target.index || next.overlay !== target.overlay;
    target = next;
    if (changed) renderChrome();
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function startDevices() {
    if (tryOpen) return;
    for (const device of order) {
      const slot = slots[device];
      if (slot.job) continue;
      lastSeek[device] = -1;
      slot.start().then(() => {
        lastSeek[device] = -1;
        if (!raf && visible) raf = requestAnimationFrame(tick);
      }).catch(() => {});
    }
  }

  function releaseDevices() {
    clearTimeout(releaseTimer);
    for (const device of order) { slots[device].release(); lastSeek[device] = -1; }
  }

  // 무대가 1뷰포트 안으로 다가오면: 기기를 미리 만들고 seek 시작
  const scrollyEl = story.querySelector('[data-story-scrolly]');
  const nearObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      near = entry.isIntersecting;
      if (near) {
        clearTimeout(releaseTimer);
        visible = true;
        story.classList.add('is-near');
        startDevices();
        onScroll();
      } else {
        visible = false;
        story.classList.remove('is-near');
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        clearTimeout(wakeTimer);
      }
    }
  }, { rootMargin: NEAR_MARGIN });
  nearObserver.observe(scrollyEl);
  // 1.25뷰포트보다 멀어지면 곧 해제(1뷰포트와 사이에 여유를 둬 경계에서 만들고 지우기를 반복하지 않게)
  const farObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      clearTimeout(releaseTimer);
      if (!entry.isIntersecting) releaseTimer = setTimeout(releaseDevices, RELEASE_AFTER_MS);
    }
  }, { rootMargin: FAR_MARGIN });
  farObserver.observe(scrollyEl);

  // 하루 이야기 장 전체를 벗어나면 직접 해 보기(카메라 포함)를 멈춘다
  const leaveObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (!entry.isIntersecting) tryPanel.suspend();
  }, { threshold: 0 });
  leaveObserver.observe(story);

  // 퇴근 판 진입
  const endObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      endEl.classList.toggle('is-in', entry.isIntersecting);
      if (entry.isIntersecting) {
        bandItems.forEach(li => { li.classList.add('is-done'); li.classList.remove('is-current'); });
      }
    }
  }, { rootMargin: '0px 0px -30% 0px' });
  endObserver.observe(endEl);

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => { relayout(); onScroll(); });

  target = compute();
  renderChrome();

  // 검수·발표 도구용
  window.__story = {
    target: () => ({ ms: target.ms, scene: target.scene.id, p: target.p, overlay: target.overlay, peer: target.peer }),
    live: () => order.filter(d => slots[d].handle).length,
    slots,
    tryPanel,
    lastSeek,
    seekCount: () => ({ ...seekCount }),
    seekStats: () => {
      const out = {};
      for (const [d, ms] of seekTimes) (out[d] = out[d] || []).push(ms);
      for (const d of Object.keys(out)) {
        const a = out[d].sort((x, y) => x - y);
        out[d] = { n: a.length, median: +a[a.length >> 1].toFixed(1), p95: +a[Math.floor(a.length * 0.95)].toFixed(1), max: +a[a.length - 1].toFixed(1) };
      }
      return out;
    },
    routeResult: () => routeResult,
  };
}
