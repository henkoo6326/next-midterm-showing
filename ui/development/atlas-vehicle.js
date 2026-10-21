/* Load after a.js, day-ui.js and design-variants.js; before directions-adapter.js.
   Presentation only. PV5 drawing dimensions are not native hardware resolution. */
(() => {
  'use strict';
  if (window.NextVehicle?.atlasInstalled) return;
  const snapshot = Object.freeze({ soc: 78, rangeKm: 214, charging: 'disconnected', source: 'demo', connected: false });
  window.NextVehicle = Object.freeze({ atlasInstalled: true, getState: () => ({ ...snapshot }) });
  const enabled = () => new URLSearchParams(location.search).get('vehicleLayout') !== 'legacy' && document.body?.dataset.app === 'delivery' && (!document.body.dataset.direction || document.body.dataset.direction === 'a');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let sheetOpen = false;
  const mode = c => c.state?.vehicle || 'unknown';
  const stage = c => c.state?.day?.stage;
  const destination = c => stage(c) === 'returning' ? '출발 지점' : `${c.state?.destination || '—'}동`;
  const navigation = c => (stage(c) === 'returning' ? c.returnNavigation : c.navigation) || {};
  const knownNav = n => n.available !== false && ['left', 'right', 'straight'].includes(n.turn) && n.distance != null && n.distance !== '—';
  const area = c => c.stops?.find(s => s.id === c.state?.destination)?.area || '배송 구역';
  function arrow(turn) {
    const path = turn === 'straight' ? 'M26 58V24H13L32 4l19 20H38v34Z' : 'M9 58V33c0-15 9-24 24-24h4V1l23 15-23 16V22h-4c-8 0-12 4-12 12v24Z';
    return `<svg class="av-arrow${turn === 'left' ? ' av-arrow-left' : ''}" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true"><path d="${path}"/></svg>`;
  }

  function energy() {
    const v = window.NextVehicle.getState();
    return `<span class="av-energy"><span>배터리 <b>${v.soc}<small>%</small></b></span><span>주행 가능 <b>${v.rangeKm}<small>km</small></b></span></span>`;
  }
  function sheet() {
    const v = window.NextVehicle.getState();
    return `<aside id="av-vehicle-sheet" class="av-sheet" aria-labelledby="av-vehicle-title" ${sheetOpen ? '' : 'hidden'}><div class="av-sheet-heading"><h2 id="av-vehicle-title">차량 상태</h2><button type="button" data-av-close aria-label="차량 상태 닫기">닫기</button></div><p class="av-sheet-source">PV5 Cargo · 차량 값 시연</p><div class="av-charge"><span>배터리 잔량</span><strong>${v.soc}<small>%</small></strong><meter min="0" max="100" value="${v.soc}" aria-label="시연 배터리 잔량">${v.soc}%</meter></div><dl class="av-vehicle-facts"><div><dt>주행 가능 거리</dt><dd>${v.rangeKm}<small> km</small></dd></div><div><dt>충전 케이블</dt><dd>연결 안 됨</dd></div><div><dt>실제 차량 연결</dt><dd>연결 안 됨</dd></div></dl><p class="av-sheet-note">예시 값입니다. 실제 배터리·충전 상태를 수신하지 않습니다.</p></aside>`;
  }
  function parked(html, c) {
    if (typeof html !== 'string' || !html || !c.ready) return typeof html === 'string' ? html : '';
    const parkedNow = mode(c) === 'parked';
    if (!parkedNow) sheetOpen = false;
    const status = parkedNow ? `<button type="button" class="av-status-button" data-av-status aria-controls="av-vehicle-sheet" aria-expanded="${sheetOpen}">${energy()}<span>차량 상태</span></button>` : `<div class="av-status-static">${energy()}<span>차량 값 시연</span></div>`;
    // Keep existing controls and data-action attributes intact, including day phases.
    const enhanced = html.replace('</header>', status + '</header>');
    return `<div class="av-host av-parked${parkedNow ? '' : ' av-unknown'}">${enhanced}${parkedNow ? sheet() : ''}</div>`;
  }
  function driving(c) {
    sheetOpen = false;
    const n = navigation(c), valid = knownNav(n), returning = stage(c) === 'returning';
    // Use the inspected notification module, but never its sample ETA/road values.
    const notice = valid && typeof window.NextNotifications?.render === 'function'
      ? window.NextNotifications.render('turn', { distance: n.distance, unit: 'm', direction: n.turn,
          road: n.road || n.label || '경로 안내', destination: destination(c) + ' 방향',
          routeCode: '', duration: '', eta: '', remaining: '' }) : '';
    const cue = notice || `${valid ? arrow(n.turn) : '<span class="av-nav-unavailable" aria-hidden="true">—</span>'}<div class="av-distance">${escape(valid ? n.distance : '—')}${valid ? '<small>m</small>' : ''}</div><h2>${escape(valid ? n.label || '경로 안내' : n.label || '경로 확인 필요')}</h2><p>${escape(destination(c))} 방향</p>`;
    const map = typeof c.map === 'function' ? c.map({ theme: document.body.dataset.night === 'true' ? 'dark' : 'light', mode: 'drive', target: c.state.destination, returning, returnFrom: c.state.destination }) : '<p class="av-map-unavailable">지도를 불러오지 못했습니다.</p>';
    return `<div class="av-drive"><header class="av-drive-top"><strong>NEXT <span>주행 안내</span></strong><span>${escape(area(c))} · ${escape(destination(c))}</span><span class="av-demo-label">경로·차량 값 시연</span></header><div class="av-drive-body"><section class="av-maneuver" aria-label="다음 안내"><span class="av-maneuver-label">${returning ? '복귀 안내' : '다음 안내'}</span>${cue}</section><div class="av-road-map">${map}<span class="av-map-credit">© OpenStreetMap contributors</span><span class="av-heading-up">진행 방향 위</span></div></div><footer class="av-drive-bottom"><span class="av-drive-gear">D</span><span>주행 중 작업 입력 잠금</span>${energy()}</footer></div>`;
  }
  function cluster(c) {
    const moving = mode(c) === 'moving', unknown = mode(c) !== 'moving' && mode(c) !== 'parked';
    const n = navigation(c), valid = moving && knownNav(n), v = window.NextVehicle.getState();
    const subtitle = unknown ? '차량 상태 미확인' : moving ? (valid ? n.label || '경로 안내' : n.label || '경로 확인 필요') : stage(c) === 'returning' ? '복귀 목적지' : area(c);
    return `<div class="av-cluster" data-instrument="refined"><header class="av-cluster-top"><span>${escape(destination(c))}</span><span>차량 값 시연 · 실제 연결 없음</span></header><div class="av-cluster-main"><section class="av-speed" aria-label="시연 속도와 기어"><strong>${unknown ? '—' : moving ? '24' : '0'}</strong><span>km/h</span><b aria-label="기어 ${unknown ? '미확인' : moving ? 'D' : 'P'}">${unknown ? '—' : moving ? 'D' : 'P'}</b></section><section class="av-cluster-nav" aria-label="주행 안내"><span>${unknown ? '차량 연결' : moving ? '다음 안내' : stage(c) === 'returning' ? '복귀' : '다음 배송'}</span><div>${valid ? arrow(n.turn) : unknown || moving ? '<b class="av-park-mark">—</b>' : ''}<strong>${escape(unknown ? '확인 필요' : moving ? valid ? n.distance : '—' : destination(c))}${valid ? '<small>m</small>' : ''}</strong></div><p>${escape(subtitle)}</p></section></div><footer class="av-cluster-bottom"><div class="av-cluster-battery"><span>배터리 <b>${v.soc}<small>%</small></b></span><meter min="0" max="100" value="${v.soc}" aria-label="시연 배터리 잔량">${v.soc}%</meter></div><span>주행 가능 <b>${v.rangeKm}<small> km</small></b></span><span>충전 연결 안 됨</span></footer></div>`;
  }

  function filledContext(c) {
    if (!c || !window.NextIcons) return c;
    return { ...c, icon(name, extra) {
      const key = {entry:'entrance',battery:'battery',route:'route',pin:'pin'}[name];
      if (key) return window.NextIcons.icon(key,'filled',{size:24,decorative:true});
      return c.icon?.(name,extra) || '';
    }};
  }
  const variant = window.NEXT_VARIANTS?.a;
  if (variant) {
    const originalCenter = variant.center, originalCluster = variant.cluster;
    variant.center = function(c) {
      if (!enabled() || !c?.ready) return originalCenter?.call(this, c) ?? c?.defaultCenter?.() ?? '';
      return mode(c) === 'moving' ? driving(c) : parked(originalCenter?.call(this, filledContext(c)) ?? c.defaultCenter?.() ?? '', c);
    };
    variant.cluster = function(c) {
      if (!enabled() || !c?.ready) return originalCluster?.call(this, c) ?? c?.defaultCluster?.() ?? '';
      return cluster(c);
    };
  }
  // Day UI takes precedence over NEXT_VARIANTS in the adapter. Preserve null as
  // its intentional hand-off to A; do not touch its phone renderer or state.
  const day = window.NextDayUI;
  if (typeof day?.render === 'function') {
    const originalDay = day.render;
    day.render = function(kind, c) {
      const html = originalDay.call(this, kind, enabled() && kind !== 'phone' ? filledContext(c) : c);
      if (!enabled() || !c?.ready || html == null || !['center', 'cluster'].includes(kind)) return html;
      if (kind === 'cluster') return cluster(c);
      return mode(c) === 'moving' ? driving(c) : parked(html, c);
    };
  }
  function setSheet(open, focus = true) {
    const panel = document.getElementById('av-vehicle-sheet');
    const trigger = document.querySelector('#center [data-av-status]');
    // Read current state again: a stale parked button cannot open while moving.
    if (open && window.NextApp?.getState?.()?.vehicle !== 'parked') return;
    if (!panel || !trigger) return;
    sheetOpen = open;
    panel.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    if (focus) (open ? panel.querySelector('[data-av-close]') : trigger)?.focus({ preventScroll: true });
  }
  document.addEventListener('click', e => {
    if (!enabled()) return;
    const button = e.target.closest('[data-av-status], [data-av-close]');
    if (!button || !button.closest('#center')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    setSheet(!button.hasAttribute('data-av-close') && !sheetOpen);
  }, true);
  document.addEventListener('keydown', e => {
    if (!enabled() || e.key !== 'Escape' || !sheetOpen || !e.target.closest('#center')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    setSheet(false);
  }, true);
})();
