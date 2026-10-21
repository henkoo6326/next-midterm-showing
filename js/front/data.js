/* front 장(표지~07, D)의 화면 자료
 * 캡처는 site/assets/captures 의 2x PNG 를 같은 해상도 WebP 로 바꾼 사본(assets/front/cap, scripts/front/make_webp.py)
 * 좌표는 모두 기기 px(센터 1280×720, 클러스터 800×400, 폰 390×844). 캡처를 직접 재서 정했다 */

const CAP_BASE = new URL('../../assets/front/cap/', import.meta.url);
export const cap = name => new URL(name + '.webp', CAP_BASE).href;
export const asset = path => new URL('../../' + path, import.meta.url).href;

export const DEVICE_SIZE = {
  cluster: { w: 800, h: 400 },
  center: { w: 1280, h: 720 },
  phone: { w: 390, h: 844 },
};

export const DEVICE_NAME = { cluster: '클러스터', center: '센터페시아', phone: '모바일' };

/* 01 하루 흐름 9단계: 단계마다 대표 기기 하나 */
export const WHO_STEPS = [
  { name: '탑승', device: 'center', img: 'center_0', src: '센터 · 연결 시연 0초',
    desc: '타면 센터에 오늘 배정이 바로 열린다. 상동호수공원 4건, 북측·남측 두 구역' },
  { name: '배정 확인', device: 'phone', img: 'phone_0', src: '폰 · 연결 시연 0초',
    desc: '폰에서 구역별 호수와 요청을 미리 본다. 1203호 문 앞, 804호 방문 전 연락' },
  { name: '경로 선택', device: 'center', img: 'center_ai_route_choices', src: '센터 · 배송 도우미 패널',
    desc: '음성으로 남은 배송 순서를 물으면 두 방문 순서가 나온다. 규칙 기반 응답이며 최적 경로 계산이 아니다' },
  { name: '주행', device: 'cluster', img: 'cluster_30000', src: '클러스터 · 연결 시연 30초',
    desc: '달리는 동안 클러스터에는 속도·기어·다음 회전과 거리만 남는다' },
  { name: '정차·입구', device: 'center', img: 'center_40000', src: '센터 · 연결 시연 40초',
    desc: '차가 서면 센터에 104동과 서쪽 공동현관. 건물에 들어가는 단위가 먼저 보인다' },
  { name: '호수·요청', device: 'phone', img: 'phone_40000', src: '폰 · 연결 시연 40초',
    desc: '문 앞에서는 폰에 1203호, 전달 요청, 운송장. 사진 저장과 나중에 배송을 바로 고른다' },
  { name: '남은 기록', device: 'phone', img: 'manual_09_review-remaining_phone', src: '폰 · 수동 조작 캡처',
    desc: '못 한 배송 1건과 전송 대기를 따로 보여 준다. 보류 사유는 이력으로 남는다' },
  { name: '복귀', device: 'center', img: 'center_110000', src: '센터 · 연결 시연 110초',
    desc: '남은 업무를 확인한 뒤 출발 지점으로 돌아가는 안내. 복귀 없이 종료할 수도 있다' },
  { name: '업무 종료', device: 'phone', img: 'phone_121000', src: '폰 · 연결 시연 121초',
    desc: '전달 기록·남은 배송·전송 대기를 나눠 보여 주고 구간을 닫는다. 근태나 배송사 마감과는 연동하지 않는다' },
];

/* 02 설계 순서별 실제 UI 부분(폰 기기 px 기준 잘라 보기) */
export const PRIORITY = {
  1: { img: 'phone_40000', crop: { x: 0, y: 84, w: 390, h: 378 },
       cap: '폰 · 104동 배송 화면 위쪽 · 연결 시연 40초' },
  2: { img: 'manual_09_review-remaining_phone', crop: { x: 0, y: 128, w: 390, h: 432 },
       cap: '폰 · 남은 업무 검토 화면 · 수동 조작 캡처' },
  3: { img: 'manual_12_transfer-failed_phone', crop: { x: 0, y: 40, w: 390, h: 520 },
       cap: '폰 · 기록 탭 · 수동 조작 캡처. 전송 실패는 시연 응답이다' },
};

/* 03·06 같은 시점의 세 기기 */
export const MOMENTS = {
  drive: {
    ms: 30000,
    img: { cluster: 'cluster_30000', center: 'center_30000', phone: 'phone_30000' },
    text: {
      cluster: '28 km/h · D · 240 m 목적지까지 직진',
      center: '지도와 다음 안내. 현재 위치는 하단 중앙',
      phone: '잠금 · 주행 중, 104동 방향',
    },
    connect: {
      cluster: '다음 회전 · 104동까지 240 m',
      center: '지도 위 목적지 · 상동호수공원 북측 104동',
      phone: '잠금 · 104동 방향',
    },
    marks: {
      cluster: { x: 252, y: 122, w: 206, h: 172 },
      center: { x: 552, y: 274, w: 176, h: 32 },
      phone: { x: 40, y: 188, w: 310, h: 172 },
    },
  },
  park: {
    ms: 40000,
    img: { cluster: 'cluster_40000', center: 'center_40000', phone: 'phone_40000' },
    text: {
      cluster: '0 km/h · P · 104동 정차',
      center: '104동 · 서쪽 공동현관 · 남은 배송 4건',
      phone: '1203호 · 문 앞에 놓아주세요 · 운송장 …4023',
    },
    connect: {
      cluster: '104동 · 정차',
      center: '104동 · 서쪽 공동현관',
      phone: '1203호 · 요청 · 운송장 …4023',
    },
    marks: {
      cluster: { x: 286, y: 138, w: 130, h: 152 },
      center: { x: 24, y: 24, w: 311, h: 216 },
      phone: { x: 18, y: 84, w: 354, h: 376 },
    },
  },
};

/* 05 기기 화면: 같은 형식 반복 */
export const DEVICE_BLOCKS = [
  {
    device: 'cluster', num: '05-1', size: '800×400', mock: 'cluster-front',
    role: '차량 상태·속도·기어·다음 회전',
    desc: '주행 중에 보는 화면. 가운데에는 다음 회전 기호와 거리, 차가 서면 현재 동이 온다. 물품 목록·배송 완료 버튼·긴 요청 문장은 올리지 않는다',
    states: {
      plan: { ms: 12000, img: 'cluster_12000', text: '0 km/h · P · READY. 다음 동 104동, 출발 준비' },
      drive: { ms: 30000, img: 'cluster_30000', text: '28 km/h · D · 240 m 목적지까지 직진' },
      park: { ms: 40000, img: 'cluster_40000', text: '0 km/h · P · 104동 정차' },
      work: { ms: 50000, img: 'cluster_50000', text: '배송하는 동안에도 차량 상태와 현재 동만 남긴다' },
    },
  },
  {
    device: 'center', num: '05-2', size: '1280×720', mock: 'center-34',
    role: '지도·동·입구·방문 순서·차량 내 안내',
    desc: '정차하면 동과 입구처럼 건물에 들어가는 단위를 크게 보여 준다. 방문 순서는 출발 전에 음성으로 묻고 지도에 경로선으로 보인다. 사진·순서 편집·배송 기록은 주행 중에 열지 않는다',
    states: {
      plan: { ms: 12000, img: 'center_12000', text: '방문 순서 ① 북측 104동 → ② 남측 105동. 지도에 첫 구간 경로선' },
      drive: { ms: 30000, img: 'center_30000', text: '다음 안내 240 m 직진. 현재 위치는 지도 하단 중앙' },
      park: { ms: 40000, img: 'center_40000', text: '104동 · 서쪽 공동현관 · 남은 배송 4건' },
      work: { ms: 50000, img: 'center_50000', text: '104동 · 남은 배송 2건. 호수와 요청은 폰이 맡는다' },
    },
  },
  {
    device: 'phone', num: '05-3', size: '390×844', mock: 'phone-34',
    role: '호수·개별 요청·전달·사진 기록',
    desc: '문 앞에서 손에 드는 주 기기. 호수와 전달 요청, 운송장, 사진 저장, 나중에 배송을 한 화면에서 고른다. 주행 중에는 잠긴다',
    states: {
      plan: { ms: 12000, img: 'phone_12000', text: '출발 순서 확인 · 두 방문 순서 중 하나를 골라 이 경로로 시작' },
      drive: { ms: 30000, img: 'phone_30000', text: '잠금 · 주행 중, 104동 방향. 정차 후 배송을 기록하세요' },
      park: { ms: 40000, img: 'phone_40000', text: '1203호 · 문 앞에 놓아주세요 · 운송장 …4023' },
      work: { ms: 50000, img: 'phone_50000', text: '804호 · 방문 전 연락해주세요. 사진을 요구하지 않는 배정은 바로 전달 저장' },
    },
  },
];

export const STATE_TABS = [
  { id: 'plan', label: '출발 전' },
  { id: 'drive', label: '주행' },
  { id: 'park', label: '정차' },
  { id: 'work', label: '배송' },
];

/* 04 캔버스 와이어: 실제 화면에서 잰 영역(기기 px) */
export const WIRE = {
  cluster: {
    img: 'cluster_30000',
    regions: [
      { x: 20, y: 18, w: 120, h: 30, label: '외기온' },
      { x: 660, y: 18, w: 120, h: 30, label: '구역' },
      { x: 20, y: 110, w: 150, h: 170, label: '속도', big: true },
      { x: 250, y: 120, w: 210, h: 180, label: '다음 회전·거리', accent: true },
      { x: 495, y: 130, w: 140, h: 140, label: '주행 가능' },
      { x: 675, y: 128, w: 90, h: 160, label: '기어' },
      { x: 20, y: 342, w: 760, h: 36, label: '회생제동 · 누적거리' },
    ],
  },
  center: {
    img: 'center_30000',
    regions: [
      { x: 0, y: 0, w: 1280, h: 640, label: '지도 · OSM 벡터', ghost: true },
      { x: 24, y: 24, w: 290, h: 192, label: '안내 카드 · 동·입구', big: true },
      { x: 1084, y: 22, w: 174, h: 58, label: '상태' },
      { x: 1194, y: 420, w: 64, h: 196, label: '음성·경로·차량' },
      { x: 0, y: 640, w: 1280, h: 80, label: '공조·음량' },
    ],
    marker: { x: 640, y: 500, label: '현재 위치 · 하단 중앙' },
    route: [[640, 640], [640, 500], [640, 312]],
  },
  phone: {
    img: 'phone_40000',
    regions: [
      { x: 18, y: 40, w: 354, h: 34, label: '머리' },
      { x: 22, y: 132, w: 346, h: 48, label: '위치' },
      { x: 22, y: 192, w: 230, h: 74, label: '호수', big: true },
      { x: 22, y: 277, w: 346, h: 84, label: '전달 요청' },
      { x: 22, y: 372, w: 346, h: 84, label: '운송장' },
      { x: 22, y: 634, w: 346, h: 112, label: '주 행동', accent: true },
      { x: 14, y: 760, w: 362, h: 64, label: '탭' },
    ],
  },
};
