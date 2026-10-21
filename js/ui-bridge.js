/* NEXT UI iframe 브리지 (ES module, named export만)
 *
 * 같은 출처의 복사본 ui/delivery-app.html 을 iframe 으로 띄우고, 기기 캔버스 하나만
 * iframe 좌상단 (0,0)에 원래 크기(센터 1280×720, 클러스터 800×400, 폰 390×844)로 보이게 한다.
 * 서비스 UI는 고치지 않는다. 셸 숨김은 ui/showing/bridge.css 주입으로만 한다.
 *
 * 사용 예
 *   import { createDevice, group } from './ui-bridge.js';
 *   const center = await createDevice({ device: 'center', mode: 'autoplay', container: el, fit: true });
 *   await center.ready;            // NextApp·NextLiveDemo 준비, 주입 CSS 적용, 글꼴 로드 후
 *   center.seek(12000);            // 세 기기를 같은 시점으로 맞출 때는 group([...]).seek(ms)
 *   center.seek(0, { assistant: 'center' });  // seek 는 #center 를 다시 그려 AI 패널을 지운다. 열어 둘 패널을 넘긴다
 *   center.rectOf('[data-cockpit="ai"]');     // 기기 px {x,y,w,h}
 *
 * 모드
 *   autoplay  ?mobile=app&autoplay=1&gallery=<device>&controller=journey (폰은 &mobileScreen=shipment 추가: journey.html 과 같게)
 *             읽기 전용. dispatch 는 막혀 있고 demo-bridge.js 가 #center [data-action], #phone button,
 *             #center [data-cockpit=ai] 클릭을 캡처 단계에서 막는다. 상태는 seek 로만 바꾼다.
 *   manual    ?mobile=app&gallery=<device>  방문자 localStorage(next-postload-v4)·IndexedDB 에 기록이 남는다
 *   entry     ?mobile=app&entry=notification&gallery=<device>  잠금화면 알림 시연. click('[data-entry="connect"]') 로 알림 표시
 *   query 로 파라미터를 더하거나(값) 지울 수 있다(null).
 *   page 로 같은 폴더의 다른 사본을 띄울 수 있다(예: 'try-phone.html' — #try 체험 폰 전용, 기록을 탭마다 따로 둔다)
 *
 * 음성: iframe 안의 speechSynthesis.speak 와 SpeechRecognition 은 기본 차단한다(allowSpeech:true 로만 허용).
 * 차단 상태의 SpeechRecognition 은 아무 권한도 요청하지 않는 가짜 객체다. 센터 마이크를 누르면
 * 화면은 "마이크 연결 중"이 되고, handle.voice.listen() → "듣고 있습니다",
 * handle.voice.result('상동 호수공원 어디로 가요', true) → "인식 완료" + 배송 도우미 응답 순서로 연출할 수 있다.
 */

export const DEVICES = Object.freeze({
  center: Object.freeze({ width: 1280, height: 720 }),
  cluster: Object.freeze({ width: 800, height: 400 }),
  phone: Object.freeze({ width: 390, height: 844 }),
});

const APP_URL = new URL('../ui/delivery-app.html', import.meta.url);
const BRIDGE_CSS = 'showing/bridge.css'; // iframe 문서(ui/delivery-app.html) 기준
const READY_TIMEOUT_MS = 20000;
const UI_VERSION = 'uikit-1021';

export function deviceUrl(device, mode = 'autoplay', query = {}, page = null) {
  if (!DEVICES[device]) throw new Error(`ui-bridge: 알 수 없는 기기 ${device}`);
  const params = new URLSearchParams();
  params.set('mobile', 'app');
  if (mode === 'autoplay') {
    params.set('autoplay', '1');
    params.set('gallery', device);
    if (device === 'phone') params.set('mobileScreen', 'shipment');
    params.set('controller', 'journey');
  } else if (mode === 'entry') {
    params.set('entry', 'notification');
    params.set('gallery', device);
  } else if (mode === 'manual') {
    params.set('gallery', device);
  } else {
    throw new Error(`ui-bridge: 알 수 없는 모드 ${mode}`);
  }
  params.set('v', UI_VERSION); // 캐시 토큰. 앱은 v 를 읽지 않는다. delivery-app.html 의 ?v= 와 같이 올린다
  for (const [key, value] of Object.entries(query || {})) {
    if (value === null || value === undefined || value === false) params.delete(key);
    else params.set(key, String(value));
  }
  const url = page ? new URL(page, APP_URL) : new URL(APP_URL);
  url.search = params.toString();
  return url.href;
}

/* ---------- iframe 안 음성 차단 ---------- */

function patchSpeech(win, registry) {
  if (!win || win.__nextBridgeSpeechPatched) return;
  try {
    const synth = win.speechSynthesis;
    if (synth) {
      Object.defineProperty(synth, 'speak', { configurable: true, writable: true, value: () => {} });
    }
  } catch { /* 일부 브라우저는 speechSynthesis 가 없다 */ }
  class BlockedRecognition {
    constructor() {
      this.lang = 'ko-KR';
      this.continuous = false;
      this.interimResults = false;
      this.onstart = this.onresult = this.onerror = this.onend = null;
    }
    start() { registry.current = this; }
    stop() { if (registry.current === this) registry.current = null; this.onend?.(); }
    abort() { if (registry.current === this) registry.current = null; }
    addEventListener() {}
    removeEventListener() {}
  }
  try {
    Object.defineProperty(win, 'SpeechRecognition', { configurable: true, writable: true, value: BlockedRecognition });
    Object.defineProperty(win, 'webkitSpeechRecognition', { configurable: true, writable: true, value: BlockedRecognition });
  } catch { /* noop */ }
  win.__nextBridgeSpeechPatched = true;
}

/* ---------- 주입 ---------- */

function injectInto(doc, { css, js, href } = {}) {
  const jobs = [];
  if (!doc) return Promise.reject(new Error('ui-bridge: iframe 문서가 없습니다'));
  const head = doc.head || doc.documentElement;
  if (css) {
    const style = doc.createElement('style');
    style.dataset.bridge = 'inject';
    style.textContent = css;
    head.append(style);
  }
  if (href) {
    const list = Array.isArray(href) ? href : [href];
    for (const item of list) {
      const url = new URL(item, doc.baseURI).href;
      if (/\.css(\?|#|$)/.test(url)) {
        if (doc.querySelector(`link[data-bridge-href="${CSS.escape(url)}"]`)) continue;
        const link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = url;
        link.dataset.bridgeHref = url;
        jobs.push(new Promise((resolve, reject) => {
          link.onload = resolve;
          link.onerror = () => reject(new Error(`ui-bridge: CSS 로드 실패 ${url}`));
        }));
        head.append(link);
      } else {
        if (doc.querySelector(`script[data-bridge-href="${CSS.escape(url)}"]`)) continue;
        const script = doc.createElement('script');
        script.src = url;
        script.dataset.bridgeHref = url;
        jobs.push(new Promise((resolve, reject) => {
          script.onload = resolve;
          script.onerror = () => reject(new Error(`ui-bridge: 스크립트 로드 실패 ${url}`));
        }));
        head.append(script);
      }
    }
  }
  if (js) {
    if (typeof js === 'function') {
      jobs.push(Promise.resolve().then(() => js(doc.defaultView, doc)));
    } else {
      const script = doc.createElement('script');
      script.dataset.bridge = 'inject';
      script.textContent = String(js);
      head.append(script);
    }
  }
  return Promise.all(jobs).then(() => undefined);
}

/* ---------- 준비 판정 ---------- */

function isReady(win, device, mode) {
  try {
    const doc = win.document;
    const app = win.NextApp;
    if (!app || typeof app.getState !== 'function') return false;
    if (mode === 'autoplay' && !win.NextLiveDemo) return false;
    // 저장된 사진 확인(IndexedDB)이 끝나기 전에는 잠금 화면이 그려져 있고 dispatch·클릭이 무시된다.
    // 잠금 화면이 보인다고 준비된 것으로 보지 않고, 앱이 알려 주는 준비 완료를 기다린다
    if (typeof app.isReady === 'function' && !app.isReady()) return false;
    const state = app.getState();
    if (!state || !state.day) return false;
    const el = doc.getElementById(device);
    return !!(el && el.childElementCount > 0);
  } catch {
    return false;
  }
}

/* ---------- 기기 만들기 ---------- */

export async function createDevice({
  device,
  mode = 'autoplay',
  container,
  fit = true,
  query = {},
  allowSpeech = false,
  maxScale = 1,
  title,
  page = null,
} = {}) {
  const size = DEVICES[device];
  if (!size) throw new Error(`ui-bridge: 알 수 없는 기기 ${device}`);
  if (!(container instanceof HTMLElement)) throw new Error('ui-bridge: container(HTMLElement)가 필요합니다');

  const iframe = document.createElement('iframe');
  iframe.title = title || { center: 'NEXT 센터페시아 화면', cluster: 'NEXT 클러스터 화면', phone: 'NEXT 휴대폰 화면' }[device];
  iframe.width = String(size.width);
  iframe.height = String(size.height);
  iframe.setAttribute('scrolling', 'no');
  iframe.dataset.device = device;
  iframe.dataset.mode = mode;
  iframe.className = 'ui-device-frame';
  Object.assign(iframe.style, {
    display: 'block',
    border: '0',
    width: size.width + 'px',
    height: size.height + 'px',
    maxWidth: 'none',
    maxHeight: 'none',
    minWidth: size.width + 'px',
    minHeight: size.height + 'px',
    flex: 'none',
    transformOrigin: '0 0',
    background: 'transparent',
    opacity: '0',
    transition: 'opacity .4s cubic-bezier(0.77,0,0.175,1)',
  });

  const registry = { current: null };
  let destroyed = false;
  let scale = 1;
  let resizeObserver = null;
  let pollTimer = null;

  function layout() {
    if (!fit || destroyed) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (!cw) return;
    const sx = cw / size.width;
    const sy = ch ? ch / size.height : sx;
    scale = Math.max(0.01, Math.min(sx, sy, maxScale));
    const left = (cw - size.width * scale) / 2;
    const top = ch ? (ch - size.height * scale) / 2 : 0;
    iframe.style.position = 'absolute';
    iframe.style.left = left + 'px';
    iframe.style.top = Math.max(0, top) + 'px';
    iframe.style.transform = `scale(${scale})`;
    if (!ch) container.style.height = size.height * scale + 'px';
  }

  if (fit) {
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    resizeObserver = new ResizeObserver(layout);
    resizeObserver.observe(container);
  }

  // 문서가 바뀔 때마다(첫 로드 포함) 음성 차단을 가능한 빨리 건다
  function earlyPatch() {
    if (destroyed) return;
    try {
      const win = iframe.contentWindow;
      if (win && win.location.href !== 'about:blank' && !allowSpeech) patchSpeech(win, registry);
    } catch { /* 다른 출처면 접근 불가 */ }
  }

  const ready = new Promise((resolve, reject) => {
    const started = performance.now();
    let cssInjected = false;
    iframe.addEventListener('load', () => {
      earlyPatch();
      const doc = iframe.contentDocument;
      if (doc && !cssInjected) {
        cssInjected = true;
        injectInto(doc, { href: BRIDGE_CSS }).catch(err => console.warn(err));
      }
    });
    const tick = () => {
      if (destroyed) { reject(new Error('ui-bridge: destroy 됨')); return; }
      earlyPatch();
      const win = iframe.contentWindow;
      let doc = null;
      try { doc = iframe.contentDocument; } catch { /* noop */ }
      if (doc && doc.head && !cssInjected && win.location.href !== 'about:blank') {
        cssInjected = true;
        injectInto(doc, { href: BRIDGE_CSS }).catch(err => console.warn(err));
      }
      if (win && doc && isReady(win, device, mode)) {
        const link = doc.querySelector('link[data-bridge-href*="showing/bridge.css"]');
        const cssDone = link && link.sheet ? Promise.resolve() : new Promise(r => {
          if (!link) { r(); return; }
          link.addEventListener('load', r, { once: true });
          link.addEventListener('error', r, { once: true });
          setTimeout(r, 2000);
        });
        Promise.all([cssDone, doc.fonts ? doc.fonts.ready : null]).then(() => {
          if (destroyed) return;
          if (!allowSpeech) patchSpeech(win, registry);
          iframe.style.opacity = '1';
          resolve(handle);
        });
        return;
      }
      if (performance.now() - started > READY_TIMEOUT_MS) {
        reject(new Error(`ui-bridge: ${device}/${mode} 준비 시간 초과`));
        return;
      }
      pollTimer = setTimeout(tick, 40);
    };
    pollTimer = setTimeout(tick, 0);
  });
  ready.catch(() => {});

  iframe.src = deviceUrl(device, mode, query, page);
  container.append(iframe);
  layout();

  const handle = {
    device,
    mode,
    iframe,
    width: size.width,
    height: size.height,
    ready,
    get win() { return iframe.contentWindow; },
    get doc() { return iframe.contentDocument; },
    get scale() { return fit ? scale : 1; },

    /* autoplay 전용. 0~122000ms. opts.assistant 가 'center'|'phone' 이면 seek 뒤 배송 도우미 패널을 다시 연다
       (정차 상태에서만 열린다. NextDeliveryAssistant.open 이 false 를 돌려주면 그대로 둔다) */
    seek(ms, opts = {}) {
      const win = iframe.contentWindow;
      if (mode !== 'autoplay' || !win?.NextLiveDemo) return false;
      const result = win.NextLiveDemo.seek(ms);
      if (opts.assistant) win.NextDeliveryAssistant?.open(opts.assistant);
      return result;
    },

    /* manual/entry 전용. NextApp.dispatch(type, extra). autoplay 에서는 원본이 false 를 돌려준다 */
    dispatch(type, extra = {}) {
      const win = iframe.contentWindow;
      if (!win?.NextApp?.dispatch) return false;
      return win.NextApp.dispatch(type, extra);
    },

    /* {css:string, js:string|function(win,doc), href:string|string[]} href 는 ui/delivery-app.html 기준 상대 경로 */
    inject(opts) { return injectInto(iframe.contentDocument, opts); },

    click(selector) {
      const el = iframe.contentDocument?.querySelector(selector);
      if (!el) return false;
      el.click();
      return true;
    },

    /* 기기 px 좌표(캔버스가 iframe (0,0)에 원래 크기로 있으므로 iframe 뷰포트 좌표와 같다) */
    rectOf(selector) {
      const el = typeof selector === 'string' ? iframe.contentDocument?.querySelector(selector) : selector;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    },

    /* 기기 px 좌표에서 elementFromPoint 후 포인터 이벤트와 click. 누른 요소를 돌려준다 */
    pointAt(x, y) {
      const doc = iframe.contentDocument;
      const win = iframe.contentWindow;
      const el = doc?.elementFromPoint(x, y);
      if (!el) return null;
      const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, view: win, pointerType: 'mouse', isPrimary: true };
      try {
        el.dispatchEvent(new win.PointerEvent('pointerdown', init));
        el.dispatchEvent(new win.MouseEvent('mousedown', init));
        el.dispatchEvent(new win.PointerEvent('pointerup', init));
        el.dispatchEvent(new win.MouseEvent('mouseup', init));
      } catch { /* noop */ }
      const target = el.closest('button, a, [data-action], [data-nda-action], [data-entry], [data-cockpit], label, input, summary') || el;
      target.click();
      return target;
    },

    /* 차단된 음성 인식 연출용(allowSpeech:false 일 때만 의미가 있다) */
    voice: {
      get active() { return !!registry.current; },
      listen() {
        const r = registry.current;
        if (!r || typeof r.onstart !== 'function') return false;
        r.onstart();
        return true;
      },
      result(text, isFinal = true) {
        const r = registry.current;
        if (!r || typeof r.onresult !== 'function') return false;
        const alternative = { transcript: String(text), confidence: 1 };
        const item = { 0: alternative, length: 1, isFinal, item: () => alternative };
        r.onresult({ resultIndex: 0, results: { 0: item, length: 1, item: () => item } });
        return true;
      },
    },

    destroy() {
      destroyed = true;
      clearTimeout(pollTimer);
      resizeObserver?.disconnect();
      try { iframe.contentWindow?.speechSynthesis?.cancel(); } catch { /* noop */ }
      iframe.src = 'about:blank';
      iframe.remove();
    },
  };

  return handle;
}

export function group(handles) {
  const list = handles.filter(Boolean);
  return {
    handles: list,
    ready: Promise.all(list.map(h => h.ready)),
    seek(ms, opts) { return list.map(h => h.seek(ms, opts && opts[h.device] ? { assistant: opts[h.device] } : undefined)); },
    destroy() { list.forEach(h => h.destroy()); },
  };
}
