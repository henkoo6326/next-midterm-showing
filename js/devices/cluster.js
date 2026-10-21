/* ⑤ #cluster 클러스터 섹션 (소유: cluster 담당)
 *
 * main.js 가 partials/cluster.html 을 넣은 뒤 init(root) 를 부른다.
 *   - 맥락 띠: 운전석 뒤에서 핸들 너머로 본 렌더(cluster-context, 폭 900 미만은 cluster-close) 구멍 아래
 *     현재 UI 캡처(연결 시연 20초 주행 cluster_20000, 오른쪽 가장자리 센터 center_20000)를 matrix3d 로 깐다(common.js mountRender).
 *     제목('다음 회전을 확인해도…')이 말하는 회전 화살표가 띠에서 바로 보이게 주행 D 화면을 쓴다(DESIGN_V2 2.5).
 *     center_20000 의 왼쪽 위는 어두운 '다음 안내' 카드라 띠 오른쪽 끝에 걸려도 카드 글자가 잘리지 않는다
 *   - 비교: 주행·정차 2x 캡처를 테 없는 평면 조각으로(common.js cropShot)
 * 모두 설명용 이미지다. 버튼·링크·호버를 두지 않는다. */

import { mountRender, cropShot, UI_SIZE, whenNear } from './common.js';

const NARROW = window.matchMedia('(max-width: 899px)');

const BAND = {
  wide: {
    cut: 'cluster-context',
    position: [0.5, 0.58],
    screens: { cluster: 'assets/captures/cluster_20000.png', center: 'assets/captures/center_20000.png' },
  },
  narrow: {
    cut: 'cluster-close',
    position: [0.5, 0.5],
    screens: { cluster: 'assets/captures/cluster_20000.png' },
  },
};

const BAND_ALT = '운전석 뒤 눈높이에서 핸들 너머로 본 주행 중 클러스터. 23 km/h, 가운데 파란 직진 화살표와 540 m 목적지까지 직진, 기어 D가 보인다. 오른쪽 가장자리에 센터페시아의 다음 안내 카드가 걸린다';

export async function init(root) {
  const host = root.querySelector('[data-cl]');
  if (!host) throw new Error('cluster partial 없음');

  // 비교 조각: 2x 캡처 전체(800×400)를 그대로. 폭은 CSS 가 정한다
  for (const slot of host.querySelectorAll('[data-cl-shot]')) {
    const shot = cropShot({ src: slot.dataset.clShot, ui: UI_SIZE.cluster, alt: slot.dataset.alt || '' });
    slot.append(shot);
  }

  // 맥락 띠: 섹션 가까이 오면 합성(렌더 webp 2400px 를 미리 받지 않게)
  const stage = host.querySelector('[data-cl-band]');
  let band = null;
  const mount = () => {
    if (band) band.destroy();
    const cfg = NARROW.matches ? BAND.narrow : BAND.wide;
    stage.dataset.cut = cfg.cut;
    band = mountRender(stage, { ...cfg, fit: 'cover', focus: true, alt: BAND_ALT });
    return band.ready.catch(() => { stage.classList.add('is-failed'); });
  };

  await new Promise(resolve => {
    whenNear(root, () => { mount().then(resolve); }, '120% 0px');
    // 발표 동선에서 멀리 있을 때도 init 이 오래 매달리지 않게
    setTimeout(resolve, 2500);
  });

  NARROW.addEventListener('change', () => { mount(); });
}
