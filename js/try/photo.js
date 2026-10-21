/* ④ 직접 기록(#try) 사진: js/story/photo.js 를 복사해 #try 에 맞춘 판. 현재 UI의 사진 흐름(camera-sheet, 파일 선택)을 그대로 쓰고, 쇼잉 쪽에서는
 *   - 카메라 촬영 셔터음(sfx-shutter)과 화면 플래시
 *   - 권한 거부·카메라 없음 안내(파일 선택으로 유도)
 *   - 파일 선택은 촬영처럼 연출하지 않음(셔터음·플래시 없음, "파일에서 선택" 표기)
 *   - 카메라 시트 닫기·섹션 이탈·탭 숨김·페이지 이탈 때 모든 MediaStreamTrack stop
 * 만 더한다. iframe 안의 도우미는 ui/showing/try-manual.js (window.__tryManual).
 */

import * as audio from '../audio.js';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const SITE = new URL('../../', import.meta.url);

/* 셔터음 파일을 미리 받아 둔다(첫 촬영 때 파일을 받느라 소리가 늦게 나지 않게). 재생은 audio.js 가 한다 */
let shutterWarm = null;
function warmShutter() {
  if (shutterWarm) return;
  audio.ready().then(() => {
    const item = audio.list()['sfx-shutter'];
    if (!item || !item.available || !item.file || shutterWarm) return;
    shutterWarm = new Audio(new URL(item.file, SITE).href);
    shutterWarm.preload = 'auto';
    shutterWarm.muted = true;
    try { shutterWarm.load(); } catch { /* noop */ }
  }).catch(() => {});
}

export function cameraErrorText(err) {
  const name = err && err.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return '카메라 권한이 거부됐습니다. 파일에서 고르기로 사진을 넣을 수 있습니다';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return '이 기기에서 카메라를 찾지 못했습니다. 파일에서 고르기로 사진을 넣을 수 있습니다';
  if (name === 'NotReadableError') return '다른 앱이 카메라를 쓰고 있어 열지 못했습니다. 파일에서 고르기를 이용하세요';
  if (name === 'TrackEnded') return '카메라 연결이 끊겼습니다. 파일에서 고르기로 사진을 넣을 수 있습니다';
  return '이 환경에서는 카메라를 열 수 없습니다. 파일에서 고르기를 이용하세요';
}

export class PhotoBridge {
  /* getHandle(): 수동 폰 handle, ui: { flash, onMessage(text, kind), onState() } */
  constructor(getHandle, ui) {
    this.getHandle = getHandle;
    this.ui = ui;
    this.method = null;      // 'camera' | 'file' | null
    this.lastError = null;
  }

  get manual() {
    try { return this.getHandle()?.win?.__tryManual || null; } catch { return null; }
  }

  attach() {
    const m = this.manual;
    if (!m) return false;
    warmShutter();
    m.hooks.onShutter = () => {
      audio.play('sfx-shutter', { channel: 'sfx' }).catch(() => {});
      this.flash();
      this.ui.onMessage('촬영했습니다. 폰에서 사진을 확인하고 "이 사진 저장"을 누르세요', 'info');
    };
    m.hooks.onCameraError = err => {
      this.lastError = err;
      this.method = null;
      this.ui.onMessage(cameraErrorText(err), 'warn');
      this.ui.onCameraError?.(err);
    };
    m.hooks.onCameraLive = () => {
      this.lastError = null;
      this.ui.onMessage('카메라가 켜졌습니다. 폰 화면의 촬영 버튼을 누르세요. 닫거나 이 장을 벗어나면 카메라를 끕니다', 'info');
      this.ui.onState?.();
    };
    m.hooks.onCameraStop = () => this.ui.onState?.();
    return true;
  }

  flash() {
    const el = this.ui.flash;
    if (!el || reduceMotion.matches) return;
    el.classList.remove('is-on');
    void el.offsetWidth;
    el.classList.add('is-on');
  }

  /* 현재 UI의 '배송 사진 촬영' 버튼을 눌러 카메라 시트를 연다 */
  async openCamera() {
    const h = this.getHandle();
    if (!h) return false;
    await audio.unlock().catch(() => {});
    this.method = 'camera';
    this.lastError = null;
    const ok = h.click('#phone [data-action="camera"]');
    if (!ok) {
      this.ui.onMessage('지금 폰 화면에는 사진 촬영 버튼이 없습니다. A-023 배송 상세로 맞춘 뒤 다시 누르세요', 'warn');
      this.method = null;
    }
    return ok;
  }

  /* 쇼잉 페이지 파일 창에서 고른 파일을 현재 UI의 파일 선택 흐름으로 넘긴다 */
  async useFile(file) {
    const m = this.manual;
    if (!m || !file) return false;
    this.stopCamera('file');
    this.method = 'file';
    const ok = await m.useFile(file);
    if (ok) this.ui.onMessage('파일에서 선택한 사진입니다. 폰에서 확인하고 "이 사진 저장"을 누르세요', 'info');
    return ok;
  }

  /* 모든 트랙 정지 + 카메라 시트 닫기. 멈춘 트랙 수를 돌려준다 */
  stopCamera(reason = 'stop') {
    const m = this.manual;
    if (!m) return 0;
    try { return m.closeCameraSheet(reason); } catch { return 0; }
  }

  state() {
    const m = this.manual;
    try { return m ? m.cameraState() : null; } catch { return null; }
  }
}
