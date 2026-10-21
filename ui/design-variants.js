/* Visual alternatives share the same delivery state machine. */
(()=>{'use strict';const q=new URLSearchParams(location.search);const design=['atlas','night','paper'].includes(q.get('design'))?q.get('design'):'atlas';document.body.dataset.design=design;if(q.get('embed')==='1')document.body.dataset.embed='true';
const labels={atlas:'01 · 지도 중심',night:'02 · 야간 분할',paper:'03 · 타이포 중심'};
const nav=document.createElement('nav');nav.className='design-switch';nav.setAttribute('aria-label','디자인 비교');nav.innerHTML=Object.entries(labels).map(([key,name])=>{const u=new URL(location.href);u.searchParams.set('design',key);return `<a href="${u.pathname+u.search}" ${design===key?'aria-current="page"':''}>${name}</a>`}).join('')+'<a href="design-lab/index.html">레퍼런스와 비교 ↗</a>';
document.querySelector('.demo-console').before(nav);
})();
