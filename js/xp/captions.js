/* 자막 영역: 화자 + 문장 + 출처. js/audio.js 의 onCaption 을 받아 음성(voice 채널)만 그린다.
 * 효과음(시동·진동·알림·탭)은 자막을 띄우지 않는다. 손이 화면을 누르는 순간 "[화면 탭]" 같은 줄이 화면 아래에 남아
 * 장면을 가리던 문제를 없앴다(2026-10-20 xp-finish). 음성 내용은 계속 자막으로 읽을 수 있다.
 * custom(cap) 으로 오디오 목록 밖의 자막(파일 없이 자막만 보이는 문장)을 띄울 수 있다. */

import * as audio from '../audio.js';

export function createCaptions(box) {
  const speaker = box.querySelector('[data-cap-speaker]');
  const text = box.querySelector('[data-cap-text]');
  const source = box.querySelector('[data-cap-source]');

  function show(cap, kind) {
    speaker.textContent = cap.speaker || '';
    text.textContent = cap.text || '';
    source.textContent = cap.source ? `출처 · ${cap.source}` : '';
    box.dataset.kind = kind;
    box.hidden = false;
    box.classList.add('is-on');
  }
  function hide() {
    box.classList.remove('is-on');
    box.dataset.kind = '';
  }

  // 음성 채널 자막(audio.js 가 보냄)
  const off = audio.onCaption(cap => {
    if (cap && cap.channel === 'voice') show(cap, 'voice');
    else if (!cap) hide();
  });

  return {
    /* 효과음은 자막을 표시하지 않는다(음성만 자막). 호출부 호환을 위해 남겨 둔다 */
    sfx() {},
    custom(cap) { show(cap, 'voice'); },
    clear() { hide(); },
    dispose() { off(); },
  };
}
