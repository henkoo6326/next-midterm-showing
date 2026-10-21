/* 3D 체험의 모든 시간 값(ms). 다른 파일에 시간 숫자를 두지 않는다.
 * 실제 측정값과 단계별 합은 docs/XP_TIMING.md 에 기록한다. 키 이름이 곧 조정 위치다.
 * 음성 길이는 오디오 파일(없으면 assets/audio/manifest.json 의 durationMs)이 정한다. */

export const T = Object.freeze({
  /* S1 시동 */
  blurOut: 800,            // 시작 화면 흐림 해제
  powerOnDelay: 250,       // 클릭 뒤 화면이 켜지기까지
  powerOnFade: 600,        // 화면 켜짐 페이드(검정 → UI)
  powerStagger: 150,       // 클러스터 다음 센터가 켜지는 간격
  s1Hold: 500,             // 화면이 켜진 뒤 잠깐 머묾 (S1 끝)

  /* S2 알림 */
  s2Delay: 800,            // S1 끝 + 0.8s
  phoneRise: 900,          // 폰을 쥔 손이 올라옴
  lockToNotify: 400,       // 잠금화면 → 알림 카드 등장까지
  notifySlide: 450,        // 알림 카드 슬라이드 인 (xp-states.css 와 맞춤)

  /* S2' 알림 탭 */
  thumbTap: 350,           // 엄지가 알림 위치로 (thumb_tap)
  pressHold: 140,          // 눌림 반응 유지
  thumbRelease: 220,       // 엄지 떼기
  centerSwap: 400,         // 센터 화면이 NEXT 로 바뀌는 크로스페이드
  phoneLowerDelay: 250,    // 탭 뒤 폰을 내리기 시작하기까지
  phoneLower: 900,         // 폰을 내려 프레임 밖으로

  /* S3 센터 집중 */
  cameraFocus: 1400,       // 기본 시점 → 센터 집중 시점

  /* S3' 음성으로 요청하기 */
  indexReach: 800,         // 검지가 버튼까지 (접근 + 누름 포함)
  indexPressShare: 0.22,   // indexReach 중 마지막 누름 구간 비율
  indexRelease: 260,       // 접촉 뒤 손가락을 떼는 시간
  handRetract: 650,        // 손을 프레임 아래로 물림
  micConnect: 300,         // "마이크 연결 중" → "듣고 있습니다"
  typingLead: 120,         // 음성 시작 뒤 첫 글자까지

  /* S4 AI 대기 */
  recognizedDelay: 200,    // 음성 끝 + 0.2s 에 "인식 완료"
  recognizedHold: 350,     // "인식 완료" 를 읽을 시간
  aiWait: 1200,            // 점 3개 대기

  /* S4'' 경로 탭 */
  routeReach: 800,         // 검지가 경로 카드까지
  routeSelectToMap: 900,   // 선택 반응 뒤 센터 지도(경로 표시)로
  routeMapSeek: 13000,     // 지도 상태: autoplay seek 값(12000~13900 사이)
  routeNoteHold: 4500,     // 두 번째 경로를 누르면: '시연 데이터는 추천 순서로 이어집니다' 안내 칩을 보여 주는 시간(대기는 계속)

  /* S5 첫 배송지 도착(경로 선택 뒤 이어지는 구간, 자동). 합계 = 아래 시간 키의 합(13.1s) */
  arriveSettle: 600,       // V3 가 끝난 뒤 경로 화면을 잠깐 그대로 둠(기존 연출 마무리)
  cameraReturn: 1400,      // 센터 집중 → 기본 운전석 시점(cameraFocus 와 같은 경로를 거꾸로)
  gearHold: 600,           // 출발 준비: 센터 주행 화면·클러스터 D(0 km/h)를 보여 준 뒤 움직이기 시작
  driveMs: 8000,           // 주행(현재 UI autoplay drive 구간 driveSeekFrom → driveSeekTo 를 이 시간으로 압축)
  hazeMs: 2200,            // 주행 앞부분: 출발지 창밖 → 주행 환경 전환(노출·안개). driveMs 안에 포함
  driveSeekCluster: 200,   // 주행 중 클러스터 seek 간격(속도·다음 안내 갱신)
  driveSeekCenter: 600,    // 주행 중 센터 seek 간격(지도 다시 그리기가 무거워 성기게)
  parkSettle: 1200,        // 정차(P·0 km/h, 센터 동·입구) 뒤 기본 시점 그대로 머묾(창밖 104동 표지를 볼 시간)
  arriveFocusMs: 1300,     // 정차 뒤 센터 쪽으로 반쯤 다가가는 카메라(cameraFocus 와 같은 경로의 일부)
  driveSeekFrom: 14000,    // (시간 아님) 현재 UI autoplay 주행 시작 위치(gear D, 0 km/h)
  driveSeekTo: 37950,      // (시간 아님) 주행 끝 직전 위치
  arriveSeek: 40000,       // (시간 아님) 첫 정차 화면 위치(38000~43000: 104동 · 서쪽 공동현관 · P)
  arriveFocus: 0.7,        // (시간 아님) 도착 장면 카메라 비율(0 기본 시점, 1 센터 집중). 0.7 이면 클러스터 전체(0 km/h · 104동 정차 · P)가 핸들 림 안에 보이고
                           // 센터 화면 폭은 약 33%. 0.75 부터 클러스터 왼쪽이 잘리고, 센터 40%(0.84 이상)에서는 '104동 정차'가 화면 밖(통합 검수 D5, XP_TIMING 5장)

  /* 끝 */
  handLowerEnd: 900,       // 손이 내려감. 현재 코드에서 쓰지 않음

  /* 공통 */
  pulseLoop: 1600,         // 클릭 지점 펄스 주기 (xp-states.css 와 맞춤)
  hintDelay: 250,          // 입력 대기 안내가 뜨기까지
  skipFade: 400,           // 건너뛰기 시 화면 정리

  /* 성능: 섹션 밖 */
  releaseOnNext: 1200,     // 다음 장(#try 모바일 체험) 무대가 위아래 한 화면 안으로 오고 3D 무대가 화면에 없으면 이만큼 뒤 해제(경계에서 만들고 지우기 반복 방지)
  releaseAfter: 9000,     // 3D 섹션이 화면 근처(위아래 한 화면)를 벗어난 뒤 기기 화면 iframe 4개를 해제하기까지. 다시 가까워지면 새로 만든다.
                           // 아래 장의 기기 iframe 과 겹쳐 오래 남지 않게(통합 검수 RT-04)
});

/* 음성 길이는 여기 두지 않는다: 원본 음성·안내 음성 파일이 있으면 그 파일의 실제 길이(loadedmetadata),
 * 없으면 assets/audio/manifest.json 의 durationMs 를 쓴다(experience.js voiceMs). docs/XP_TIMING.md 3장 */

/* 이징: 쇼잉 공통 cubic-bezier(0.77,0,0.175,1) 과 손 동작용 */
function bezier(p1x, p1y, p2x, p2y) {
  const cx = 3 * p1x, bx = 3 * (p2x - p1x) - cx, ax = 1 - cx - bx;
  const cy = 3 * p1y, by = 3 * (p2y - p1y) - cy, ay = 1 - cy - by;
  const sx = t => ((ax * t + bx) * t + cx) * t;
  const sy = t => ((ay * t + by) * t + cy) * t;
  const dx = t => (3 * ax * t + 2 * bx) * t + cx;
  return x => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      const d = dx(t);
      if (Math.abs(e) < 1e-5 || Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    return sy(Math.min(1, Math.max(0, t)));
  };
}

export const ease = Object.freeze({
  show: bezier(0.77, 0, 0.175, 1),       // 사이트 공통
  reach: bezier(0.33, 0, 0.15, 1),       // 손 뻗기: 빨리 출발해 부드럽게 멈춤
  press: bezier(0.4, 0, 0.6, 1),
  lower: bezier(0.55, 0, 0.85, 0.35),    // 손 내리기: 천천히 출발해 빠르게 빠짐
  camera: bezier(0.65, 0, 0.35, 1),
  linear: t => t,
});
