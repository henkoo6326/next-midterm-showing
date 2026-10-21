/* 하루 이야기 '직접 해 보기' 폰(수동 모드 iframe) 전용 주입 스크립트
 * js/story/try.js 가 handle.inject({href:'showing/story-manual.js'}) 로 넣는다.
 * 서비스 UI는 고치지 않는다. 화면 배치·스타일을 바꾸지 않고 아래만 더한다.
 *
 * 1) 카메라 스트림 추적: navigator.mediaDevices.getUserMedia 를 감싸 이 문서에서 연 모든 스트림을 기억한다.
 *    현재 UI(directions-adapter.js)는 closeModal()·Esc(cancel)·촬영 후 트랙을 멈춘다. 그 밖의 경우
 *    (쇼잉 대화상자를 닫음, 섹션 이탈, 페이지 이탈)에도 멈출 수 있게 stopAll() 을 연다.
 *    #modal 이 실제로 닫힌 상태로 남으면(다시 열리지 않으면) 남은 트랙도 멈춘다.
 * 2) 셔터 알림: 실시간 카메라 시트의 촬영 버튼([data-action=capture])을 누르면 hooks.onShutter() 를 부른다
 *    (쇼잉 쪽이 셔터음을 낸다). 파일 선택 경로에서는 부르지 않는다.
 * 3) 파일 넘겨받기: 쇼잉 페이지에서 고른 파일을 현재 UI의 파일 선택 흐름(#photo-input change)으로 넘긴다.
 * 4) Esc 알림: 초점이 이 iframe 안에 있으면 Esc 가 바깥 쇼잉 대화상자에 닿지 않는다. 이 문서에 열린 dialog 가 없을 때
 *    누른 Esc 만 hooks.onEscape() 로 알린다(열린 시트가 있으면 현재 UI가 그 시트를 닫게 그대로 둔다).
 */
(() => {
  'use strict';
  if (window.__storyManual) return;

  const streams = new Set();
  const hooks = { onShutter: null, onCameraError: null, onCameraLive: null, onCameraStop: null, onEscape: null };
  const log = [];

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
    return { sheet, live, preview, tracks: liveTracks().map(t => ({ kind: t.kind, readyState: t.readyState })) };
  }

  /* 셔터 알림: 실시간 스트림이 있을 때 촬영 버튼을 누르면 */
  document.addEventListener('click', e => {
    const b = e.target && e.target.closest && e.target.closest('[data-action="capture"]');
    if (!b || b.disabled) return;
    if (!liveTracks().some(t => t.readyState === 'live')) return;
    note('shutter');
    try { hooks.onShutter?.(); } catch { /* noop */ }
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

  window.__storyManual = { hooks, stopAll, closeCameraSheet, cameraState, liveTracks, useFile, log };
})();
