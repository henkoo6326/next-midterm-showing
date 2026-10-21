/* 쇼잉 페이지 v2 뼈대: partial 로드와 모듈 init, 상단 메뉴 4그룹(현재 위치·명암), 숫자키 1~4, ?present=1 발표 동선, 이동·도착 고정, 진입 모션
 *
 * 섹션 순서(계약): #intro → #roles → #xp → #try → #cluster → #center → #mobile → #system → #sources
 * 메뉴 그룹: 서비스(#intro·#roles) / 체험(#xp·#try) / 기기별 설계(#cluster·#center·#mobile·#system) / 출처(#sources)
 *
 * 모듈 섹션 계약
 *   <section id="try" data-partial="partials/try.html" data-module="js/try/try.js">
 *   1) partial 을 fetch 해 섹션 안에 넣는다
 *   2) 섹션이 화면 가까이 오면(또는 페이지 로드 뒤 여유가 생기면) 모듈을 import 해 `export async function init(root)` 를 부른다
 *   3) partial 이나 모듈 로드·init 이 실패하면 섹션에 안내 문구와 다음 섹션 링크를 보인다
 *
 * 이동 기준점(선택): 섹션 안 요소에 data-goto-anchor 를 달면 그 섹션으로 이동할 때 섹션 머리 대신 그 요소 윗변을
 *   메뉴 아래 + data-goto-offset(px, 기본 0)에 맞춘다. 예: #try 아이폰에 data-goto-anchor data-goto-offset="20"
 * 메뉴 명암: #xp 무대와 [data-nav-dark] 요소, #try .try-band(위 어두운 띠)가 메뉴 아래에 걸리면 메뉴가 어두운 판으로 바뀐다
 *
 * 이벤트(window CustomEvent)
 *   'next:goto'         detail {id}  해당 섹션(또는 요소)으로 이동. 사용자가 누른 동작에서만 보낸다
 *   'next:xp-done'      detail {arrived, skipped, stop}  (3D 체험이 보냄. 여기서는 기록만)
 *   'next:xp-reset'
 *   'next:module-ready' detail {id}  (여기서 보냄: init 이 끝난 섹션)
 */

const params = new URLSearchParams(location.search);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const ORDER = ['intro', 'roles', 'xp', 'try', 'cluster', 'center', 'mobile', 'system', 'sources'];
const GROUPS = [
  { key: '1', id: 'service', target: 'intro', members: ['intro', 'roles'] },
  { key: '2', id: 'experience', target: 'xp', members: ['xp', 'try'] },
  { key: '3', id: 'devices', target: 'cluster', members: ['cluster', 'center', 'mobile', 'system'] },
  { key: '4', id: 'sources', target: 'sources', members: ['sources'] },
];
const PRESENT_LABEL = {
  intro: '서비스', roles: '배송 흐름', xp: '3D 체험', try: '직접 기록',
  cluster: '클러스터', center: '센터페시아', mobile: '모바일', system: '디자인 시스템', sources: '출처',
};

const sections = ORDER.map(id => document.getElementById(id)).filter(Boolean);
const nav = document.querySelector('[data-topnav]');
const navLinks = [...document.querySelectorAll('[data-group-nav] a')];
const groupOf = id => GROUPS.find(g => g.members.includes(id));

function navH() {
  return nav ? nav.getBoundingClientRect().height : 56;
}

/* ---------- 이동 + 도착 고정 ----------
 * 위쪽 섹션(partial, 3D, 이미지)이 늦게 커지면 목표 위치가 밀린다. 이동한 뒤 잠시 '도착 고정'을 둔다.
 *   - 섹션 크기가 바뀌거나 모듈 init 이 끝나면 목표로 다시 맞춘다
 *   - 부드러운 스크롤이 끝나면(scrollend) 한 번 더 맞춘다
 *   - 사용자가 휠·터치·포인터·스크롤 키로 직접 움직이면 바로 풀린다
 *   - 마지막 보정 뒤 PIN_IDLE_MS 동안 변화가 없거나 PIN_MAX_MS 가 지나면 풀린다 */

const PIN_IDLE_MS = 4000;
const PIN_MAX_MS = 25000;
const pin = { el: null, id: null, offset: 0, start: 0, until: 0, smooth: false };

/* 섹션이면 data-goto-anchor 가 있는지 보고 실제로 맞출 요소와 추가 여백을 고른다 */
function resolveTarget(el) {
  if (el && el.matches && el.matches('main > section[id]')) {
    const anchor = el.querySelector('[data-goto-anchor]');
    if (anchor && anchor.getClientRects().length) {
      return { el: anchor, offset: Number(anchor.dataset.gotoOffset) || 0 };
    }
  }
  return { el, offset: 0 };
}

function targetTop() {
  const t = resolveTarget(pin.el);
  return window.scrollY + t.el.getBoundingClientRect().top - navH() - t.offset;
}

function scrollToPin(behavior) {
  const top = Math.max(0, Math.round(targetTop()));
  window.scrollTo({ top, behavior });
}

function releasePin() {
  pin.el = null;
  pin.id = null;
}

export function pinTo(el, { smooth = true, id = el && el.id } = {}) {
  if (!el) return false;
  const now = performance.now();
  pin.el = el;
  pin.id = id;
  pin.start = now;
  pin.until = now + PIN_IDLE_MS;
  pin.smooth = smooth && !reduceMotion.matches;
  showRevealsIn(el.closest('main > section[id]') || el);
  scrollToPin(pin.smooth ? 'smooth' : 'instant');
  if (id) { try { history.replaceState(null, '', location.pathname + location.search + '#' + id); } catch { /* noop */ } }
  return true;
}

function realign(reason) {
  if (!pin.el) return;
  const now = performance.now();
  if (!pin.el.isConnected || now > pin.until || now - pin.start > PIN_MAX_MS) { releasePin(); return; }
  if (Math.abs(targetTop() - window.scrollY) <= 2) return;
  scrollToPin(pin.smooth ? 'smooth' : 'instant');
  pin.until = Math.min(pin.start + PIN_MAX_MS, now + PIN_IDLE_MS);
  if (params.has('debug-pin')) console.info('[main] realign', pin.id, reason);
}

function extendPin() {
  if (!pin.el) return;
  pin.until = Math.min(pin.start + PIN_MAX_MS, Math.max(pin.until, performance.now() + PIN_IDLE_MS));
}

if ('onscrollend' in window) {
  window.addEventListener('scrollend', () => {
    if (!pin.el) return;
    pin.smooth = false;
    realign('scrollend');
  });
} else {
  let t = 0;
  window.addEventListener('scroll', () => {
    clearTimeout(t);
    t = setTimeout(() => { if (pin.el) { pin.smooth = false; realign('scroll-idle'); } }, 160);
  }, { passive: true });
}

const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar']);
for (const type of ['wheel', 'touchstart', 'pointerdown']) {
  window.addEventListener(type, releasePin, { capture: true, passive: true });
}
window.addEventListener('keydown', e => { if (SCROLL_KEYS.has(e.key)) releasePin(); }, { capture: true });

export function goTo(id, { smooth = true } = {}) {
  const el = document.getElementById(id);
  if (!el) return false;
  return pinTo(el, { smooth, id });
}

window.addEventListener('next:goto', e => {
  const id = e.detail && e.detail.id;
  if (id) goTo(id);
});

/* ---------- partial + 모듈 ---------- */

function fallback(section, error) {
  console.error(`[main] ${section.id} 모듈 실패`, error);
  const title = section.dataset.fallbackTitle || '이 구간을 불러오지 못했습니다';
  const next = section.dataset.fallbackNext;
  const nextLabel = section.dataset.fallbackNextLabel || '다음 구간으로 이동';
  section.dataset.moduleState = 'failed';
  section.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'module-status';
  box.setAttribute('role', 'status');
  box.innerHTML = `<div class="wrap"><div class="module-status-in"><strong></strong><p>새로고침하거나 아래 구간에서 이어서 볼 수 있습니다.</p>${next ? `<a href="#${next}" data-goto="${next}"></a>` : ''}</div></div>`;
  box.querySelector('strong').textContent = title;
  if (next) box.querySelector('a').textContent = nextLabel;
  section.append(box);
}

async function loadPartial(section) {
  const url = section.dataset.partial;
  if (!url) return;
  const res = await fetch(new URL(url, document.baseURI), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`partial ${url} ${res.status}`);
  section.innerHTML = await res.text();
  section.dataset.moduleState = 'partial';
  observeReveal(section);
}

const moduleSections = sections.filter(s => s.dataset.partial || s.dataset.module);
const partialJobs = new Map();
const moduleJobs = new Map();

function initModule(section) {
  if (!section) return Promise.resolve();
  if (moduleJobs.has(section.id)) return moduleJobs.get(section.id);
  const job = (async () => {
    await partialJobs.get(section.id);
    if (section.dataset.moduleState === 'failed') return;
    const src = section.dataset.module;
    if (!src) return;
    section.dataset.moduleState = 'loading';
    const mod = await import(new URL(src, document.baseURI).href);
    if (typeof mod.init !== 'function') throw new Error(`${src} 에 init(root) 가 없습니다`);
    await mod.init(section);
    section.dataset.moduleState = 'ready';
    observeReveal(section);
    window.dispatchEvent(new CustomEvent('next:module-ready', { detail: { id: section.id } }));
    extendPin();
    requestAnimationFrame(() => realign('module-ready ' + section.id));
  })().catch(err => fallback(section, err));
  moduleJobs.set(section.id, job);
  return job;
}

for (const section of moduleSections) {
  partialJobs.set(section.id, loadPartial(section).catch(err => fallback(section, err)));
}

const nearObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      nearObserver.unobserve(entry.target);
      initModule(entry.target);
    }
  }
}, { rootMargin: '150% 0px 150% 0px' });
moduleSections.forEach(s => nearObserver.observe(s));

window.addEventListener('load', () => {
  const idle = window.requestIdleCallback || (fn => setTimeout(fn, 1500));
  idle(() => moduleSections.forEach(s => initModule(s)), { timeout: 4000 });
}, { once: true });

/* ---------- 현재 위치: 메뉴 그룹 + 명암 ---------- */

let currentId = null;
let currentGroup = null;

function currentSection() {
  const probe = navH() + innerHeight * 0.35;
  let id = sections[0] && sections[0].id;
  for (const s of sections) {
    if (s.getBoundingClientRect().top <= probe) id = s.id;
  }
  return id;
}

function darkZones() {
  const zones = [];
  // #xp 는 무대 아래(체험 안내·주석)도 --night 바탕이라 무대만이 아니라 섹션 전체를 어두운 구역으로 본다.
  // 섹션 윗변 = 무대 윗변이고, 무대가 카드로 줄어 있는 동안(1.8-1)에는 섹션 윗변이 아직 메뉴 아래에 오지 않는다
  const xp = document.getElementById('xp');
  if (xp) zones.push(xp);
  document.querySelectorAll('main [data-nav-dark], #try .try-band').forEach(el => zones.push(el));
  return zones;
}

function updateNavTone() {
  if (!nav) return;
  const line = navH();
  let dark = false;
  for (const el of darkZones()) {
    const r = el.getBoundingClientRect();
    // 메뉴로 이동하면 무대 윗변이 메뉴 아래변보다 소수점만큼 아래에 놓일 수 있다(56.06 > 56). 1px 여유를 둔다
    if (r.height > 0 && r.top <= line + 1 && r.bottom > line + 1) { dark = true; break; }
  }
  nav.classList.toggle('is-night', dark);
}

function setCurrent(id) {
  if (id && id !== currentId) {
    currentId = id;
    const g = groupOf(id);
    const gid = g ? g.id : null;
    if (gid !== currentGroup) {
      currentGroup = gid;
      for (const a of navLinks) {
        if (a.dataset.group === gid) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      }
    }
    updatePresent();
  }
}

function onScroll() {
  setCurrent(currentSection());
  updateNavTone();
  if (presentOn) updatePresent();
}

// rAF 로 묶되, 3D 렌더 등으로 프레임이 밀려도 늦지 않게 짧은 타이머로 한 번 더 부른다
let rafPending = false;
let scrollTimer = 0;
function scheduleScroll() {
  if (rafPending) return;
  rafPending = true;
  const run = () => { if (!rafPending) return; rafPending = false; clearTimeout(scrollTimer); onScroll(); };
  requestAnimationFrame(run);
  scrollTimer = setTimeout(run, 150);
}
window.addEventListener('scroll', scheduleScroll, { passive: true });
window.addEventListener('resize', () => requestAnimationFrame(onScroll));

const layoutObserver = new ResizeObserver(() => { realign('resize'); onScroll(); });
sections.forEach(s => layoutObserver.observe(s));
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => realign('fonts'));
window.addEventListener('load', () => realign('load'), { once: true });

/* ---------- 링크 클릭 ---------- */

document.addEventListener('click', e => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest('a[href^="#"], [data-goto]');
  if (!a) return;
  const raw = a.dataset.goto || a.getAttribute('href').slice(1);
  let id = raw;
  try { id = decodeURIComponent(raw); } catch { /* noop */ }
  if (!id || !document.getElementById(id)) return;
  e.preventDefault();
  goTo(id);
  // 건너뛰기 링크는 초점도 옮긴다
  if (a.classList.contains('skip')) {
    const t = document.getElementById(id);
    if (t && !t.hasAttribute('tabindex')) t.setAttribute('tabindex', '-1');
    t && t.focus({ preventScroll: true });
  }
});

/* ---------- 숫자키 1~4: 메뉴 그룹 ---------- */

function typingTarget(t) {
  return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

document.addEventListener('keydown', e => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
  if (typingTarget(e.target)) return;
  const g = GROUPS.find(x => x.key === e.key);
  if (!g) return;
  e.preventDefault();
  goTo(g.target);
});

/* ---------- 진입 모션: 글만, 0.45s, 12px. 이미 화면에 있거나 이동해 도착한 섹션은 바로 ---------- */

const revealObserver = new IntersectionObserver(entries => {
  const batch = entries.filter(en => en.isIntersecting).map(en => en.target);
  batch.forEach((el, i) => {
    el.style.setProperty('--reveal-delay', `${Math.min(i, 2) * 60}ms`);
    el.classList.add('is-in');
    revealObserver.unobserve(el);
  });
}, { rootMargin: '0px 0px -8% 0px', threshold: 0 });

function showNow(el) {
  el.classList.add('is-in', 'is-instant');
  revealObserver.unobserve(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('is-instant')));
}

function showRevealsIn(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll('[data-reveal]:not(.is-in)').forEach(showNow);
}

export function observeReveal(root = document) {
  root.querySelectorAll('[data-reveal]:not(.is-in)').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.top < innerHeight && r.bottom > 0) showNow(el);   // 이미 화면 안
    else revealObserver.observe(el);
  });
}

/* ---------- 발표 모드 ?present=1 ----------
 * 동선: 서비스 → 배송 흐름 → 3D 체험 → 직접 기록 → 클러스터 → 센터페시아 → 모바일 → 디자인 시스템 → 출처
 * PageDown·PageUp, N·P 키로 이동. 메뉴 오른쪽 끝에 '발표 3/8 · 3D 체험 · 1:42' */

const presentOn = params.get('present') === '1';
const presentStatus = document.querySelector('[data-present-status]');
let presentStart = 0;

function presentIndex() {
  return Math.max(0, ORDER.indexOf(currentSection()));
}

const fmt = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

function updatePresent() {
  if (!presentOn || !presentStatus) return;
  const i = presentIndex();
  const id = ORDER[i];
  const text = `발표 ${i + 1}/${ORDER.length} · ${PRESENT_LABEL[id] || id} · ${fmt(performance.now() - presentStart)}`;
  if (presentStatus.textContent !== text) presentStatus.textContent = text;
}

function presentStep(dir) {
  const avail = ORDER.filter(id => document.getElementById(id));
  const line = navH() + 8;
  let target = null;
  if (dir > 0) {
    target = avail.find(id => resolveTarget(document.getElementById(id)).el.getBoundingClientRect().top - resolveTarget(document.getElementById(id)).offset > line + 2);
  } else {
    target = [...avail].reverse().find(id => document.getElementById(id).getBoundingClientRect().top < line - 16);
  }
  if (target) goTo(target);
}

if (presentOn) {
  document.body.dataset.present = '1';
  presentStart = performance.now();
  if (presentStatus) presentStatus.hidden = false;
  document.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (typingTarget(e.target)) return;
    const dir = { PageDown: 1, PageUp: -1, n: 1, N: 1, p: -1, P: -1 }[e.key];
    if (!dir) return;
    e.preventDefault();
    presentStep(dir);
  });
  setInterval(updatePresent, 1000);
}

/* ---------- 서비스·출처 장: 대표 렌더 합성, 자산 목록 ---------- */

import('./front/compose.js')
  .then(m => m.composeAll())
  .catch(err => console.error('[main] compose 실패', err));

const creditsHost = document.querySelector('[data-credits]');
if (creditsHost) {
  import('./front/credits.js')
    .then(m => m.renderCredits(creditsHost))
    .catch(err => console.error('[main] credits 실패', err));
}

/* ---------- 시작 ---------- */

observeReveal();
onScroll();

if (location.hash.length > 1) {
  let id = location.hash.slice(1);
  try { id = decodeURIComponent(id); } catch { /* noop */ }
  // 이전 판의 장 주소(#who #priority #glance #rules #devices #connect #why #day #top)는 새 구성의 가까운 섹션으로
  const legacy = { top: 'intro', who: 'roles', priority: 'roles', glance: 'roles', rules: 'roles', devices: 'cluster', connect: 'roles', why: 'roles', day: 'try' };
  if (!document.getElementById(id) && legacy[id]) id = legacy[id];
  const target = document.getElementById(id);
  if (target) {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    const section = target.closest('main > section[id]');
    if (section && section.dataset.module) initModule(section);
    pinTo(target, { smooth: false, id });
  } else {
    const retry = () => {
      const el = document.getElementById(id);
      if (!el) return;
      window.removeEventListener('next:module-ready', retry);
      pinTo(el, { smooth: false, id });
    };
    window.addEventListener('next:module-ready', retry);
  }
}
