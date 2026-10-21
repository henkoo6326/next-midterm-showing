/* 하루 이야기 장면 데이터 (SPEC 3장 C1~C10, C11 은 partial 의 어두운 판)
 *
 * ms: 연결 시연 타임라인(ui/development/live-demo.js, 122000ms) 구간. 스크롤 진행에 따라 [시작, 끝]을 연속 보간해
 *     세 기기 iframe 에 같은 값으로 seek 한다. 근거는 docs/research/02_current_ui.md 2.2 실측 타임라인
 *     (boarding 0, planning 6000, drive 14000, park 38000, delivery 43000, drive 55000, park 79000,
 *      delivery 83000, return 93000, closed 117000–122000)
 * phone: 연결 시연에 없는 상태(사진 저장, 보류, 재처리, 전송 실패)는 수동 모드 캡처(정지 이미지)를 폰 자리에 겹친다.
 *        [진행률 시작, 파일, 설명, 짝 캡처 키] 순서. 진행률이 시작값 이상이면 그 이미지를 보인다. 파일이 null 이면 시연 화면(iframe)
 *        짝 캡처 키(PEERS)가 있으면 센터(와 PEERS.cluster 가 있으면 클러스터)도 같은 수동 모드 상태의 정지 캡처로 바꾼다.
 *        폰은 수동 캡처인데 센터만 연결 시연 값('남은 배송 n건' 등)을 보이면 세 기기가 서로 다른 상태가 되기 때문이다
 * len: 장면 글 블록 높이(뷰포트 배수)
 * present: 발표 동선(?present=1) 핵심 장면 이름. 장면 글에 id="day-<id>" 와 data-present-scene 을 단다(main.js 가 읽음)
 */

export const TIMELINE_MS = 122000;

/* 01장 하루 흐름 9단계와 같은 이름 */
export const BAND = ['탑승', '배정 확인', '경로 선택', '주행', '정차·입구', '호수·요청', '남은 기록', '복귀', '업무 종료'];

const CAP = 'assets/captures/';

/* 수동 모드 폰 캡처(manual_NN)와 같은 상태의 센터·클러스터 정지 캡처(2x WebP)
 * 만든 방법: scripts/capture_ui.py manual() 과 같은 dispatch·클릭 순서를 한 문서에서 재현하고, 각 폰 캡처 시점에
 * body[data-gallery] 만 center/cluster 로 바꿔 찍었다. 폰 전용 대화상자(#modal)와 안내 토스트(#announcement)는
 * 문서 전체에 뜨므로 센터·클러스터 캡처에서는 숨겼다. 폰 캡처는 기존 manual_NN 과 픽셀 비교로 같은 상태임을 확인(토스트 시점 차이만 다름).
 * 같은 이미지가 되는 시점은 한 파일을 함께 쓴다 */
const PEER = 'ui/showing/story-peer-';
export const PEERS = {
/* cluster 가 null 이면 클러스터는 정지 캡처 대신 연결 시연 iframe 을 그 장면 ms 로 그대로 보인다.
 * 수동 모드 클러스터 캡처는 차량 수치가 출발 전 기본값(23°C, 214 km, 78%, 1,926 km)이라, 앞뒤 장면의 연결 시연 수치
 * (예: 104동 정차 22.2°C, 213 km, 77%, 1,927 km)에서 되돌아갔다가 다시 움직이는 것처럼 보인다.
 * 104동 정차(m03, m06)와 105동 정차(m09, m10, m12)는 연결 시연 클러스터도 같은 '정차 · P · 0 km/h' 화면이라 그쪽을 쓴다.
 * m14(출발지 복귀 후 정차, 종료 전)는 연결 시연에 같은 클러스터 상태가 없어 수동 캡처를 그대로 쓴다 */
  m03: { center: PEER + '03-center.webp', cluster: null },   // A-023 상세(사진 저장 전후) · 104동 · 남은 배송 4건
  m06: { center: PEER + '06-center.webp', cluster: null },   // A-024 배송 문제·보류 · 104동 · 남은 배송 3건
  m09: { center: PEER + '09-center.webp', cluster: null },   // 남은 업무 검토 · 105동 정차
  m10: { center: PEER + '10-center.webp', cluster: null },   // 보류 A-024 다시 열기
  m12: { center: PEER + '11-center.webp', cluster: null },   // 전송 상태(실패·수신 시연) · 배송을 마쳤습니다
  m14: { center: PEER + '14-center.webp', cluster: PEER + '14-cluster.webp' },   // 복귀 · 출발지 도착 · 작업 종료
};

export const SCENES = [
  {
    id: 'c1', no: 'C1', name: '출발', ms: [14000, 21000], len: 1.1,
    title: '고른 순서대로 주행을 시작합니다',
    // 3D 체험 결과에 따라 story.js renderRoute 가 제목을 바꾼다(남측 먼저를 골라도 시연 데이터는 북측 104동부터)
    routeTitle: {
      'north-first': '고른 순서대로 주행을 시작합니다',
      'south-first': '시연은 북측 104동부터 이어집니다',
      default: '기본 순서대로 주행을 시작합니다',
    },
    body: '클러스터는 다음 회전, 센터는 지도',
    chips: ['시연값'],
    note: '주행 시간은 6배 압축한 시연 타임라인입니다',
  },
  {
    id: 'c2', no: 'C2', name: '주행', ms: [21000, 37800], len: 1.8,
    title: '주행 중 폰은 잠기고, 큰 화면은 회전과 동만',
    body: '폰은 "주행 중 / 104동 방향"만 보여 주고 입력을 막습니다. 스크롤하면 지도와 속도가 함께 움직입니다',
    chips: ['시연값'],
    note: '속도·거리·경로는 OSM 지도 위의 시연값이며 실제 내비게이션이 아닙니다',
  },
  {
    id: 'c3', no: 'C3', name: '104동 정차', ms: [38000, 42800], len: 1, present: '104동 정차',
    title: '차가 서면 센터에 동·입구, 폰에 첫 배송 호수',
    body: '센터는 "104동 · 서쪽 공동현관", 클러스터는 P와 0 km/h. 잠겼던 폰은 첫 배송 1203호를 엽니다',
    chips: ['설계 판단'],
  },
  {
    id: 'c4', no: 'C4', name: '문 앞', ms: [43000, 44600], len: 1.1, present: '문 앞 호수·요청',
    title: '폰에는 1203호, 요청, 운송장',
    body: '문 앞에 선 기사는 호수와 요청을 손에 든 화면에서 확인합니다',
    chips: ['설계 판단'],
    tryTask: 'deliver',
    tryLabel: '직접 해 보기 · A-023 전달 기록',
  },
  {
    id: 'c5', no: 'C5', name: '사진 기록', ms: [44600, 44600], len: 1.3,
    title: '사진은 이 브라우저에만 저장됩니다',
    body: '촬영과 저장, 저장과 수신은 다릅니다. 사진을 저장해도 전달 결과는 따로 기록하고, 배송사 수신은 또 따로 표시합니다',
    chips: ['구현 범위'],
    tryTask: 'photo',
    phone: [
      [0, CAP + 'manual_03_photo-options-modal_phone.png', '사진 저장 방법', 'm03'],
      [0.36, CAP + 'manual_04_photo-preview_phone.png', '저장 전 미리보기 · 합성 이미지', 'm03'],
      [0.68, CAP + 'manual_05_photo-saved_phone.png', '사진 저장됨 · 전송 대기', 'm03'],
    ],
  },
  {
    id: 'c6', no: 'C6', name: '나중에 배송', ms: [46000, 50000], len: 1.2,
    title: '물품을 못 찾으면 나중에 배송, 사유는 선택',
    body: '보류는 실패나 반송이 아닙니다. 사유는 고르지 않아도 다음 배송으로 넘어갈 수 있고, 보류 건은 남은 기록에 다시 나타납니다',
    chips: ['설계 판단'],
    phone: [
      [0, CAP + 'manual_06_exception-modal_phone.png', '배송 문제', 'm06'],
      [0.36, CAP + 'manual_07_defer-reason_phone.png', '나중에 배송 · 사유 선택', 'm06'],
      [0.68, CAP + 'manual_08_deferred-next-B110_phone.png', '보류 후 다음 배송', 'm06'],
    ],
  },
  {
    id: 'c7', no: 'C7', name: '105동', ms: [55000, 83000], len: 2,
    title: '다음 구역으로',
    body: '남측 105동으로 이동해 정차하면 다시 동·입구와 호수가 나뉘어 보입니다',
    chips: ['시연값'],
    note: '주행 구간은 6배 압축한 시연 타임라인입니다',
  },
  {
    id: 'c8', no: 'C8', name: '남은 기록', ms: [90000, 92800], len: 1.6,
    title: '보류 1건 재처리, 전송 대기와 수신은 따로',
    body: '남은 업무에서 보류 건을 다시 열고, 전달 기록 저장과 배송사 수신(시연)을 나눠 표시합니다',
    chips: ['구현 범위'],
    reopen: 0.42,
    phone: [
      [0, null, ''],
      [0.18, CAP + 'manual_09_review-remaining_phone.png', '남은 업무 · 보류 1건', 'm09'],
      [0.42, CAP + 'manual_10_reopen-deferred-A024_phone.png', '보류 재처리', 'm10'],
      [0.64, CAP + 'manual_12_transfer-failed_phone.png', '전송 실패(시연)', 'm12'],
      [0.82, CAP + 'manual_13_transfer-received_phone.png', '배송사 수신(시연)', 'm12'],
    ],
  },
  {
    id: 'c9', no: 'C9', name: '복귀', ms: [93000, 116800], len: 1.6,
    title: '복귀',
    body: '남은 일이 없으면 출발 지점으로 돌아갑니다. 복귀 중에도 폰은 잠깁니다',
    chips: ['시연값'],
  },
  {
    id: 'c10', no: 'C10', name: '업무 종료', ms: [117000, 121900], len: 1.3, present: '업무 종료',
    title: '"이 구간 작업을 종료했습니다"',
    body: '남은 배송·보류·사진이 있으면 현재 UI는 종료 버튼을 내주지 않습니다',
    chips: ['구현 범위'],
    tryTask: 'finish',
    tryLabel: '직접 해 보기 · 업무 종료 누르기',
    phone: [
      [0, CAP + 'manual_14_finish-ready_phone.png', '업무 종료 확인', 'm14'],
      [0.42, null, ''],
    ],
  },
];

/* 타임라인 ms 에서 하루 흐름 단계(BAND 인덱스) */
export function bandAt(ms, sceneId) {
  if (sceneId === 'c8') return 6;
  if (sceneId === 'end') return 8;
  if (ms < 6000) return 0;
  if (ms < 14000) return 2;
  if (ms < 38000) return 3;
  if (ms < 43000) return 4;
  if (ms < 55000) return 5;
  if (ms < 79000) return 3;
  if (ms < 83000) return 4;
  if (ms < 89000) return 5;
  if (ms < 93000) return 6;
  if (ms < 117000) return 7;
  return 8;
}

/* 주행 중(속도가 있는) 구간인가 */
export function isMoving(ms) {
  return (ms >= 14000 && ms < 38000) || (ms >= 55000 && ms < 79000) || (ms >= 93000 && ms < 117000);
}

export function fmtClock(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
