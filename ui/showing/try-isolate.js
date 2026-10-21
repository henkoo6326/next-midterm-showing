/* ④ #try 체험 폰 전용 격리 (ui/try-phone.html 의 <head> 맨 앞에서, defer 인 현재 UI 스크립트보다 먼저 실행)
 *
 * 현재 UI 는 기록을 localStorage(next-postload-v4)·IndexedDB(next-postload-photos-v1)에 두고
 * 같은 주소로 열린 다른 탭의 변경(storage 이벤트)을 따라간다. 체험 폰은 페이지를 열 때마다 처음 장면이어야 하므로
 * - localStorage 는 이 문서 안에서만 쓰는 메모리 저장소로 바꾼다(다른 탭·다른 iframe 과 나누지 않음, 진짜 저장소를 지우지 않음)
 * - storage 이벤트는 이 문서의 어떤 리스너에도 넘기지 않는다(window 리스너는 등록 순서로 불리므로 가장 먼저 등록한다)
 * - 'next-' 로 시작하는 IndexedDB 는 이 페이지 로드만의 이름으로 열고, 문서를 떠날 때와 6시간 지난 것을 지운다
 * 원본 UI 파일은 고치지 않는다. 사진은 서버로 보내지 않는다
 */
(function () {
  'use strict';
  var mem = new Map();
  var store = {
    get length() { return mem.size; },
    key: function (i) { var k = Array.from(mem.keys())[i]; return k === undefined ? null : k; },
    getItem: function (k) { k = String(k); return mem.has(k) ? mem.get(k) : null; },
    setItem: function (k, v) { mem.set(String(k), String(v)); },
    removeItem: function (k) { mem.delete(String(k)); },
    clear: function () { mem.clear(); },
  };
  try { Object.defineProperty(window, 'localStorage', { configurable: true, enumerable: true, get: function () { return store; } }); }
  catch (e) { console.warn('[try-isolate] localStorage 격리 실패', e); }

  window.addEventListener('storage', function (e) { e.stopImmediatePropagation(); }, true);

  var MARK = '::try-';
  var MAX_AGE = 6 * 60 * 60 * 1000;
  var stamp = Date.now();
  var suffix = MARK + stamp.toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  var idb = window.indexedDB;
  if (!idb) return;
  var open = IDBFactory.prototype.open;
  var del = IDBFactory.prototype.deleteDatabase;
  var mine = function (name) { name = String(name); return name.indexOf('next-') === 0 && name.indexOf(MARK) < 0 ? name + suffix : name; };
  var used = new Set();
  idb.open = function (name) {
    var real = mine(name);
    if (real !== String(name)) used.add(real);   // 이름을 바꾼 임시 DB 만 떠날 때 지운다
    var args = Array.prototype.slice.call(arguments);
    args[0] = real;
    return open.apply(idb, args);
  };
  idb.deleteDatabase = function (name) { return del.call(idb, mine(name)); };

  window.addEventListener('pagehide', function () {
    used.forEach(function (n) { try { del.call(idb, n); } catch (e) { /* noop */ } });
  });

  // 지난 체험이 남긴 사진 DB(창을 강제로 닫은 경우 등) 정리. 6시간 안의 것은 다른 탭이 쓰는 중일 수 있어 그대로 둔다
  try {
    if (idb.databases) idb.databases().then(function (list) {
      list.forEach(function (d) {
        var i = d.name ? d.name.indexOf(MARK) : -1;
        if (i < 0) return;
        var t = parseInt(d.name.slice(i + MARK.length).split('-')[0], 36);
        if (t && stamp - t > MAX_AGE) del.call(idb, d.name);
      });
    }).catch(function () {});
  } catch (e) { /* noop */ }
})();
