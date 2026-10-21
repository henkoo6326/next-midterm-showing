/* 3D 화면에 붙는 NEXT UI iframe (ui-bridge.js 로 만든다)
 *
 * 센터(1280×720, 슬롯 16:9 그대로): 연결 전 화면(entry 모드)과 NEXT 화면(autoplay 모드) 두 장을 겹쳐 두고 크로스페이드
 * 클러스터(800×400): 16:9 슬롯(1600×900 가상 px)에 폭 맞춤 contain(위아래 검정 50px, 늘리지 않음)
 * 폰(390×844): 폰 화면 비율(66.7×142.2mm)에 contain
 * 각 화면 위에 검정 덮개(시동 전 꺼진 화면)를 두고 켜질 때 0.6s 페이드한다.
 * 쇼잉용 추가 상태(ui/showing/xp-states.*)는 iframe 안에 주입한다. 원 UI 파일은 고치지 않는다. */

import { createDevice } from '../ui-bridge.js';

const STATES = ['showing/xp-states.css', 'showing/xp-states.js'];
export const CLUSTER_SLOT = { w: 1600, h: 900 };
const PX_PER_M = 10000; // 폰 화면 가상 px (1mm = 10px)

function screenBox(className, w, h) {
  const box = document.createElement('div');
  box.className = `xp-screen ${className}`;
  box.style.width = w + 'px';
  box.style.height = h + 'px';
  const power = document.createElement('div');
  power.className = 'xp-power';
  box.append(power);
  return { box, power };
}

async function makeDevice(opts) {
  const handle = await createDevice(opts);
  // 3D 화면 iframe 은 보이기만 하는 화면이다(조작은 캔버스 레이캐스트 → 상태 주입). 화면 레이어도 aria-hidden 이라
  // Tab 순서에서 뺀다. 빼지 않으면 '체험하기'까지 iframe 안 버튼 18곳을 지난다(통합 검수 RT-02)
  if (handle.iframe) handle.iframe.tabIndex = -1;
  await handle.ready;
  await handle.inject({ href: STATES });
  return handle;
}

export async function createDevices(S, hands, { onProgress = () => {} } = {}) {
  const center = screenBox('xp-screen--center', 1280, 720);
  const cluster = screenBox('xp-screen--cluster', CLUSTER_SLOT.w, CLUSTER_SLOT.h);
  const phoneW = Math.round(hands.phone.scrW * PX_PER_M);
  const phoneH = Math.round(hands.phone.scrH * PX_PER_M);
  const phone = screenBox('xp-screen--phone', phoneW, phoneH);

  const centerEntryWrap = document.createElement('div');
  centerEntryWrap.className = 'xp-layer xp-layer--entry';
  const centerAutoWrap = document.createElement('div');
  centerAutoWrap.className = 'xp-layer xp-layer--auto';
  center.box.prepend(centerEntryWrap, centerAutoWrap);
  const clusterWrap = document.createElement('div');
  clusterWrap.className = 'xp-layer';
  cluster.box.prepend(clusterWrap);
  const phoneWrap = document.createElement('div');
  phoneWrap.className = 'xp-layer';
  phone.box.prepend(phoneWrap);

  S.attachStatic('center', center.box, 1280, 720);
  S.attachStatic('cluster', cluster.box, CLUSTER_SLOT.w, CLUSTER_SLOT.h);
  const phoneItem = S.attachDynamic('phone', hands.phoneScreen, phone.box, phoneW, phoneH);
  // 폰 화면 메시도 펀치스루
  hands.phoneScreen.material = S.scene.getObjectByName('SCREEN_CENTER').material;
  // 화면 요소를 문서에 붙인 상태로 한 번 배치한다(CSS3DRenderer 는 첫 render 때 붙인다). iframe 이 섹션 밖에서도 미리 로드되게
  S.renderScreens();

  let done = 0;
  const total = 4;
  const tick = () => { done++; onProgress(done / total); };
  const track = p => p.then(h => { tick(); return h; });

  const handles = {};
  const mk = {
    centerEntry: () => track(makeDevice({ device: 'center', mode: 'entry', container: centerEntryWrap, fit: true, maxScale: 1, title: 'NEXT 센터 화면(연결 전)' })),
    centerAuto: () => track(makeDevice({ device: 'center', mode: 'autoplay', container: centerAutoWrap, fit: true, maxScale: 1, title: 'NEXT 센터 화면' })),
    cluster: () => track(makeDevice({ device: 'cluster', mode: 'autoplay', container: clusterWrap, fit: true, maxScale: 2, title: 'NEXT 클러스터 화면' })),
    phone: () => track(makeDevice({ device: 'phone', mode: 'entry', container: phoneWrap, fit: true, maxScale: 4, title: 'NEXT 휴대폰 화면' })),
  };
  /* 한꺼번에 만들면 네 문서의 파싱·스크립트가 한 작업에 몰려 0.6~0.9s 멈춘다(통합 검수 RT-03).
     유휴 시간을 기다려 하나씩 만든다 */
  const idle = () => new Promise(r => (window.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 400 }) : setTimeout(r, 40)));
  async function makeInOrder(names) {
    const made = [];
    for (const n of names) {
      await idle();
      made.push(await mk[n]());
    }
    return made;
  }
  const ORDER = ['centerEntry', 'cluster', 'phone', 'centerAuto'];
  (await makeInOrder(ORDER)).forEach((h, i) => { handles[ORDER[i]] = h; });

  const api = {
    handles,
    boxes: { center, cluster, phone },
    phoneItem,
    phonePx: { w: phoneW, h: phoneH },
    /* 화면 켜짐/꺼짐 (검정 덮개) */
    setPower(name, on, ms = 0) {
      const p = { center, cluster, phone }[name].power;
      p.style.transitionDuration = ms + 'ms';
      p.style.opacity = on ? '0' : '1';
    },
    /* 센터: 연결 전(entry) ↔ NEXT(autoplay) */
    showCenter(which, ms = 0) {
      centerAutoWrap.style.transitionDuration = ms + 'ms';
      centerAutoWrap.style.opacity = which === 'auto' ? '1' : '0';
    },
    /* 기기 px → 화면 UV (0..1, 운전자가 보는 왼쪽 위 기준) */
    pxToUV(device, x, y) {
      if (device === 'center') return { u: x / 1280, v: y / 720 };
      if (device === 'cluster') {
        const h = handles.cluster;
        const s = h.scale, ox = (CLUSTER_SLOT.w - 800 * s) / 2, oy = (CLUSTER_SLOT.h - 400 * s) / 2;
        return { u: (ox + x * s) / CLUSTER_SLOT.w, v: (oy + y * s) / CLUSTER_SLOT.h };
      }
      const s = handles.phone.scale, ox = (phoneW - 390 * s) / 2, oy = (phoneH - 844 * s) / 2;
      return { u: (ox + x * s) / phoneW, v: (oy + y * s) / phoneH };
    },
    uvToPx(device, u, v) {
      if (device === 'center') return { x: u * 1280, y: v * 720 };
      if (device === 'cluster') {
        const s = handles.cluster.scale, ox = (CLUSTER_SLOT.w - 800 * s) / 2, oy = (CLUSTER_SLOT.h - 400 * s) / 2;
        return { x: (u * CLUSTER_SLOT.w - ox) / s, y: (v * CLUSTER_SLOT.h - oy) / s };
      }
      const s = handles.phone.scale, ox = (phoneW - 390 * s) / 2, oy = (phoneH - 844 * s) / 2;
      return { x: (u * phoneW - ox) / s, y: (v * phoneH - oy) / s };
    },
    /* 다시 체험: 배송 도우미 대화 기록 등 iframe 안 상태를 비우기 위해 다시 만든다 */
    async reload(names) {
      const list = names || ['centerAuto', 'phone'];
      for (const n of list) { handles[n]?.destroy(); handles[n] = null; }
      done = total - list.length;
      const made = await makeInOrder(list);
      list.forEach((n, i) => { handles[n] = made[i]; });
      return handles;
    },
    /* 성능: 섹션을 오래 벗어나면 iframe 4개를 모두 해제한다(화면 상자·덮개는 남긴다). restore() 로 다시 만든다 */
    get released() { return Object.values(handles).every(h => !h); },
    release() {
      for (const n of Object.keys(mk)) { handles[n]?.destroy(); handles[n] = null; }
    },
    restore() { return api.reload(ORDER); },
  };
  api.setPower('center', false); api.setPower('cluster', false); api.setPower('phone', true);
  api.showCenter('entry');
  return api;
}
