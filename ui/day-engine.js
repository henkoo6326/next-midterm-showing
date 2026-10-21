/* NEXT full-day simulation. Load postload-engine.js first in a browser.
 * Persistence stays at next-postload-v4: serialize the entire returned state.
 * restore accepts strict base v4 snapshots or v4 + day; invalid data returns null.
 * Routes and depot are synthetic fixtures, not navigation or a live optimizer.
 * Metrics are fixed, unmeasured assumptions, not lengths computed from the map.
 * routes(state) lists only distinct remaining pending/nondeferred itineraries.
 * routeId is committed; candidateId is a preview. orderedIds uses routeId.
 * day.returnTarget is the fixed depot, NEVER the base delivery destination.
 * Only dayReturnPark explicitly confirms return; generic vehicle signals do not.
 * day.lastStop is the last explicit simulated arrival; day.mapOrigin is the
 * current leg's departure. Null on legacy records means location was not stored.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./postload-engine.js'));
  else root.NextDay = factory(root.NextPostload);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (base) {
  'use strict';
  if (!base) throw new Error('NextDay requires NextPostload');
  const ids = Object.keys(base.parcels);
  const stages = ['boarding', 'planning', 'delivery', 'review', 'returning', 'closed'];
  const planOrigins = ['boarding', 'delivery', 'review'];
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const copy = value => JSON.parse(JSON.stringify(value));
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const alternatives = [
    { id: 'time', title: '시간 우선', reason: '상동 북측부터 · 이동시간 우선 가정', stops: ['104', '105'], distanceKm: 2.5, driveMinutes: 10, serviceMinutes: 24, returnMinutes: 4 },
    { id: 'distance', title: '거리 우선', reason: '상동 남측부터 · 이동거리 우선 가정', stops: ['105', '104'], distanceKm: 2.1, driveMinutes: 12, serviceMinutes: 24, returnMinutes: 6 }
  ];
  const route = id => alternatives.find(r => r.id === id);
  const actionable = (s, id) => s.items[id].result === 'pending' && !s.items[id].deferred;
  function routes(s) {
    const remaining = new Set(ids.filter(id => actionable(s, id)).map(id => base.parcels[id].stop));
    const seen = new Set();
    return copy(alternatives).flatMap(r => {
      r.stops = r.stops.filter(stop => remaining.has(stop));
      const key = r.stops.join(',');
      if (!key || seen.has(key)) return [];
      seen.add(key);
      r.metricsLabel = '시뮬레이션 가정값 · 실측 아님 · 실시간 아님';
      if (r.stops.length === 1) {
        r.title = '남은 배송'; r.reason = base.stops.find(stop => stop.id === r.stops[0]).name + ' · 남은 배송';
      }
      return [r];
    });
  }
  function initialDay(phase) {
    return { routeId: 'time', candidateId: 'time', stage: ({ assignment: 'boarding', work: 'delivery', review: 'review', saved: 'review' })[phase],
      returnRequired: true, returned: false, returnTarget: 'depot', assignmentsReady: true,
      mapOrigin: phase === 'assignment' ? 'depot' : null, lastStop: phase === 'assignment' ? 'depot' : null };
  }
  function create() { const s = base.create(); return { ...s, day: initialDay(s.phase) }; }
  function orderedIds(s) {
    return route(s.day.routeId).stops.flatMap(stop => ids.filter(id => base.parcels[id].stop === stop));
  }
  function summary(s) {
    const counts = base.counts(s), items = ids.map(id => s.items[id]);
    const missingProof = ids.filter(id => s.items[id].result === 'delivered' && base.parcels[id].photoRequired && !s.items[id].proof).length;
    const handoff = items.filter(i => i.handoff === 'pending').length;
    const corrections = items.filter(i => i.correction?.status === 'pending').length;
    const reason = s.vehicle !== 'parked' ? '차량 정차 상태를 확인해주세요.'
      : s.day.stage === 'closed' ? '이미 하루를 종료했습니다.'
      : counts.pending ? '미처리 배송을 확인해주세요.'
      : missingProof ? '필수 사진을 완료해주세요.'
      : handoff ? '인계 대기 건을 완료해주세요.'
      : corrections ? '정정 요청 처리를 기다려주세요.'
      : s.day.returnRequired && !s.day.returned ? '거점 복귀를 확인해주세요.'
      : !['delivery', 'review', 'returning'].includes(s.day.stage) ? '경로 계획을 완료해주세요.' : '';
    return { pending: counts.pending, deferred: counts.deferred, delivered: counts.delivered, unreceived: counts.unreceived,
      missingProof, handoff, corrections, canFinishWithoutReturn: s.vehicle === 'parked' && s.day.stage === 'review' && !counts.pending && !missingProof && !handoff && !corrections, canFinish: reason === '', reason,
      canReturn: counts.pending === 0 && missingProof === 0 && s.vehicle === 'parked' && ['delivery', 'review'].includes(s.day.stage) };
  }
  function restore(raw) {
    try {
      if (typeof raw !== 'string') return null;
      const stored = JSON.parse(raw);
      if (!record(stored)) return null;
      const hasDay = own(stored, 'day'), day = stored.day;
      if (hasDay) delete stored.day;
      const s = base.restore(JSON.stringify(stored));
      if (!s) return null;
      if (!hasDay) return { ...s, day: initialDay(s.phase) };
      const keys = ['routeId', 'candidateId', 'stage', 'returnRequired', 'returned', 'returnTarget', 'assignmentsReady'];
      const optional = ['previousStage', 'mapOrigin', 'lastStop'];
      if (!record(day) || !keys.every(k => own(day, k)) || Object.keys(day).some(k => !keys.includes(k) && !optional.includes(k)) ||
        !route(day.routeId) || !route(day.candidateId) || !stages.includes(day.stage) ||
        typeof day.returnRequired !== 'boolean' || typeof day.returned !== 'boolean' || day.returnTarget !== 'depot' || typeof day.assignmentsReady !== 'boolean') return null;
      for (const key of ['mapOrigin', 'lastStop']) {
        if (own(day, key) && ![null, 'depot', '104', '105'].includes(day[key])) return null;
        if (!own(day, key)) day[key] = null;
      }
      if (day.stage === 'planning') {
        if (!planOrigins.includes(day.previousStage) || !day.assignmentsReady) return null;
      } else if (own(day, 'previousStage') || day.candidateId !== day.routeId) return null;
      const effective = day.stage === 'planning' ? day.previousStage : day.stage;
      const phases = { boarding: ['assignment'], delivery: ['work'], review: ['review', 'saved'], returning: ['review'], closed: ['saved'] };
      if (!phases[effective].includes(s.phase) || (!day.assignmentsReady && effective !== 'boarding')) return null;
      if (day.returned && !['delivery', 'returning', 'closed', 'review'].includes(effective)) return null;
      // Closed records must still satisfy completion obligations. Evaluate them
      // as review to exclude only the already-closed UI guard from summary.
      if (day.stage === 'closed' && !summary({ ...s, day: { ...day, stage: 'review' } }).canFinish) return null;
      return { ...s, day };
    } catch (_) { return null; }
  }
  // A day transition uses the base validator to validate its timestamp and freeze
  // audit entries. Parcel revisions and histories are retained without alteration.
  function commit(old, event, changes, day, text) {
    const { day: ignored, ...plain } = old;
    const entry = { at: own(event, 'at') ? event.at : new Date().toISOString(), type: event.type, text };
    const updated = { ...plain, ...changes, revision: old.revision + 1, history: [...old.history, entry] };
    const s = base.restore(JSON.stringify(updated));
    return s ? { ...s, day } : old;
  }
  function nextPending(s, selected) {
    const order = orderedIds(s), start = order.indexOf(selected);
    for (let offset = 1; offset <= order.length; offset++) {
      const id = order[(start + offset) % order.length], item = s.items[id];
      if (item.result === 'pending' && !item.deferred) return id;
    }
    return null;
  }
  function reduce(old, event) {
    if (!event || typeof event.type !== 'string' || (own(event, 'id') && !ids.includes(event.id))) return old;
    const d = old.day, parked = old.vehicle === 'parked';
    // Legacy adapter actions must respect full-day gates too.
    if (event.type === 'start') return reduce(old, { ...event, type: 'dayStart' });
    if (event.type === 'exit') return reduce(old, { ...event, type: 'dayFinish' });
    if (event.type.startsWith('day')) {
      if (!parked && event.type !== 'dayReturnPark') return old;
      const day = { ...d };
      switch (event.type) {
        case 'dayAssignments':
          if (d.stage !== 'boarding' || typeof event.available !== 'boolean' || d.assignmentsReady === event.available) return old;
          day.assignmentsReady = event.available;
          return commit(old, event, {}, day, event.available ? '시연 배정 확인' : '배정 자료 확인 대기');
        case 'dayReturnRequired':
          if (!['boarding', 'planning'].includes(d.stage) || typeof event.value !== 'boolean' || d.returnRequired === event.value) return old;
          day.returnRequired = event.value;
          return commit(old, event, {}, day, event.value ? '거점 복귀 필요' : '거점 복귀 선택 사항');
        case 'dayPlan':
        case 'dayReplan':
          if (!planOrigins.includes(d.stage) || !d.assignmentsReady) return old;
          day.previousStage = d.stage; day.stage = 'planning';
          day.candidateId = (routes(old).find(r => r.id === d.routeId) || routes(old)[0])?.id || d.routeId;
          return commit(old, event, {}, day, '시뮬레이션 경로 계획 열기');
        case 'dayChoose':
          if (d.stage !== 'planning' || !routes(old).some(r => r.id === event.routeId) || d.candidateId === event.routeId) return old;
          day.candidateId = event.routeId;
          return commit(old, event, {}, day, '시뮬레이션 경로 미리보기 · ' + event.routeId);
        case 'dayCancelPlan':
          if (d.stage !== 'planning') return old;
          day.stage = d.previousStage; day.candidateId = d.routeId; delete day.previousStage;
          return commit(old, event, {}, day, '경로 계획 취소 · 기존 경로 유지');
        case 'dayStart': {
          if (!['boarding', 'planning'].includes(d.stage) || !d.assignmentsReady) return old;
          const available = routes(old), candidate = available.find(r => r.id === d.candidateId) || available[0];
          delete day.previousStage;
          if (!candidate) {
            day.stage = 'review'; day.candidateId = d.routeId;
            return commit(old, event, { phase: 'review' }, day, '배송 가능 건 없음 · 남은 업무 검토');
          }
          if (summary(old).corrections) return old;
          day.routeId = candidate.id; day.candidateId = candidate.id; day.stage = 'delivery';
          day.mapOrigin = d.lastStop ?? null;
          const order = orderedIds({ ...old, day });
          const selected = order.find(id => actionable(old, id));
          return commit(old, event, { phase: 'work', destination: base.parcels[selected].stop, selected }, day, '경로 확정 · 배송 시작');
        }
        case 'dayReturn':
          if (!summary(old).canReturn) return old;
          day.stage = 'returning'; day.mapOrigin = d.lastStop ?? null;
          return commit(old, event, { phase: 'review', vehicle: 'parked' }, day, '거점 복귀 준비 · 배송 목적지 유지');
        case 'dayReturnDrive':
          if (d.stage !== 'returning' || summary(old).pending) return old;
          day.returned = false; day.mapOrigin = d.lastStop ?? null;
          return commit(old, event, { vehicle: 'moving' }, day, '거점 복귀 주행 · 시뮬레이션');
        case 'dayReturnPark':
          if (d.stage !== 'returning' || !['moving', 'parked'].includes(old.vehicle) || (d.returned && parked)) return old;
          day.returned = true; day.lastStop = 'depot';
          return commit(old, event, { vehicle: 'parked' }, day, '사용자가 거점 복귀 정차 확인 · 위치 자동 감지 아님');
        case 'dayFinishWithoutReturn':
          if (!summary(old).canFinishWithoutReturn) return old;
          day.returnRequired = false; day.stage = 'closed';
          return commit(old, event, { phase: 'saved' }, day, '복귀 없이 작업 종료 · 기기에 기록 저장');
        case 'dayFinish':
          if (!summary(old).canFinish) return old;
          day.stage = 'closed';
          return commit(old, event, { phase: 'saved' }, day, '하루 종료 · 기기에 기록 저장');
        default: return old;
      }
    }
    const background = ['network', 'sync', 'proofMissing', 'vehicle', 'park', 'preview', 'clearPreview'];
    if (!parked && !background.includes(event.type)) return old;
    if (d.stage === 'planning' && !background.includes(event.type)) return old;
    if (d.stage === 'returning' && ['drive', 'destination', 'next', 'defer', 'result', 'resultAndNext'].includes(event.type)) return old;
    if (d.stage === 'boarding' && ['resume', 'openReview'].includes(event.type)) return old;
    let action = event;
    // Delegate selection to the base to keep its audit semantics, but choose the
    // next parcel from the committed route rather than base assignment order.
    if (event.type === 'next' && parked && old.phase === 'work') {
      const target = nextPending(old, old.selected);
      action = target ? { ...event, type: 'select', id: target } : { ...event, type: 'openReview' };
    }
    const s = base.reduce(old, action);
    if (s === old) return old;
    const day = { ...d };
    if (s.destination !== old.destination || (old.vehicle !== 'moving' && s.vehicle === 'moving')) {
      day.mapOrigin = d.lastStop ?? null;
    }
    // Only an explicit simulated moving-to-parked delivery arrival advances the
    // location. Unknown recovery, parcel edits and return-trip parking do not.
    if (d.stage === 'delivery' && old.vehicle === 'moving' && s.vehicle === 'parked' &&
      (event.type === 'park' || (event.type === 'vehicle' && event.value === 'parked'))) {
      day.lastStop = old.destination;
    }
    if (['resultAndNext', 'defer'].includes(event.type)) {
      const target = nextPending(s, old.selected);
      if (target) s.selected = target;
      else { s.selected = old.selected; s.phase = 'review'; }
    }
    if (event.type === 'resume') {
      day.stage = 'delivery';
    } else if (!['boarding', 'planning', 'returning', 'closed'].includes(d.stage)) {
      day.stage = s.phase === 'work' ? 'delivery' : 'review';
    }
    // Inspecting/editing records and unknown telemetry do not establish a new
    // departure. Actual movement invalidates the prior explicit return.
    if (s.vehicle === 'moving' && d.returned) day.returned = false;
    // Lost proof and newly unsafe telemetry must not leave a misleading closed
    // state or a snapshot that restore would reject. Keep the base audit entry
    // and revision from this same atomic transition.
    if (d.stage === 'closed' && (event.type === 'proofMissing' || !summary({ ...s, day: { ...day, stage: 'review' } }).canFinish)) {
      day.stage = 'review'; s.phase = 'review';
    }
    return { ...s, day };
  }
  return { create, restore, reduce, routes, orderedIds, summary,
    parcels: base.parcels, stops: base.stops, review: base.review, counts: base.counts, current: base.current };
});
