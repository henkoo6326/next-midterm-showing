/* ② #roles '배송 흐름' 스크롤 장면 전환 (승인 시안 docs/proposals-v4/roles-2-sticky.html v2 의 스크립트 이식)
 * 현재 단계 = 윗변이 화면 높이 55% 위로 올라온 마지막 블록. 무대 장면(.rs-scene)·단계 표시(.rs-steps)·블록(.rs-block)을 같이 바꾼다.
 * 단계 표시를 누르면 그 블록으로 이동한다. 렌더 합성(.cmp)은 main.js 가 부르는 compose.js composeAll() 이 맡는다 */

const root = document.getElementById('roles');
if (root) {
  const blocks = [...root.querySelectorAll('.rs-block')];
  const scenes = [...root.querySelectorAll('.rs-scene')];
  const steps = [...root.querySelectorAll('.rs-steps button')];
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  let cur = -1;
  let ticking = false;

  const setStep = i => {
    if (i === cur) return;
    cur = i;
    scenes.forEach((s, k) => s.classList.toggle('is-on', k === i));
    blocks.forEach((b, k) => b.classList.toggle('is-on', k === i));
    steps.forEach((b, k) => (k === i ? b.setAttribute('aria-current', 'step') : b.removeAttribute('aria-current')));
  };

  const update = () => {
    ticking = false;
    const line = window.innerHeight * 0.55;
    let i = 0;
    blocks.forEach((b, k) => { if (b.getBoundingClientRect().top <= line) i = k; });
    setStep(i);
  };
  const request = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };

  window.addEventListener('scroll', request, { passive: true });
  window.addEventListener('resize', request);
  update();

  steps.forEach(b => b.addEventListener('click', () => {
    const t = blocks[+b.dataset.go];
    if (!t) return;
    const nav = document.querySelector('[data-topnav]');
    const navH = nav ? nav.getBoundingClientRect().height : 56;
    window.scrollTo({
      top: t.getBoundingClientRect().top + window.scrollY - navH - window.innerHeight * 0.1,
      behavior: reduce.matches ? 'auto' : 'smooth',
    });
  }));
}
