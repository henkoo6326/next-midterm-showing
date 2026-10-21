(() => {
  'use strict';
  const q = new URLSearchParams(location.search);
  function init() {
    document.body.dataset.gallery = q.get('gallery') || '';
    document.body.dataset.study = ['core', 'cargo', 'sheet', 'night', 'vehicle'].includes(q.get('study')) ? q.get('study') : 'core';
    const styles = document.createElement('script');
    styles.src = 'development/pv5-layout.js';
    document.head.append(styles);
    if (q.get('entry') !== 'notification') return;

    // Local fixture only: never dispatch vehicle, delivery, or persistence changes.
    // One notification per fixture session; reset explicitly starts a new session.
    let connected = false, permission = true, notified = false, opened = false;
    let notificationVisible = false;
    const panel = document.createElement('section');
    panel.className = 'entry-console';
    panel.innerHTML = '<b>앱 실행 전 · 연결 알림 시연</b><button data-entry="connect">등록 차량 연결</button><button data-entry="disconnect">연결 해제</button><button data-entry="permission">알림 허용됨</button><button data-entry="reset">다시 보기</button><small data-entry-status role="status">등록 차량 연결을 시연해 보세요.</small><small>실제 차량 감지·OS 알림은 연결하지 않았습니다. 연결은 탑승을 증명하지 않습니다. 다시 보기는 알림 시연만 초기화하며 배송 기록은 유지합니다.</small>';
    const anchor = document.querySelector('.prototype-note');
    if (!anchor) return;
    anchor.after(panel);
    const report = text => { panel.querySelector('[data-entry-status]').textContent = text; };
    const vehicle = () => window.NextApp?.getState?.()?.vehicle || 'unknown';
    const screens = () => ['phone', 'center', 'cluster'].map(id => document.getElementById(id)).filter(Boolean);

    // Adapter dispatches call its lexical render(), so wrapping NextApp.render
    // would miss them. Watch only root child replacements, not map/proof subtrees.
    // Disconnect during our own writes, and never render the app from this callback.
    const observer = new MutationObserver(paint);
    function observe() {
      if (!opened) screens().forEach(el => observer.observe(el, { childList: true }));
    }
    function paint() {
      if (opened) return;
      observer.disconnect();
      try {
        const mode = vehicle(), parked = mode === 'parked', moving = mode === 'moving';
        if (!parked && notificationVisible) {
          notificationVisible = false;
          report('차량 상태 변경으로 시작 알림을 숨겼습니다. 같은 시연의 알림은 반복하지 않습니다.');
        }
        const notice = notificationVisible && connected && permission && parked;
        const title = moving ? '주행 중입니다' : !parked ? '차량 상태 미확인' : !connected ? '차량 연결 대기' : !permission ? '알림이 꺼져 있습니다' : '등록 차량 연결됨';
        const description = !parked ? '정차 상태를 확인한 뒤 앱을 확인하세요.' : !connected ? '등록 차량 연결을 시연해 보세요.' : !permission ? '앱 아이콘으로 직접 실행할 수 있습니다.' : '새 시작 알림은 없습니다. 앱 아이콘으로 실행할 수 있습니다.';
        const content = {
          phone: `<div class="entry-lock"><p>10월 20일 화요일</p><strong class="entry-time">07:30</strong><div class="entry-notification">${notice ? '<span class="entry-appicon">N↗</span><small>NEXT · 지금</small><h2>등록 차량에 연결됐어요</h2><p>정차 중이라면 오늘 배송을 확인하세요.</p><button data-entry="open">오늘 배송 열기</button>' : `<h2>${title}</h2><p>${description}</p>`}</div>${parked ? '<button class="entry-launch" data-entry="open">NEXT 앱 실행</button>' : ''}<small class="entry-caption">잠금 화면 디자인 시연 · 실제 OS 화면 아님</small></div>`,
          center: `<div class="entry-center"><small>차량 홈 · 시연</small><img src="development/generated/cargo-van.png" alt="NEXT 컨셉 차량"><h2>${parked ? '휴대폰에서 NEXT를 실행하세요' : moving ? '주행 중입니다' : '차량 상태 미확인'}</h2><p>${parked ? '오늘 배송을 확인할 수 있습니다.' : '정차 상태를 확인한 뒤 앱을 확인하세요.'}</p></div>`,
          cluster: `<div class="entry-cluster"><strong>${parked ? '0' : '—'}<small>km/h</small></strong><b>${parked ? 'P' : moving ? '주행 시연' : '상태 미확인'}</b><p>NEXT 실행 전 · 차량 계기판 예시</p></div>`
        };
        for (const id of ['phone', 'center', 'cluster']) {
          const el = document.getElementById(id);
          if (el && el.innerHTML !== content[id]) el.innerHTML = content[id];
        }
      } finally { observe(); }
    }
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-entry]');
      if (!b) return;
      const action = b.dataset.entry;
      if (action === 'open') {
        // Recheck on activation; a stale button must not bypass the motion lock.
        if (opened || vehicle() !== 'parked' || !window.NextApp?.render) return;
        opened = true;
        notificationVisible = false;
        observer.disconnect();
        report('앱을 열었습니다. 기존 배송 상태를 유지합니다.');
        window.NextApp.render();
        return;
      }
      if (action === 'connect') {
        if (connected) {
          report('중복 연결 이벤트 · 새 알림을 만들지 않았습니다.');
        } else {
          connected = true;
          if (!opened && permission && vehicle() === 'parked' && !notified) {
            notified = true;
            notificationVisible = true;
            report('시작 알림 1회 표시 · 실제 OS 알림 아님');
          } else {
            report(notified ? '중복 연결 알림 억제 · 다시 보기 전에는 반복하지 않습니다.' : '현재 앱·권한·차량 상태에서는 알림을 발행하지 않습니다.');
          }
        }
      } else if (action === 'disconnect') {
        connected = false;
        notificationVisible = false;
        report('연결 해제 시연 · 배송 상태는 변경하지 않았습니다.');
      } else if (action === 'permission') {
        permission = !permission;
        if (!permission) notificationVisible = false;
        panel.querySelector('[data-entry="permission"]').textContent = permission ? '알림 허용됨' : '알림 거부됨';
        report(permission ? '알림 허용 · 지난 연결 알림을 재발행하지 않습니다.' : '알림 거부 · 시작 알림을 숨겼습니다.');
      } else if (action === 'reset') {
        opened = false;
        connected = false;
        notified = false;
        notificationVisible = false;
        permission = true;
        panel.querySelector('[data-entry="permission"]').textContent = '알림 허용됨';
        report('알림 시연 초기화 · 배송 기록과 차량 상태는 유지합니다.');
      } else { return; }
      paint();
    });
    paint();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
