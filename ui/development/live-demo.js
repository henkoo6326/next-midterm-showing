/* Isolated playback fixture. Load anywhere; ?autoplay=1 mounts and starts it.
 * No NextApp dispatch/render, storage, camera, proof, network, or engine writes.
 * Integration: window.addEventListener('next-demo-tick', e => renderDemo(e.detail)).
 * getState() is a playback snapshot, NOT a NextDay/NextApp reducer state.
 * Speeds km/h; distances km; temp °C; power/regen kW; progress values 0..1.
 */
(() => {
  'use strict';
  if (window.NextLiveDemo) return;
  const definitions = [
    ['boarding', 6000, 0, '104', '탑승 준비'],
    ['planning', 8000, 0, '104', '경로 선택 시연'],
    ['drive', 24000, 1, '104', '첫 구역으로 주행'],
    ['park', 5000, 1, '104', '첫 구역 정차'],
    ['delivery', 12000, 1, '104', '폰 배송 시연'],
    ['drive', 24000, 2, '105', '다음 구역으로 주행'],
    ['park', 4000, 2, '105', '다음 구역 정차'],
    ['delivery', 10000, 2, '105', '폰 배송 시연'],
    ['return', 24000, 3, 'depot', '출발 지점으로 복귀'],
    ['closed', 5000, 3, 'depot', '구간 종료']
  ];
  let end = 0;
  const timeline = definitions.map(([phase, durationMs, leg, targetStop, label], index) => {
    const startMs = end; end += durationMs;
    return Object.freeze({ index, phase, durationMs, startMs, endMs: end, leg, targetStop, label });
  });
  const durationMs = end, tickMs = 300, timeScale = 6;
  const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
  const round = (x, precision = 1) => Number(x.toFixed(precision));
  let elapsedMs = 0, playing = false, timer = null, lastNow = 0, pauseReason = 'initial';
  let root = null, lastStatus = '';
  let bootTimer = null;
  function cancelBoot() { if (bootTimer !== null) clearTimeout(bootTimer); bootTimer = null; }
  const now = () => performance.now();
  const motion = segment => segment.phase === 'drive' || segment.phase === 'return';
  const peak = segment => segment.leg === 1 ? 32 : segment.leg === 2 ? 26 : 36;
  const fraction = (segment, at) => clamp((at - segment.startMs) / segment.durationMs);
  // Integral of the same speed curve used for display; seeking is deterministic.
  const distance = (segment, p) => peak(segment) * segment.durationMs / 3600000 * timeScale * (1 - Math.cos(Math.PI * p)) / Math.PI;
  function telemetryAt(at) {
    const segment = timeline.find(s => at < s.endMs) || timeline[timeline.length - 1];
    const phaseProgress = fraction(segment, at), isMotion = motion(segment);
    const legs = timeline.filter(motion);
    const drivenKm = legs.reduce((sum, s) => sum + distance(s, fraction(s, at)), 0);
    const speed = isMotion ? peak(segment) * Math.sin(Math.PI * phaseProgress) : 0;
    const regen = isMotion && phaseProgress > .55 ? Math.sin(Math.PI * (phaseProgress - .55) / .45) * 12 : 0;
    return {
      source: 'demo', connected: false, simulated: true, playing, pauseReason,
      elapsedMs: Math.round(at), durationMs, timeScale, simulatedElapsedMs: Math.round(at * timeScale),
      phase: segment.phase, stageIndex: segment.index, phaseLabel: segment.label,
      progress: round(at / durationMs, 5), phaseProgress: round(phaseProgress, 5),
      leg: segment.leg, legProgress: round(segment.leg ? fraction(legs[segment.leg - 1], at) : 0, 5),
      leg1Progress: round(fraction(legs[0], at), 5), leg2Progress: round(fraction(legs[1], at), 5),
      returnProgress: round(fraction(legs[2], at), 5),
      targetStop: segment.targetStop, mapOrigin: segment.leg === 2 ? '104' : segment.leg === 3 ? '105' : 'depot',
      vehicle: isMotion ? 'moving' : 'parked', gear: isMotion ? 'D' : 'P',
      speed: round(speed), soc: round(78 - drivenKm * 1.2), range: round(214 - drivenKm),
      rangeKm: round(214 - drivenKm), temp: round(22 + drivenKm * .3),
      regen: round(regen), power: round(regen > 0 ? -regen : speed * .7),
      odometer: round(1926 + drivenKm, 3), tripKm: round(drivenKm, 3), charging: 'disconnected'
    };
  }
  function getTelemetry() { return telemetryAt(elapsedMs); }
  function getState() {
    return { playing, pauseReason, elapsedMs, durationMs, telemetry: getTelemetry(), timeline: timeline.map(s => ({ ...s })) };
  }
  const time = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
  function refresh(t) {
    if (!root) return;
    const toggle = root.querySelector('[data-live-toggle]');
    toggle.textContent = playing ? '일시정지' : elapsedMs >= durationMs ? '다시 재생' : '재생';
    toggle.setAttribute('aria-pressed', String(playing));
    const slider = root.querySelector('[data-live-scrub]');
    slider.value = String(Math.round(elapsedMs));
    slider.setAttribute('aria-valuetext', `${time(elapsedMs)} / ${time(durationMs)}, ${t.phaseLabel}`);
    root.querySelector('[data-live-time]').textContent = `${time(elapsedMs)} / ${time(durationMs)}`;
    const status = `${t.phaseLabel} · ${playing ? '재생 중' : pauseReason === 'hidden' ? '탭이 숨겨져 일시정지' : '일시정지'}`;
    if (status !== lastStatus) { root.querySelector('[data-live-status]').textContent = status; lastStatus = status; }
  }
  function publish() {
    const t = getTelemetry();
    refresh(t);
    // Each publication is a fresh value; listeners cannot mutate internal state.
    window.dispatchEvent(new CustomEvent('next-demo-tick', { detail: t }));
  }
  function stopTimer() {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }
  function advance() {
    const current = now();
    elapsedMs = clamp(elapsedMs + Math.max(0, current - lastNow), 0, durationMs);
    lastNow = current;
    if (elapsedMs >= durationMs) { playing = false; pauseReason = 'ended'; stopTimer(); }
  }
  function pause(reason = 'user') {
    cancelBoot();
    if (playing) advance();
    playing = false;
    pauseReason = typeof reason === 'string' ? reason : 'user';
    stopTimer(); publish();
    return getState();
  }
  function tick() {
    if (!playing) return;
    if (document.hidden) { pause('hidden'); return; }
    advance(); publish();
  }
  function start() {
    cancelBoot();
    if (document.hidden) return pause('hidden');
    if (playing) return getState();
    stopTimer();
    if (elapsedMs >= durationMs) elapsedMs = 0;
    playing = true; pauseReason = null; lastNow = now();
    timer = setInterval(tick, tickMs);
    publish();
    return getState();
  }
  function reset() {
    cancelBoot();
    stopTimer(); playing = false; elapsedMs = 0; pauseReason = 'reset';
    publish(); return getState();
  }
  function seek(value) {
    const next = Number(value);
    if (!Number.isFinite(next)) return getState();
    cancelBoot();
    stopTimer(); playing = false; pauseReason = 'scrub'; elapsedMs = clamp(next, 0, durationMs);
    publish(); return getState();
  }
  function render(target) {
    const host = typeof target === 'string' ? document.querySelector(target) : target;
    if (target && !host) throw new Error('NextLiveDemo: playback host not found');
    if (host?.closest('.device, .screen-window')) throw new Error('Playback controls must be outside operational devices');
    if (!root) {
      root = document.createElement('section');
      root.className = 'next-live-demo';
      root.setAttribute('aria-label', '자동 재생 시연 제어');
      root.innerHTML = `<div class="nld-heading"><strong>자동 재생 시연</strong><span data-live-status role="status"></span></div><div class="nld-controls"><button type="button" data-live-toggle aria-pressed="false">재생</button><button type="button" data-live-replay>처음부터 재생</button><label class="nld-scrub"><span>시연 위치</span><input data-live-scrub type="range" min="0" max="${durationMs}" step="1" value="0"></label><output data-live-time></output></div><p>가상 주행·경로 선택·폰 배송 재생입니다. 실제 AI 계산·차량 연결·사진 촬영·배송 완료 기록은 실행하지 않습니다. 저장된 배송 기록과 분리되며 주행 시간은 6배로 압축했습니다.</p>`;
      root.addEventListener('click', event => {
        if (event.target.closest('[data-live-toggle]')) playing ? pause() : start();
        if (event.target.closest('[data-live-replay]')) { reset(); start(); }
      });
      root.querySelector('[data-live-scrub]').addEventListener('input', event => seek(event.target.value));
    }
    if (host) host.append(root);
    else if (!root.isConnected) {
      const anchor = document.querySelector('.demo-console') || document.querySelector('.prototype-note');
      if (anchor) anchor.after(root);
      else (document.querySelector('main') || document.body).prepend(root);
    }
    refresh(getTelemetry());
    return root;
  }
  window.NextLiveDemo = Object.freeze({ getState, getTelemetry, start, pause, reset, seek, render });
  document.addEventListener('visibilitychange', () => { if (document.hidden && playing) pause('hidden'); });
  window.addEventListener('pagehide', () => { cancelBoot(); if (playing) pause('pagehide'); else stopTimer(); });
  function boot() {
    if (new URLSearchParams(location.search).get('autoplay') !== '1') return;
    render();
    // Let later defer scripts / DOMContentLoaded bridge handlers subscribe first.
    // API readiness only: persisted records and adapter internals stay untouched.
    let attempts = 0;
    function ready() {
      bootTimer = null;
      if (document.hidden) { pause('hidden'); return; }
      if (typeof window.NextApp?.getState === 'function' && typeof window.NextApp?.render === 'function') {
        if(new URLSearchParams(location.search).get('controller')==='journey')pause();else start(); // Initial tick is boarding / progress 0 / leg 0.
      } else if (++attempts < 100) {
        bootTimer = setTimeout(ready, 50);
      } else { pause('app-unavailable'); }
    }
    bootTimer = setTimeout(ready, 0);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
