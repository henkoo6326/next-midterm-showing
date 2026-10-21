/* ⑦ #mobile 모바일 정보 순위와 결과 기록 (v4)
 * 소유: mobile 담당. main.js 가 partials/mobile.html 을 넣은 뒤 init(root) 를 부른다
 * 배치·지시선·확대 조각은 모두 CSS(css/dev-mobile.css)가 정한다. 이 모듈은
 *   1) 스타일시트가 index.html 에 없을 때만 붙이고
 *   2) 글 등장 모션이 관찰 밖에서 남지 않게 보조한다
 * 누를 수 있는 요소를 만들지 않는다(모든 화면은 설명 이미지, 체험은 #try) */

import { revealText } from './common.js';

function ensureStyles() {
  const href = new URL('../../css/dev-mobile.css', import.meta.url).href;
  const has = [...document.querySelectorAll('link[rel="stylesheet"]')].some(l => l.href === href);
  if (has) return Promise.resolve();
  return new Promise(resolve => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.addEventListener('load', resolve, { once: true });
    link.addEventListener('error', resolve, { once: true });
    document.head.append(link);
  });
}

export async function init(root) {
  await ensureStyles();
  const box = root.querySelector('.mob');
  if (!box) throw new Error('mobile partial 이 없습니다');
  root.dataset.mobState = 'init';
  revealText(root);
  root.dataset.mobState = 'ready';
}
