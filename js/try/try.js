/* ④ #try 모바일 사진·배송 기록 직접 체험
 *
 * 큰 정면 아이폰(assets/mockups/iphone-front.*) 안에 현재 NEXT UI 수동 모드 폰(ui-bridge createDevice phone/manual)을 띄운다.
 * - 화면 상자: iphone-front.json 의 screen(백분율)·uiFit(contain, center, 늘리지 않음). 프레임 이미지는 pointer-events:none
 * - 상태 준비: 섹션이 화면에 들어오거나 'next:xp-done' 을 받으면 104동 정차 · A-023(1203호) 상세로 맞춘다
 *   (js/story/try.js 의 검증된 준비 코드를 옮김). 준비는 직접 기록으로 세지 않고, 사진·전달 기록을 자동으로 만들지 않는다
 * - 조작은 폰 화면 안의 현재 UI 흐름 그대로(배송 사진 촬영 → 촬영 → 이 사진 저장 → 전달 저장 · 다음 배송)
 *   쇼잉이 더하는 것: 촬영 순간 셔터음(sfx-shutter)과 짧은 플래시, 카메라를 못 쓸 때 '파일에서 사진 고르기'(쇼잉 file input →
 *   현재 UI #photo-input 흐름), 오른쪽 안내(지금 할 일 한 줄 + 네 단계 표시), 완료 줄
 * - 카메라 트랙은 카메라 시트 닫기(현재 UI)·섹션 이탈·탭 숨김·pagehide 때 모두 멈춘다(ui/showing/try-manual.js)
 * - 폰은 체험 전용 사본 ui/try-phone.html(scripts/build_try_phone.sh)로 띄운다. 그 안의 기록·사진은 이 페이지 로드 동안만
 *   메모리·임시 DB 에 있고(ui/showing/try-isolate.js) 다른 탭과 나누지 않는다. 그래서 열 때마다, 다시 들어올 때마다 처음 장면이다.
 *   서버 업로드 없음
 */

import { createDevice } from '../ui-bridge.js';
import { PhotoBridge } from './photo.js';

const TARGET = 'A-023';
const DEFAULT_STOP = { building: '104', buildingLabel: '104동', entrance: '서쪽 공동현관', unit: '1203호', shipment: TARGET };
const STEPS = ['요청 확인', '사진 찍기 또는 고르기', '사진 저장', '전달 기록'];
const TRANSMISSION = { unsubmitted: '미제출', queued: '전송 대기', sending: '전송 중', unknown: '수신 확인 중', received: '배송사 수신', error: '전송 실패' };

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const wait = ms => new Promise(r => setTimeout(r, ms));

function ensureStylesheet() {
  if (document.querySelector('link[rel="stylesheet"][href$="css/try.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../../css/try.css', import.meta.url).href;
  document.head.append(link);
}

function cameraProblem(err) {
  const name = err && err.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return '카메라 권한이 거부됐습니다';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return '이 기기에서 카메라를 찾지 못했습니다';
  if (name === 'NotReadableError') return '다른 앱이 카메라를 쓰고 있습니다';
  if (name === 'TrackEnded') return '카메라 연결이 끊겼습니다';
  return '이 환경에서는 카메라를 열 수 없습니다';
}

export async function init(root) {
  ensureStylesheet();
  const q = sel => root.querySelector(sel);
  const el = {
    stage: q('[data-try-stage]'),
    phone: q('[data-try-phone]'),
    screen: q('[data-try-screen]'),
    flash: q('[data-try-flash]'),
    building: q('[data-try-building]'),
    unit: q('[data-try-unit]'),
    lead: q('[data-try-lead]'),
    steps: q('[data-try-steps]'),
    now: q('[data-try-now]'),
    alt: q('[data-try-alt]'),
    fileBtn: q('[data-try-file-btn]'),
    file: q('[data-try-file]'),
    done: q('[data-try-done]'),
    doneLine: q('[data-try-done-line]'),
    doneNote: q('[data-try-done-note]'),
    live: q('[data-try-live]'),
    status: q('[data-try-status]'),
  };
  if (!el.stage || !el.screen) throw new Error('try: partial 구조가 다릅니다');

  const st = {
    handle: null,
    startJob: null,
    prepared: false,
    prepJob: null,
    stop: { ...DEFAULT_STOP },
    cameraError: null,     // 마지막 카메라 오류(미리보기·사진 저장이 생기면 지운다)
    cameraBlocked: false,  // 이 폰에서 카메라를 연 적이 실패로 끝났는지(카메라가 다시 켜질 때까지 유지)
    filePending: false,    // 쇼잉 '파일에서 사진 고르기'로 파일 창을 연 동안
    visible: false,
    lastSig: '',
    poll: 0,
  };

  const photo = new PhotoBridge(() => st.handle, {
    flash: el.flash,
    onMessage: () => {},              // 안내 문구는 상태에서 만든다(아래 render)
    onState: () => render(),
    onCameraError: err => { st.cameraError = err || { name: 'Error' }; st.cameraBlocked = true; render(); focusFileButton(); },
  });

  /* ---------- 폰 만들기 ---------- */

  function start() {
    if (st.startJob) return st.startJob;
    el.stage.dataset.tryState = 'loading';
    // 2026-10-21 사용자 요청: 열 때마다 처음 장면('배송 사진 촬영' 버튼이 있는 1203호 상세)부터. 사본 try-phone.html 이 기록을 이 폰 안에만 둔다
    const job = (async () => {
      try {
        const handle = await createDevice({ device: 'phone', mode: 'manual', page: 'try-phone.html', container: el.screen, fit: true, maxScale: 1, title: 'NEXT 휴대폰 화면(직접 기록)' });
        handle.iframe.classList.add('try-ui');
        handle.iframe.setAttribute('tabindex', '0');
        await handle.ready;
        // 기다리는 사이 다시 만들기(clear)로 새 폰이 시작됐으면 이 폰은 버린다(폰 두 개 방지)
        if (st.startJob !== job) { handle.destroy(); return false; }
        st.handle = handle;
        if (!handle.win.__tryManual) await handle.inject({ href: 'showing/try-manual.js' });
        photo.attach();
        // 카메라가 다시 켜지면 이전 오류 표시를 지운다
        const m = handle.win.__tryManual;
        if (m) {
          const live = m.hooks.onCameraLive;
          m.hooks.onCameraLive = () => { st.cameraError = null; st.cameraBlocked = false; live?.(); render(); };
          // 폰 화면 안에서 더 스크롤할 곳이 없는 휠은 페이지로 넘긴다(스크롤 가두기 없음).
          // 같은 휠을 바깥 창에도 알려 main.js 의 도착 고정이 풀리게 한다
          m.hooks.forwardWheel = dy => {
            try { window.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, bubbles: false })); } catch { /* noop */ }
            window.scrollBy({ top: dy, left: 0, behavior: 'instant' });
          };
        }
        readStop();
        el.stage.dataset.tryState = 'ready';
        if (st.visible || st.wantPrepare) await prepare();
        startPoll();
        render();
        return true;
      } catch (err) {
        // 다시 만들기(clear)로 이미 다른 폰이 시작됐으면 그 상태를 덮지 않는다
        if (st.startJob !== job) return false;
        console.warn('[try] 폰 화면을 띄우지 못했습니다', err);
        el.stage.dataset.tryState = 'failed';
        if (el.now) el.now.textContent = '휴대폰 화면을 불러오지 못했습니다. 새로고침하거나 아래로 계속 볼 수 있습니다';
        st.startJob = null;
        return false;
      }
    })();
    st.startJob = job;
    return job;
  }

  function state() {
    try { return st.handle?.win?.NextApp?.getState() || null; } catch { return null; }
  }

  function parcel(id = TARGET) {
    try { return st.handle?.win?.NextDay?.parcels?.[id] || null; } catch { return null; }
  }

  /* 실제 UI 의 A-023 값(동·호수)으로 제목을 맞춘다. 3D 이벤트 값과 다르면 UI 값을 쓴다 */
  function readStop() {
    const p = parcel();
    if (p) {
      st.stop.building = String(p.stop);
      st.stop.buildingLabel = p.stop + '동';
      st.stop.unit = p.unit + '호';
    }
    if (el.building) el.building.textContent = st.stop.buildingLabel;
    if (el.unit) el.unit.textContent = st.stop.unit;
  }

  /* ---------- 상태 준비: 104동 정차 · A-023 상세 (js/story/try.js ensurePrepared('deliver') 와 같은 순서) ---------- */

  function prepare() {
    if (st.prepJob) return st.prepJob;
    st.prepJob = (async () => {
      const h = st.handle;
      let s = state();
      if (!h || !s?.day) return;
      if (s.day.stage === 'boarding' || s.day.stage === 'planning') {
        if (s.day.stage === 'boarding') h.dispatch('dayPlan');
        h.dispatch('dayChoose', { routeId: 'time' });   // 추천 경로(시간 우선 · 상동 북측부터): 3D 에서 고른 경로와 같음
        h.dispatch('dayStart');
        h.dispatch('drive');
        h.dispatch('park');
        await wait(120);
        s = state();
      }
      if (s.vehicle !== 'parked' && s.day.stage === 'delivery') { h.dispatch('park'); await wait(80); s = state(); }
      if (s.day.stage === 'delivery') {
        const a = s.items[TARGET];
        const cam = photo.state();
        const busy = cam && (cam.sheet || cam.preview);
        const onDetail = !!h.doc.querySelector('#phone [data-action="camera"], #phone [data-action="resultAndNext"]');
        if (!busy && a && a.result === 'pending' && !a.deferred && (s.selected !== TARGET || !onDetail)) {
          h.click('#phone [data-mobile-tab="delivery"]');
          await wait(150);
          if (!h.click(`#phone [data-action="open"][data-id="${TARGET}"]`)) h.click('#phone [data-action="open"]');
          await wait(150);
        }
      }
      st.prepared = true;
      el.screen.classList.add('is-live');
      render();
    })().finally(() => { st.prepJob = null; });
    return st.prepJob;
  }

  /* 사진을 넣을 수 있는 화면(A-023 상세)인지 확인하고 맞춘다 */
  async function readyForPhoto() {
    await prepare();
    const h = st.handle;
    const s = state();
    if (!h || !s?.day || s.day.stage !== 'delivery') return false;
    const a = s.items[TARGET];
    if (!a || a.proof || a.result !== 'pending') return false;
    if (s.selected !== TARGET || !h.doc.querySelector('#phone [data-action="camera"]')) {
      h.click('#phone [data-mobile-tab="delivery"]');
      await wait(150);
      if (a.deferred) h.dispatch('resume', { id: TARGET });
      else h.click(`#phone [data-action="open"][data-id="${TARGET}"]`);
      await wait(150);
    }
    return true;
  }

  /* ---------- 단계 판단과 표시 ---------- */

  function modalKind() {
    try {
      const d = st.handle?.doc?.getElementById('modal');
      if (!d || !d.open) return null;
      if (d.dataset.cameraSheet) return 'camera';
      if (d.querySelector('[data-action="photo"]')) return 'photo-method';
      return 'other';
    } catch { return null; }
  }

  function snapshot() {
    const s = state();
    const a = s?.items?.[TARGET] || null;
    const p = parcel();
    const cam = photo.state() || { sheet: false, live: false, preview: false };
    const kind = modalKind();
    const photoSaved = !!(a && a.proof);
    const delivered = !!(a && a.result === 'delivered');
    if (cam.preview || photoSaved) st.cameraError = null;
    if (cam.preview || photoSaved) st.filePending = false;
    // 현재 UI가 카메라 시트를 오류로 그렸는데 훅이 오지 않은 경우에도 안내·파일 고르기를 오류로 맞춘다
    if (cam.error && !cam.live && !st.cameraError) { st.cameraError = { name: 'SheetError' }; st.cameraBlocked = true; }
    let step = 0;          // 0 요청 확인, 1 사진, 2 저장, 3 전달, 4 끝
    let sub = '';
    if (!s?.day || !a) step = 0;
    else if (delivered) step = 4;
    else if (a.result === 'undelivered') { step = 4; sub = 'undelivered'; }
    else if (photoSaved) step = 3;
    else if (cam.preview) step = 2;
    else if (st.cameraError) { step = 1; sub = 'camera-error'; }
    else if (kind === 'camera') { step = 1; sub = cam.live ? 'camera' : 'camera-wait'; }
    else if (kind === 'photo-method' || st.filePending) { step = 1; sub = 'file'; }
    const stage = s?.day?.stage;
    const onDetail = !!st.handle?.doc?.querySelector('#phone [data-action="camera"], #phone [data-action="resultAndNext"]');
    let method = null;     // 마지막 사진 입력 경로 'camera' | 'file'
    try { method = st.handle?.win?.__tryManual?.lastInput?.() || null; } catch { /* noop */ }
    if (!method) method = photo.method;
    return { s, a, p, cam, kind, step, sub, method, stage, onDetail, selected: s?.selected, photoSaved, delivered };
  }

  function nowText(v) {
    const req = v.p?.request || '문 앞에 놓아주세요';
    const unit = st.stop.unit;
    if (!st.handle) return '휴대폰 화면을 준비하고 있습니다';
    if (v.step === 4) {
      if (v.sub === 'undelivered') return `${unit} 미전달 결과를 기록했습니다`;
      return `${unit} 전달을 기록했습니다`;
    }
    if (v.step === 3) return '사진만 저장했고 아직 배송 대기입니다. \'전달 저장 · 다음 배송\'을 눌러야 전달이 기록됩니다';
    if (v.step === 2) {
      // 파일로 넣었거나 카메라를 열지 못한 환경이면 다시 고르기로 안내한다('다시 촬영'은 같은 오류를 되풀이한다)
      if (v.method === 'file' || st.cameraBlocked) return '사진을 확인하고 \'이 사진 저장\'을 누르세요. 다시 고르려면 \'•••\'에서 \'사진 파일 선택\'';
      return '사진을 확인하고 \'이 사진 저장\'을 누르세요. 다시 찍으려면 \'•••\'에서 \'다시 촬영\'';
    }
    if (v.step === 1) {
      if (v.sub === 'camera-error') return `${cameraProblem(st.cameraError)}. 파일로 이어갑니다. '파일에서 사진 고르기'를 누르세요`;
      if (v.sub === 'camera') return '문 앞 물품이 보이게 맞추고 촬영 버튼을 누르세요';
      if (v.sub === 'camera-wait') return '카메라를 여는 중입니다. 권한을 묻는 창이 뜨면 허용하세요';
      return '기기에 있는 사진을 고르세요';
    }
    if (v.stage === 'boarding' || v.stage === 'planning') return '휴대폰 화면을 준비하고 있습니다';
    if (v.stage && v.stage !== 'delivery') return '이미 이 배송의 기록을 마쳐 다시 기록할 수 없습니다';
    if (v.a?.deferred) return `${unit}를 나중에 배송으로 미뤘습니다. 배송 목록에서 다시 열 수 있습니다`;
    if (v.selected !== TARGET || !v.onDetail) return `'배송' 탭에서 ${unit}를 다시 열어 주세요`;
    return `${unit}의 요청은 '${req}'입니다. '배송 사진 촬영'을 눌러 보세요`;
  }

  const CHECK = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.2 10.4l3.1 3.1 6.5-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* 안내 문장을 의미 단위로 넣는다: 문장마다 .try-sen(줄은 문장 사이에서 먼저 바뀐다),
     따옴표로 묶은 버튼 이름·요청은 .try-nw(줄바꿈 없음). 글은 textContent 로만 넣는다(css/try.css) */
  function richLine(node, text) {
    node.replaceChildren();
    if (!text) return;
    text.split(/(?<=\.)\s+/).forEach((sen, i) => {
      if (i) node.append(' ');
      const s = document.createElement('span');
      s.className = 'try-sen';
      sen.split(/('[^']+')/).forEach(part => {
        if (!part) return;
        if (/^'[^']+'$/.test(part)) {
          const q = document.createElement('span');
          q.className = 'try-nw';
          q.textContent = part;
          s.append(q);
        } else s.append(part);
      });
      node.append(s);
    });
  }

  function render() {
    const v = snapshot();
    const now = nowText(v);
    const noPhoto = v.step === 4 && !v.photoSaved;
    // 네 단계 표시
    const items = STEPS.map((name, i) => {
      let mark = 'todo';
      if (i < v.step) mark = 'done';
      else if (i === v.step) mark = 'now';
      if (noPhoto && (i === 1 || i === 2)) mark = 'skip';
      return { name, mark, i };
    });
    const sig = JSON.stringify([items.map(x => x.mark), now, v.step, v.sub, v.a?.transmission, v.photoSaved, st.prepared, !!st.handle, st.stop.unit]);
    if (sig === st.lastSig) return;
    st.lastSig = sig;
    el.steps.innerHTML = items.map(x => `<li class="try-step" data-mark="${x.mark}"${x.mark === 'now' ? ' aria-current="step"' : ''}>`
      + `<span class="try-step-mark">${x.mark === 'done' ? CHECK : x.mark === 'skip' ? '<i></i>' : x.i + 1}</span>`
      + `<span class="try-step-name">${x.name}${x.mark === 'skip' ? '<small> 사진 없음</small>' : ''}</span></li>`).join('');
    // 지금 할 일 한 줄은 지금 단계 바로 아래에(끝나면 목록 아래 완료 줄로)
    const nowLi = el.steps.querySelector('[data-mark="now"]');
    if (nowLi && st.handle) {
      const p = document.createElement('p');
      p.className = 'try-step-now';
      richLine(p, now);
      nowLi.append(p);
    }
    if (el.now) el.now.textContent = st.handle ? '' : now;
    if (el.live && el.live.textContent !== now) el.live.textContent = now;
    // 카메라를 못 쓸 때 파일 고르기 강조
    const showAlt = v.step === 1 && v.sub === 'camera-error';
    el.alt.hidden = !showAlt;
    // 머리 리드는 늘 '기록해 보세요'(2026-10-21 사용자 요청). 끝난 기록은 섹션에 다시 들어올 때 처음 장면으로 되돌린다(restartFresh)
    const finished = v.step === 4;
    if (el.lead) {
      const lead = `이제 ${st.stop.unit} 문 앞에서 요청을 확인하고 기록해 보세요`;
      if (el.lead.textContent !== lead) el.lead.textContent = lead;
    }
    // 완료 줄(섹션을 벗어났다 돌아오면 restartFresh 가 처음 장면으로 되돌린다)
    el.done.hidden = !finished;
    if (finished) {
      const bits = [v.photoSaved ? '사진 저장됨' : '사진 없음', v.sub === 'undelivered' ? '미전달 기록 저장됨' : '전달 기록 저장됨', TRANSMISSION[v.a?.transmission] || '전송 상태 미확인'];
      el.doneLine.textContent = bits.join(' · ');
      el.done.querySelector('[data-try-done-label]').textContent = '내 직접 기록';
      const next = v.selected && v.selected !== TARGET ? v.s?.items?.[v.selected] : null;
      const np = next ? parcel(v.selected) : null;
      richLine(el.doneNote, np && np.unit + '호' === st.stop.unit
        ? `다음 배송도 ${st.stop.unit}이지만 요청은 '${np.request}'입니다. 휴대폰 화면에서 확인해 보세요`
        : '');
      el.doneNote.hidden = !el.doneNote.textContent;
    }
    el.stage.dataset.tryStep = String(v.step);
  }

  function focusFileButton() {
    if (!el.fileBtn) return;
    el.fileBtn.classList.add('is-suggested');
    // 현재 UI 가 오류 시트를 열며 초점을 가져간 뒤에 옮긴다
    setTimeout(() => { if (st.visible && !el.alt.hidden) el.fileBtn.focus({ preventScroll: true }); }, 300);
  }

  function startPoll() {
    clearInterval(st.poll);
    st.poll = setInterval(() => { if (st.visible || st.near) render(); }, 400);
  }

  /* ---------- 파일 고르기(카메라를 쓸 수 없을 때) ---------- */

  el.fileBtn?.addEventListener('click', async () => {
    st.filePending = true;
    render();
    el.file.click();
  });
  el.file?.addEventListener('cancel', () => { st.filePending = false; render(); });
  el.file?.addEventListener('change', async () => {
    const file = el.file.files && el.file.files[0];
    el.file.value = '';
    if (!file) { st.filePending = false; render(); return; }
    await start();
    if (await readyForPhoto()) {
      st.cameraError = null;
      await photo.useFile(file);     // 셔터음·플래시 없음
    }
    st.filePending = false;
    render();
  });

  /* ---------- 처음 장면으로 ---------- */

  // 1203호 기록이 끝났거나 미뤄져 '배송 사진 촬영' 장면으로 돌아갈 수 없는 상태
  function spent() {
    const v = snapshot();
    if (!st.handle || !v.s?.day) return false;
    return v.step === 4 || !['boarding', 'planning', 'delivery'].includes(v.stage) || !!v.a?.deferred;
  }

  // 다시 보여 줄 때 처음 장면이 아닌 상태(끝났거나 미뤘거나, 사진 단계까지 진행). 파일 창을 연 동안은 제외
  function stale() {
    return !st.filePending && (spent() || snapshot().step > 0);
  }

  // 처음 장면('배송 사진 촬영' 버튼이 있는 1203호 상세)이 바로 보이게 폰을 다시 만든다(기록은 폰 안 메모리에만 있어 함께 사라진다)
  async function restartFresh() {
    if (st.resetJob) return st.resetJob;
    st.resetJob = (async () => {
      if (st.startJob) await st.startJob;
      return clear();
    })().finally(() => { st.resetJob = null; });
    return st.resetJob;
  }

  async function clear() {
    photo.stopCamera('clear');
    const had = st.handle;
    st.handle = null;
    st.prepared = false;
    st.startJob = null;
    st.cameraError = null;
    st.cameraBlocked = false;
    st.filePending = false;
    clearInterval(st.poll);
    el.screen.classList.remove('is-live');
    try { had?.destroy(); } catch { /* noop */ }
    render();
    await wait(250);
    st.wantPrepare = true;
    return start();
  }

  /* ---------- 생명 주기 ---------- */

  // 가까워지면 폰을 만들고(불러오는 시간 확보), 화면에 들어오면 104동 정차 · 1203호 상세로 맞춘다
  const nearIo = new IntersectionObserver(entries => {
    for (const e of entries) st.near = e.isIntersecting;
    if (st.near) start();
  }, { rootMargin: '100% 0px 100% 0px', threshold: 0 });
  nearIo.observe(el.stage);

  const visIo = new IntersectionObserver(entries => {
    const was = st.visible;
    for (const e of entries) st.visible = e.isIntersecting;
    if (st.visible) {
      st.wantPrepare = true;
      // 다시 들어왔을 때 1203호 기록이 이미 끝나 있으면 '이미 기록했습니다' 대신 처음 장면부터 보여 준다
      if (!was && stale()) { restartFresh(); return; }
      start().then(ok => { if (ok) prepare(); });
    } else {
      // 섹션을 벗어나면 카메라를 끈다(현재 UI 의 카메라 시트 '뒤로'와 같은 정리)
      const n = photo.stopCamera('leave');
      if (n) console.info('[try] 섹션 이탈 · 카메라 트랙 정지', n);
    }
  }, { threshold: 0.12 });
  visIo.observe(el.stage);

  window.addEventListener('next:xp-done', e => {
    const stop = e.detail && e.detail.stop;
    if (stop) Object.assign(st.stop, stop);
    if (el.building) el.building.textContent = st.stop.buildingLabel;
    if (el.unit) el.unit.textContent = st.stop.unit;
    st.wantPrepare = true;
    if (stale()) { restartFresh().then(readStop); return; }
    start().then(ok => { if (ok) { readStop(); prepare(); } });
  });

  // 3D 다시 체험: 손댄 기록이 있으면 처음 장면으로 되돌려 둔다(섹션 밖에서 일어나므로 화면이 바뀌는 것은 보이지 않는다)
  window.addEventListener('next:xp-reset', () => {
    if (st.visible || !st.handle) return;
    if (stale()) restartFresh();
  });

  // 뒤로 가기 캐시(bfcache)로 돌아오면 init 이 다시 돌지 않으므로 끝난 기록을 여기서 되돌린다
  window.addEventListener('pageshow', e => { if (e.persisted && stale()) restartFresh(); });

  window.addEventListener('pagehide', () => photo.stopCamera('pagehide'));
  document.addEventListener('visibilitychange', () => { if (document.hidden) photo.stopCamera('hidden'); });

  if (reduceMotion.matches) el.stage.classList.add('is-reduced');
  render();

  // 검수용 훅(?trydebug=1)
  if (new URLSearchParams(location.search).has('trydebug')) {
    window.__try = { st, photo, state, snapshot, prepare, start, clear, render, readyForPhoto, spent, stale, restartFresh };
  }
}
