/* NEXT post-loading demo engine. No APIs, persistence, media IO or physical detection.
 * All waybills, requests, addresses and entrance sources below are DEMO fixtures.
 * The UI adapter must label the demo outside the operational UI.
 * Capture/edit transactions are adapter-owned: this contract exposes no begin/end
 * events. Do not dispatch destination while an adapter transaction is unresolved.
 * sync/resolveCorrection/handoff are explicit external SIMULATIONS, not receipts.
 * sync applies to the current item revision. The adapter must discard stale replies
 * before dispatch: this fixed event contract carries no response revision/token.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NextPostload = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const stops = Object.freeze([
    Object.freeze({ id: '104', area: '상동호수공원 북측', shortName: '상동 북측', name: '상동호수공원 북측 · 104동', entrance: '서쪽 공동현관', source: '가상 배정 · 동 번호·출입 정보는 시연 설정 · 2026-10-18' }),
    Object.freeze({ id: '105', area: '상동호수공원 남측', shortName: '상동 남측', name: '상동호수공원 남측 · 105동', entrance: '등록된 입구 정보 없음', source: '가상 배정 · 동 번호는 시연 설정 · 등록 정보 없음' })
  ]);
  const asset = 'assets/parcel-styles/05-lowpoly.png';
  const requestAt = '2026-10-18T08:00:00+09:00';
  const parcels = Object.freeze({
    'A-023': Object.freeze({ id: 'A-023', stop: '104', unit: '1203', waybill: '9000-0000-4023', request: '문 앞에 놓아주세요', requestAt, photoRequired: true, asset }),
    'A-024': Object.freeze({ id: 'A-024', stop: '104', unit: '1203', waybill: '9000-0000-4024', request: '벨을 누르지 말아주세요', requestAt, photoRequired: false, asset }),
    'B-110': Object.freeze({ id: 'B-110', stop: '104', unit: '804', waybill: '9000-0000-4110', request: '방문 전 연락해주세요', requestAt, photoRequired: false, asset }),
    'C-051': Object.freeze({ id: 'C-051', stop: '105', unit: '706', waybill: '9000-0000-4051', request: '문 앞에 놓아주세요', requestAt, photoRequired: true, asset })
  });
  const ids = Object.keys(parcels);
  const phases = ['assignment', 'work', 'review', 'saved'];
  const vehicles = ['parked', 'moving', 'unknown'];
  const results = ['pending', 'delivered', 'undelivered'];
  const transmissions = ['unsubmitted', 'queued', 'sending', 'unknown', 'received', 'error'];
  const txLabels = { unsubmitted: '미제출', queued: '전송 대기', sending: '전송 중', unknown: '수신 확인 중', received: '배송사 수신', error: '전송 실패' };
  const own = (o, key) => Object.prototype.hasOwnProperty.call(o, key);
  const known = id => typeof id === 'string' && own(parcels, id);
  const nonblank = v => typeof v === 'string' && v.trim().length > 0;
  const integer = v => Number.isSafeInteger(v) && v >= 0;
  function iso(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v) || !Number.isFinite(Date.parse(v))) return false;
    const year = Number(v.slice(0, 4)), month = Number(v.slice(5, 7)), day = Number(v.slice(8, 10));
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] && Number(v.slice(11, 13)) < 24;
  }
  const copy = v => JSON.parse(JSON.stringify(v));
  const pendingCorrection = i => i.correction?.status === 'pending';
  const proofNeeded = (id, i) => i.result === 'delivered' && parcels[id].photoRequired && !i.proof;
  const current = s => parcels[s.selected];

  function create() {
    return {
      version: 4, phase: 'assignment', vehicle: 'parked', destination: '104', selected: 'A-023', preview: null, online: true,
      items: Object.fromEntries(ids.map(id => [id, {
        result: 'pending', deferred: false, reason: '', proof: null, transmission: 'unsubmitted', revision: 0,
        correction: null, handoff: 'none', history: []
      }])), history: [], notice: '', revision: 0
    };
  }
  function review(s) {
    return ids.flatMap(id => {
      const i = s.items[id], issues = [];
      if (i.result === 'pending') issues.push('미처리');
      if (i.deferred) issues.push('나중에 배송');
      if (proofNeeded(id, i)) issues.push('사진 미완료');
      if (i.result !== 'pending' && i.transmission !== 'received') issues.push(txLabels[i.transmission]);
      if (pendingCorrection(i)) issues.push('정정 요청 중');
      if (i.handoff === 'pending') issues.push('인계 대기');
      return issues.length ? [{ id, issues }] : [];
    });
  }
  function counts(s) {
    const items = ids.map(id => s.items[id]);
    return {
      delivered: items.filter(i => i.result === 'delivered').length,
      pending: items.filter(i => i.result === 'pending').length,
      deferred: items.filter(i => i.deferred).length,
      unreceived: items.filter(i => i.result !== 'pending' && i.transmission !== 'received').length,
      attention: review(s).length, total: ids.length
    };
  }
  function freezeHistory(s) {
    s.history.forEach(Object.freeze);
    ids.forEach(id => s.items[id].history.forEach(Object.freeze));
    return s;
  }
  function reduce(old, a) {
    if (!a || typeof a.type !== 'string' || (own(a, 'id') && !known(a.id)) || (own(a, 'at') && !iso(a.at))) return old;
    const s = copy(old), id = a.id === undefined ? s.selected : a.id, item = s.items[id];
    const parked = s.vehicle === 'parked';
    const editing = parked && ['work', 'review'].includes(s.phase);
    const working = parked && s.phase === 'work';
    const event = (text, target) => {
      const entry = Object.freeze({ at: a.at || new Date().toISOString(), type: a.type, ...(target ? { id: target } : {}), text });
      s.history.push(entry);
      if (target) s.items[target].history.push(entry);
    };
    const queue = i => { i.revision++; i.transmission = 'queued'; };
    const choose = target => {
      if (s.selected !== target || s.items[target].deferred) event('작업 대상 선택' + (s.items[target].deferred ? ' · 보류 건 재개' : ''), target);
      s.selected = target;
      s.items[target].deferred = false;
    };
    // Rotate through the stable assignment order, without ranking units/floors or
    // changing navigation. If only the current pending item remains, retain it.
    const nextPending = () => {
      const start = ids.indexOf(s.selected);
      for (let offset = 1; offset <= ids.length; offset++) {
        const target = ids[(start + offset) % ids.length], i = s.items[target];
        if (i.result === 'pending' && !i.deferred) return target;
      }
      return null;
    };
    switch (a.type) {
      case 'start':
        if (!parked || s.phase !== 'assignment') return old;
        s.phase = 'work'; event('배송 작업 시작'); break;
      case 'select':
        if (!parked || s.phase === 'saved') return old;
        choose(id); break;
      case 'preview':
        if (s.vehicle === 'moving') return old;
        s.preview = id; break;
      case 'clearPreview':
        if (s.vehicle === 'moving') return old;
        s.preview = null; break;
      case 'destination': {
        if (!stops.some(stop => stop.id === a.stop) || !['center', 'phone'].includes(a.source) || !parked || s.phase === 'saved' || (a.source === 'center' && !s.online) || ids.some(target => pendingCorrection(s.items[target]))) {
          s.notice = '목적지 변경 미반영'; break;
        }
        if (s.destination !== a.stop) event(a.stop + '동으로 목적지 변경');
        s.destination = a.stop; s.notice = ''; break;
      }
      case 'drive':
        if (!working) return old;
        s.vehicle = 'moving'; event('주행 상태로 변경'); break;
      case 'park':
        if (s.vehicle === 'parked') return old;
        s.vehicle = 'parked'; event('정차 상태로 변경'); break;
      case 'vehicle':
        if (!vehicles.includes(a.value) || s.vehicle === a.value) return old;
        s.vehicle = a.value; event('차량 상태: ' + ({ parked: '정차', moving: '주행', unknown: '확인 불가' })[a.value]); break;
      case 'defer': {
        if (!working || item.result !== 'pending' || pendingCorrection(item) || (a.reason !== undefined && typeof a.reason !== 'string')) return old;
        const reason = a.reason === undefined ? item.reason : a.reason.trim();
        if (item.deferred && item.reason === reason) return old;
        item.deferred = true; item.reason = reason;
        event('나중에 배송' + (reason ? ' · ' + reason : ''), id);
        const target = nextPending(); if (target) s.selected = target;
        break;
      }
      case 'resultAndNext':
      case 'result':
        // Combined save/advance is opt-in, bound to one rendered parcel, and
        // never hides a missing required photo. Legacy result-only stays valid.
        if (a.type === 'resultAndNext' && (!own(a, 'id') || a.value !== 'delivered' || (parcels[id].photoRequired && !item.proof))) return old;
        if (!working || id !== s.selected || item.result !== 'pending' || pendingCorrection(item) || !['delivered', 'undelivered'].includes(a.value) || (a.reason !== undefined && typeof a.reason !== 'string') || (a.value === 'undelivered' && !nonblank(a.reason))) return old;
        item.result = a.value; item.reason = (a.reason || '').trim(); item.deferred = false;
        item.handoff = a.value === 'undelivered' ? 'pending' : 'none'; queue(item);
        event((a.value === 'delivered' ? '전달 기록 저장' : '미전달 기록 저장 · ' + item.reason) + ' · 전송 대기', id);
        if (a.type === 'resultAndNext') {
          const target = nextPending();
          // One revision and one adapter write commit both result and selection.
          // This event's id remains the saved parcel for the correction shortcut.
          if (target) s.selected = target;
          else s.phase = 'review';
        }
        break;
      case 'next': {
        if (!working) return old;
        const target = nextPending();
        if (target) choose(target);
        else { s.phase = 'review'; event('마지막 검토 열기'); }
        break;
      }
      case 'proof':
        if (!editing || id !== s.selected || pendingCorrection(item) || !nonblank(a.key) || !['photo', 'demo'].includes(a.kind)) return old;
        if (item.proof?.key === a.key && item.proof.kind === a.kind) return old;
        if (['received', 'sending', 'unknown'].includes(item.transmission)) {
          item.correction = { status: 'pending', requestedResult: item.result, reason: '제출한 사진 교체', replacementProof: { key: a.key, kind: a.kind } };
          event('사진 교체 정정 요청 · 원본 유지 · 새 사진 ' + a.key, id);
          break;
        }
        item.proof = { key: a.key, kind: a.kind }; queue(item);
        event('사진 저장 · ' + a.key + (a.kind === 'demo' ? ' · 시연 증빙' : ''), id); break;
      case 'proofMissing':
        if (!item.proof) return old;
        // Adapter reports a lost file; never erase the physical result or the
        // original saved-key history. Also valid while saved, moving, or correcting.
        item.proof = null; queue(item); event('사진을 찾을 수 없습니다 · 사진 미완료', id); break;
      case 'openReview':
        if (!parked || s.phase === 'saved' || s.phase === 'review') return old;
        s.phase = 'review'; event('마지막 검토 열기'); break;
      case 'resume':
        if (!parked) return old;
        if (s.phase !== 'work') { s.phase = 'work'; event('저장한 작업 재개'); }
        if (a.id !== undefined) choose(id);
        break;
      case 'exit':
        if (!parked || s.phase === 'saved') return old;
        s.phase = 'saved'; event('기록 저장 후 종료'); break;
      case 'network':
        if (typeof a.online !== 'boolean' || s.online === a.online) return old;
        s.online = a.online; event(a.online ? '연결 복구' : '오프라인 · 기기에 기록 보관'); break;
      case 'sync': {
        if (!['success', 'failure', 'unknown', 'sending'].includes(a.outcome)) return old;
        for (const target of a.id === undefined ? ids : [id]) {
          const i = s.items[target];
          if (i.result === 'pending' || proofNeeded(target, i) || pendingCorrection(i) || i.transmission === 'received') continue;
          const transmission = !s.online ? 'queued' : ({ success: 'received', failure: 'error', unknown: 'unknown', sending: 'sending' })[a.outcome];
          if (i.transmission === transmission) continue;
          i.transmission = transmission; event(txLabels[transmission] + ' · 기록 버전 ' + i.revision, target);
        }
        break;
      }
      case 'correct':
        if (!editing || pendingCorrection(item) || !results.includes(a.result) || !nonblank(a.reason)) return old;
        item.correction = { status: 'pending', requestedResult: a.result, reason: a.reason.trim() };
        event('정정 요청 중 · ' + item.correction.reason, id); break;
      case 'resolveCorrection': {
        if (!s.online || !pendingCorrection(item) || typeof a.accept !== 'boolean') return old;
        if (a.accept) {
          // Keep the prior version readable in both item and global histories.
          // All snapshot values are copied into text, never held as mutable refs.
          const resultLabel = { pending: '미처리', delivered: '전달 기록', undelivered: '미전달 기록' }[item.result];
          const proofLabel = item.proof ? (item.proof.kind === 'photo' ? '사진 ' : '시연 증빙 ') + item.proof.key : '사진 없음';
          const handoffLabel = { none: '인계 대상 아님', pending: '인계 대기', done: '인계 접수' }[item.handoff];
          event('정정 전 기록 보존 · 버전 ' + item.revision + ' · ' + resultLabel + ' · 사유: ' + (item.reason || '없음') + ' · ' + proofLabel + ' · ' + txLabels[item.transmission] + ' · ' + handoffLabel, id);
          item.result = item.correction.requestedResult; item.reason = item.correction.reason;
          item.deferred = false; item.handoff = item.result === 'undelivered' ? 'pending' : 'none';
          if (item.result === 'pending') item.proof = null;
          if (item.correction.replacementProof) item.proof = copy(item.correction.replacementProof);
          item.correction.status = 'accepted'; queue(item); event('정정 반영 · 전송 대기', id);
        } else {
          item.correction.status = 'rejected'; event('정정 거절 · 기존 기록 유지 · ' + item.correction.reason, id);
        }
        break;
      }
      case 'handoff':
        if (!s.online || item.result !== 'undelivered' || item.handoff !== 'pending' || pendingCorrection(item)) return old;
        item.handoff = 'done'; event('인계 접수', id); break;
      default: return old;
    }
    if (JSON.stringify(s) === JSON.stringify(old)) return old;
    s.revision = old.revision + 1;
    return freezeHistory(s);
  }

  const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const shape = (v, keys) => record(v) && Object.keys(v).length === keys.length && keys.every(k => own(v, k));
  const validProof = p => p === null || (shape(p, ['key', 'kind']) && nonblank(p.key) && ['photo', 'demo'].includes(p.kind));
  const validCorrection = c => c === null || ((shape(c, ['status', 'requestedResult', 'reason']) || (shape(c, ['status', 'requestedResult', 'reason', 'replacementProof']) && c.replacementProof !== null && validProof(c.replacementProof))) && ['pending', 'accepted', 'rejected'].includes(c.status) && results.includes(c.requestedResult) && nonblank(c.reason));
  const validHistory = (history, target) => Array.isArray(history) && history.every(h =>
    shape(h, own(h || {}, 'id') ? ['at', 'type', 'id', 'text'] : ['at', 'type', 'text']) && iso(h.at) && nonblank(h.type) && nonblank(h.text) &&
    (!own(h, 'id') || known(h.id)) && (target === undefined || h.id === target));

  // Storage adapter passes the serialized version-4 snapshot. Invalid/legacy data
  // returns null so the caller can offer recovery instead of silently resetting.
  function restore(raw) {
    try {
      if (typeof raw !== 'string') return null;
      const s = JSON.parse(raw);
      if (!shape(s, ['version', 'phase', 'vehicle', 'destination', 'selected', 'preview', 'online', 'items', 'history', 'notice', 'revision']) ||
          s.version !== 4 || !phases.includes(s.phase) || !vehicles.includes(s.vehicle) || !stops.some(stop => stop.id === s.destination) ||
          !known(s.selected) || !(s.preview === null || known(s.preview)) || typeof s.online !== 'boolean' || typeof s.notice !== 'string' ||
          !integer(s.revision) || !shape(s.items, ids) || !validHistory(s.history)) return null;
      for (const id of ids) {
        const i = s.items[id];
        if (!shape(i, ['result', 'deferred', 'reason', 'proof', 'transmission', 'revision', 'correction', 'handoff', 'history']) ||
            !results.includes(i.result) || typeof i.deferred !== 'boolean' || typeof i.reason !== 'string' || !validProof(i.proof) ||
            !transmissions.includes(i.transmission) || !integer(i.revision) || i.revision > s.revision || !validCorrection(i.correction) ||
            !['none', 'pending', 'done'].includes(i.handoff) || !validHistory(i.history, id)) return null;
        if (i.deferred && i.result !== 'pending') return null;
        if (i.result === 'undelivered' ? (!nonblank(i.reason) || i.handoff === 'none') : i.handoff !== 'none') return null;
        if (i.result === 'pending' && !['unsubmitted', 'queued'].includes(i.transmission)) return null;
        if (proofNeeded(id, i) && ['sending', 'unknown', 'received', 'error'].includes(i.transmission)) return null;
        if ((i.result !== 'pending' || i.proof !== null) && i.revision === 0) return null;
        if (i.transmission !== 'unsubmitted' && i.revision === 0) return null;
        const globalHistory = s.history.filter(h => h.id === id);
        if (globalHistory.length !== i.history.length || i.history.some((h, index) => {
          const other = globalHistory[index];
          return h.at !== other.at || h.type !== other.type || h.text !== other.text;
        })) return null;
      }
      if (ids.reduce((total, id) => total + s.items[id].revision, 0) > s.revision) return null;
      return freezeHistory(s);
    } catch (_) { return null; }
  }
  return { create, reduce, restore, parcels, stops, review, counts, current };
});
