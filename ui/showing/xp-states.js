/* 3D 체험(쇼잉) 전용 추가 상태. ui-bridge 의 handle.inject({href:'showing/xp-states.js'}) 로 iframe 안에 넣는다.
 * 원 UI 파일은 고치지 않는다. 현재 UI 의 구조(.entry-notification, .nda-panel, .nda-choices)를 그대로 쓰고
 * 그 위에 상태 문구·모션·눌림·펄스만 더한다. 스타일은 xp-states.css.
 *
 * window.NextXpStates
 *   phone.quietLock(on)            잠금화면의 연결 대기 안내를 숨김(시계·날짜만 보이게)
 *   phone.notify(body)             등록 차량 연결 → 현재 UI 알림 카드 + 본문만 교체 + 슬라이드 인
 *   phone.open()                   알림의 "오늘 배송 열기"(현재 UI 동작)
 *   center.openAssistant()         NextDeliveryAssistant.open('center')
 *   center.micDown()               마이크 누름(현재 UI: "마이크 연결 중"). 이후 부모가 handle.voice.listen()
 *   center.listening(on)           "듣고 있습니다" 상태에 파형 모션 + 받아쓰기 줄
 *   center.transcript(text)        받아쓰기 줄 글자(부모가 글자 단위로 호출)
 *   center.recognized(text)        "인식 완료" + 사용자 말풍선
 *   center.thinking(on)            점 3개 + "배송 순서를 확인하고 있습니다."
 *   center.alias(from, to)         현재 UI 가 다시 그린 요청 문장을 쇼잉 대사로 바꿔 보여 줌
 *                                  (배송 도우미 사용자 말풍선, autoplay 경로 선택 카드의 요청 제목 두 곳)
 *   applyRoute(firstStop)          배송 도우미 확인창의 "이 순서로 적용"이 하는 일(dayPlan → dayChoose → dayStart)을
 *                                  현재 UI 의 NextDay 리듀서로 그대로 계산해 autoplay 화면에 그린다(NextApp.setDemoState).
 *                                  autoplay 는 dispatch 가 막혀 있어 확인 버튼으로는 적용되지 않는다. firstStop 은 '104' | '105'.
 *                                  센터에서는 이어서 현재 UI 의 '전체 경로 보기'를 눌러 출발지 → 첫 목적지 경로선을 보인다
 *   press(selector, on) / pulse(selector, on) / clearMarks()
 *   arrived(on)                    도착·정차 상태 표식(body.xp-arrived). 화면 표시는 바꾸지 않는다(R2-REQ-03)
 */
(() => {
  'use strict';
  if (window.NextXpStates) return;
  const doc = document;
  const aliases = [];
  let notifyBody = null;

  const q = sel => doc.querySelector(sel);

  // 요청 문장이 보이는 곳: 배송 도우미 사용자 말풍선, autoplay 경로 선택 카드 제목(development/cockpit.js 'AI 배송 도우미' 카드)
  const ALIAS_TARGETS = '.nda-message.nda-user p, #center .cp-destination .cp-kicker + h2';
  function applyPatches() {
    if (aliases.length) {
      for (const p of doc.querySelectorAll(ALIAS_TARGETS)) {
        const text = p.textContent.trim();
        const hit = aliases.find(a => a.from === text);
        if (hit) p.textContent = hit.to;
      }
    }
    if (notifyBody) {
      const card = q('#phone .entry-notification');
      const p = card && card.querySelector('.entry-appicon') ? card.querySelector('p') : null;
      if (p && p.textContent !== notifyBody) p.textContent = notifyBody;
    }
  }
  const observer = new MutationObserver(applyPatches);
  observer.observe(doc.body, { childList: true, subtree: true, characterData: false });

  function toggle(selector, cls, on) {
    const el = typeof selector === 'string' ? q(selector) : selector;
    if (!el) return false;
    el.classList.toggle(cls, on !== false);
    return true;
  }

  const phone = {
    quietLock(on = true) { doc.body.classList.toggle('xp-lock-quiet', on); return true; },
    notify(body) {
      notifyBody = body || null;
      const btn = q('[data-entry="connect"]');
      if (btn) btn.click();
      applyPatches();
      const card = q('#phone .entry-notification');
      if (!card || !card.querySelector('.entry-appicon')) return false;
      doc.body.classList.remove('xp-lock-quiet');
      card.classList.remove('xp-notify-in');
      void card.offsetWidth;
      card.classList.add('xp-notify-in');
      return true;
    },
    open() {
      const btn = q('#phone .entry-notification [data-entry="open"]') || q('[data-entry="open"]');
      if (!btn) return false;
      btn.click();
      return true;
    },
  };

  function voiceControls() { return q('#center .nda-voice-controls'); }

  const center = {
    openAssistant() { return !!window.NextDeliveryAssistant?.open('center'); },
    micDown() {
      const mic = q('#center .nda-mic');
      if (!mic) return false;
      mic.click();
      return true;
    },
    listening(on = true) {
      const vc = voiceControls();
      if (!vc) return false;
      vc.classList.toggle('xp-listening', on);
      let wave = vc.querySelector('.xp-wave');
      let line = vc.querySelector('.xp-transcript');
      if (on) {
        if (!line) {
          line = doc.createElement('p');
          line.className = 'xp-transcript';
          line.setAttribute('aria-live', 'polite');
          vc.prepend(line);
        }
        if (!wave) {
          wave = doc.createElement('span');
          wave.className = 'xp-wave';
          wave.setAttribute('aria-hidden', 'true');
          wave.innerHTML = '<i></i><i></i><i></i><i></i><i></i><i></i><i></i>';
          const mic = vc.querySelector('.nda-mic');
          if (mic) mic.after(wave); else vc.append(wave);
        }
      } else {
        wave?.remove();
      }
      return true;
    },
    transcript(text) {
      const line = q('#center .xp-transcript');
      if (!line) return false;
      line.textContent = text;
      line.classList.toggle('xp-typing', true);
      return true;
    },
    recognized(text) {
      const vc = voiceControls();
      if (!vc) return false;
      center.listening(false);
      vc.classList.remove('xp-listening');
      const status = vc.querySelector('[role="status"]');
      if (status) status.textContent = '인식 완료';
      vc.querySelector('.xp-transcript')?.remove();
      const log = q('#center .nda-messages');
      if (log && text) {
        const msg = doc.createElement('div');
        msg.className = 'nda-message nda-user xp-added';
        msg.innerHTML = '<span class="nda-sr">나: </span><p></p>';
        msg.querySelector('p').textContent = text;
        log.append(msg);
        const body = q('#center .nda-body');
        if (body) body.scrollTop = body.scrollHeight;
      }
      return true;
    },
    thinking(on = true) {
      const log = q('#center .nda-messages');
      if (!log) return false;
      let el = log.querySelector('.xp-thinking');
      if (on && !el) {
        el = doc.createElement('div');
        el.className = 'nda-message nda-assistant xp-thinking xp-added';
        el.innerHTML = '<span class="nda-sr">배송 도우미: </span><p><span class="xp-dots" aria-hidden="true"><i></i><i></i><i></i></span>배송 순서를 확인하고 있습니다.</p>';
        log.append(el);
        const body = q('#center .nda-body');
        if (body) body.scrollTop = body.scrollHeight;
      } else if (!on && el) {
        el.remove();
      }
      return true;
    },
    alias(from, to) {
      if (!aliases.some(a => a.from === from)) aliases.push({ from, to });
      applyPatches();
    },
  };

  function clearMarks() {
    for (const el of doc.querySelectorAll('.xp-pulse, .xp-pressed')) el.classList.remove('xp-pulse', 'xp-pressed');
  }

  /* 경로 적용: vehicle-assistant.js confirm() 과 같은 순서의 리듀서 이벤트. 시각은 demo-bridge.js 와 같은 고정값 */
  function applyRoute(firstStop) {
    const E = window.NextDay, app = window.NextApp;
    if (!E?.create || !E?.reduce || typeof app?.setDemoState !== 'function') return false;
    const at = '2026-10-20T08:00:00+09:00';
    try {
      let s = E.create();
      const act = (type, extra = {}) => { s = E.reduce(s, { type, at, ...extra }); };
      act('dayPlan');
      const route = (E.routes?.(s) || []).find(r => r.stops?.[0] === firstStop);
      if (!route) return false;
      if (s.day.candidateId !== route.id) act('dayChoose', { routeId: route.id });
      act('dayStart');
      if (s.day?.routeId !== route.id || s.day?.stage !== 'delivery' || s.destination !== firstStop) return false;
      if (app.setDemoState(s) !== true) return false;
      // 센터: 정차 중 배송 단계 지도는 목적지 주변(차를 목적지에 둔 그림)이다. 아직 출발 전이므로 현재 UI 의
      // '전체 경로 보기' 버튼을 눌러 출발지 → 첫 목적지 경로선을 보인다(북측 먼저의 autoplay 경로 표시와 같은 구도)
      const overview = q('#center [data-cockpit="location"]');
      if (overview && overview.getAttribute('aria-label') === '전체 경로 보기') overview.click();
      return true;
    } catch {
      return false;
    }
  }

  window.NextXpStates = Object.freeze({
    phone,
    center,
    applyRoute,
    press: (selector, on = true) => toggle(selector, 'xp-pressed', on),
    pulse: (selector, on = true) => toggle(selector, 'xp-pulse', on),
    clearMarks,
    /* 도착·정차 상태: 지나온 경로선(출발지 → 104동, .nx-sangdong-route·halo·끝점)을 숨긴다(xp-states.css).
       현재 UI 정차 화면은 차 표시를 경로 끝에 두고 지나온 선을 그대로 그려 차 뒤로 선이 이어져 보인다.
       정차 화면에는 다음 목적지 경로 상태가 없어 새 선은 그리지 않는다. 주행 중에는 끈다 */
    arrived: (on = true) => { doc.body.classList.toggle('xp-arrived', !!on); return true; },
  });
})();
