/* ④ 직접 기록(#try) 폰(수동 모드 iframe) 전용 주입 스크립트
 * js/try/try.js 가 handle.inject({href:'showing/try-manual.js'}) 로 넣는다.
 * ui/showing/story-manual.js(하루 이야기 '직접 해 보기'에서 검증한 코드)를 복사해 전역 이름만 window.__tryManual 로 바꿨다.
 * 서비스 UI는 고치지 않는다. 화면 배치·스타일을 바꾸지 않고 아래만 더한다.
 *
 * 1) 카메라 스트림 추적: navigator.mediaDevices.getUserMedia 를 감싸 이 문서에서 연 모든 스트림을 기억한다.
 *    현재 UI(directions-adapter.js)는 closeModal()·Esc(cancel)·촬영 후 트랙을 멈춘다. 그 밖의 경우
 *    (섹션 이탈, 페이지 이탈)에도 멈출 수 있게 stopAll() 을 연다.
 *    #modal 이 실제로 닫힌 상태로 남으면(다시 열리지 않으면) 남은 트랙도 멈춘다.
 * 2) 셔터 알림: 실시간 카메라 시트의 촬영 버튼([data-action=capture])을 누르면 hooks.onShutter() 를 부른다
 *    (쇼잉 쪽이 셔터음을 낸다). 파일 선택 경로에서는 부르지 않는다.
 * 3) 파일 넘겨받기: 쇼잉 페이지에서 고른 파일을 현재 UI의 파일 선택 흐름(#photo-input change)으로 넘긴다.
 * 4) Esc 알림(#try 에서는 훅을 걸지 않음, 원본과 같게 남김): 초점이 이 iframe 안에 있으면 Esc 가 바깥 쇼잉 대화상자에 닿지 않는다. 이 문서에 열린 dialog 가 없을 때
 *    누른 Esc 만 hooks.onEscape() 로 알린다(열린 시트가 있으면 현재 UI가 그 시트를 닫게 그대로 둔다).
 */
(() => {
  'use strict';
  if (window.__tryManual) return;

  const streams = new Set();
  const hooks = { onShutter: null, onCameraError: null, onCameraLive: null, onCameraStop: null, onEscape: null };
  const log = [];
  let lastInput = null;     // 'camera' | 'file' | null
  let lastStream = null;    // 가장 최근에 연 카메라 스트림

  function note(type, extra) {
    log.push({ at: Date.now(), type, ...extra });
    if (log.length > 50) log.shift();
  }

  function liveTracks() {
    const out = [];
    for (const s of streams) for (const t of s.getTracks()) out.push(t);
    return out;
  }

  const md = navigator.mediaDevices;
  if (md && typeof md.getUserMedia === 'function') {
    const original = md.getUserMedia.bind(md);
    const wrapped = async function getUserMedia(constraints) {
      note('request');
      try {
        const stream = await original(constraints);
        streams.add(stream);
        lastStream = stream;
        /* 기기 쪽에서 트랙이 끊기면(ended, stop() 으로는 오지 않음) 현재 UI는 오류 시트로 바꾼다.
           쇼잉 안내도 같은 오류로 맞추게 onCameraError({name:'TrackEnded'}) 로 알린다(가장 최근 스트림만) */
        stream.getVideoTracks().forEach(t => t.addEventListener('ended', () => {
          if (stream !== lastStream) return;
          note('ended');
          try { hooks.onCameraError?.({ name: 'TrackEnded' }); } catch { /* noop */ }
        }, { once: true }));
        note('live', { tracks: stream.getTracks().length });
        try { hooks.onCameraLive?.(); } catch { /* noop */ }
        return stream;
      } catch (err) {
        note('error', { name: err && err.name });
        try { hooks.onCameraError?.(err); } catch { /* noop */ }
        throw err;
      }
    };
    try {
      Object.defineProperty(md, 'getUserMedia', { configurable: true, writable: true, value: wrapped });
    } catch {
      md.getUserMedia = wrapped;
    }
  }

  function stopAll(reason = 'stop') {
    let stopped = 0;
    for (const s of streams) {
      for (const t of s.getTracks()) {
        if (t.readyState !== 'ended') { t.stop(); stopped++; }
      }
    }
    document.querySelectorAll('video').forEach(v => {
      const src = v.srcObject;
      if (src && typeof src.getTracks === 'function') src.getTracks().forEach(t => t.stop());
    });
    if (stopped) {
      note('stopped', { reason, stopped });
      try { hooks.onCameraStop?.(reason); } catch { /* noop */ }
    }
    return stopped;
  }

  /* 카메라 시트가 열려 있으면 현재 UI의 '뒤로'(discardPhoto → closeModal)로 닫는다 */
  function closeCameraSheet() {
    const dialog = document.getElementById('modal');
    if (dialog && dialog.open && dialog.dataset.cameraSheet) {
      const back = dialog.querySelector('[data-action="discardPhoto"]');
      if (back) back.click();
    }
    return stopAll('close-sheet');
  }

  function cameraState() {
    const dialog = document.getElementById('modal');
    const sheet = !!(dialog && dialog.open && dialog.dataset.cameraSheet);
    const live = liveTracks().some(t => t.readyState === 'live');
    const preview = !!(dialog && dialog.open && dialog.querySelector('#photo-preview'));
    // 현재 UI가 카메라 시트를 오류 상태로 그렸는지(권한 거부·기기 없음·연결 끊김)
    const error = !!(sheet && dialog.querySelector('.camera-sheet[data-camera-state="error"]'));
    return { sheet, live, preview, error, tracks: liveTracks().map(t => ({ kind: t.kind, readyState: t.readyState })) };
  }

  /* 셔터 알림: 실시간 스트림이 있을 때 촬영 버튼을 누르면 */
  document.addEventListener('click', e => {
    const b = e.target && e.target.closest && e.target.closest('[data-action="capture"]');
    if (!b || b.disabled) return;
    if (!liveTracks().some(t => t.readyState === 'live')) return;
    lastInput = 'camera';
    note('shutter');
    try { hooks.onShutter?.(); } catch { /* noop */ }
  }, true);

  /* 마지막 사진 입력 경로: 실시간 촬영이면 'camera', #photo-input(현재 UI '사진 파일 선택' 또는 쇼잉 파일 넘겨받기)이면 'file'.
     쇼잉 안내 문구가 '다시 촬영'과 '사진 파일 선택' 중 무엇을 권할지 고르는 데만 쓴다 */
  document.addEventListener('change', e => {
    if (e.target && e.target.id === 'photo-input' && e.target.files && e.target.files.length) lastInput = 'file';
  }, true);

  /* #modal 이 닫힌 채로 남으면 남은 트랙을 멈춘다(현재 UI가 다시 열면 그대로 둔다) */
  function watchModal() {
    const dialog = document.getElementById('modal');
    if (!dialog) return;
    dialog.addEventListener('close', () => {
      setTimeout(() => { if (!dialog.open) stopAll('modal-closed'); }, 0);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchModal, { once: true });
  else watchModal();

  window.addEventListener('pagehide', () => stopAll('pagehide'));
  /* 탭이 숨겨지면 시트까지 닫는다(바깥 try.js 도 같은 정리를 하지만, iframe 만 따로 떠 있을 때도 멈추게) */
  document.addEventListener('visibilitychange', () => { if (document.hidden) closeCameraSheet(); });

  /* keydown 시점에는 시트(dialog)가 아직 열려 있으므로, 시트를 닫는 Esc 는 여기서 걸러진다 */
  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
    if (document.querySelector('dialog[open]')) return;
    note('escape');
    try { hooks.onEscape?.(); } catch { /* noop */ }
  });

  /* 쇼잉 페이지에서 고른 파일을 현재 UI의 파일 선택 흐름으로 넘긴다.
     현재 UI의 'photo' 동작(대상 물품 지정 + #photo-input.click())을 그대로 부르되, 이중 파일 창을 막으려고
     이 순간에만 #photo-input.click 을 비운다. 그 다음 input.files 를 채우고 change 를 보낸다. */
  async function useFile(file) {
    const input = document.getElementById('photo-input');
    const phone = document.getElementById('phone');
    if (!input || !phone || !file) return false;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.dataset.action = 'photo';
    trigger.hidden = true;
    phone.append(trigger);
    input.click = () => {};
    try {
      trigger.click();
      await new Promise(r => setTimeout(r, 60));
    } finally {
      delete input.click;
      trigger.remove();
    }
    const dt = new DataTransfer();
    dt.items.add(file instanceof File ? file : new File([file], 'photo.jpg', { type: file.type || 'image/jpeg' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    note('file', { type: file.type, size: file.size });
    return true;
  }

  /* 5) 휠 넘기기(#try 전용): 폰 화면 안에서 더 스크롤할 곳이 없는 휠은 막고 hooks.forwardWheel(dy) 로 바깥 페이지에 넘긴다.
     이 문서는 html·body 가 overflow:hidden 이라 Chrome 이 바깥으로 이어 스크롤하지 않고 휠을 먹는다.
     폰 화면 안 스크롤 영역(배송 상세 목록, 시트 등)은 끝에 닿기 전까지 그 영역만 스크롤한다 */
  function canScroll(node, dy) {
    for (let n = node && node.nodeType === 1 ? node : node?.parentElement; n && n !== document.documentElement && n !== document.body; n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY;
      if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') continue;
      if (n.scrollHeight <= n.clientHeight + 1) continue;
      if (dy > 0 && Math.ceil(n.scrollTop + n.clientHeight) < n.scrollHeight - 1) return true;
      if (dy < 0 && n.scrollTop > 0) return true;
    }
    return false;
  }
  window.addEventListener('wheel', e => {
    if (!hooks.forwardWheel || e.ctrlKey || e.defaultPrevented) return;
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    if (canScroll(e.target, e.deltaY)) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
    e.preventDefault();
    try { hooks.forwardWheel(e.deltaY * unit); } catch { /* noop */ }
  }, { passive: false });

  window.__tryManual = { hooks, stopAll, closeCameraSheet, cameraState, liveTracks, useFile, log, lastInput: () => lastInput };
})();
