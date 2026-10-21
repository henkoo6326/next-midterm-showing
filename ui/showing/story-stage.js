/* 하루 이야기 sticky 무대 전용 주입 스크립트 (클러스터·폰 autoplay iframe 에만 넣는다)
 *
 * ?gallery=cluster|phone 로 연 delivery-app.html 은 보이지 않는 센터 화면(#center)까지 매 seek 마다 다시 그린다.
 * 그때 상동 지도 SVG(OSM way 5,905개)를 문자열로 만들고 파싱하는 데 seek 시간의 대부분(약 40ms)이 든다.
 * 이 두 iframe 에서 지도는 화면에 나오지 않으므로(클러스터·폰 화면은 지도를 쓰지 않음) 지도 생성만 빈 SVG 로 바꾼다.
 * 확인(2026-10-20): 0~121000ms 15개 시점에서 클러스터·폰 화면 스크린샷이 바꾸기 전과 픽셀 단위로 같았고,
 * seek 시간은 약 50~110ms → 10~25ms 로 줄었다. 보이는 화면의 배치·스타일·상태는 바꾸지 않는다.
 */
(() => {
  'use strict';
  if (window.__storyStage) return;
  const map = window.NextSangdongMap;
  if (!map || typeof map.render !== 'function') return;
  const original = map.render;
  map.render = function storySkippedMap() {
    return '<svg class="nx-sangdong-map" aria-hidden="true" data-story-skipped="1"></svg>';
  };
  window.__storyStage = { restore() { map.render = original; } };
})();
