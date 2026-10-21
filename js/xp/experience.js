/* B. 1인칭 3D 체험 — 상태 머신 (docs/SPEC.md 4장)
 *
 * 사용자 클릭 4번: 체험하기 → 휴대폰 알림 → 센터 "음성으로 요청하기" → 추천 경로. 사이는 자동.
 * 클릭 → 손 이동 → 접촉 → UI 반응 순서. 손이 움직이는 동안 입력 잠금(중복 클릭 무시).
 * 실행 토큰(Run)으로 모든 대기·트윈·오디오를 취소한다(건너뛰기·다시 체험). 시간 값은 timing.js 에만 있다.
 * 클릭 판정: WebGL 위 레이캐스트 → 화면 메시 UV → 기기 px → handle.rectOf(대상) 안인지.
 * S5 첫 배송지 도착(v2): 추천 경로를 고르고 V3 가 끝나면 손·폰 없이 기본 시점으로 돌아와 출발 → 짧은 주행(drive.js) →
 *       104동 앞 정차(P) → 센터 동·입구. 끝 장면을 그대로 두고 아래 '모바일로 배송 기록하기'(#try 링크)를 보인다. 자동 스크롤 없음.
 * 이벤트: 'next:xp-done' {arrived, skipped, stop:{building, buildingLabel, entrance, unit, shipment}} (도착했을 때·건너뛰기),
 *         'next:goto' {id}(사용자가 누른 링크·3D 없이 보기만), 'next:xp-reset'
 * 건너뛰기: 언제 눌러도 페이지를 옮기지 않고 3D 무대를 도착 장면으로 둔다. 아직 불러오는 중이면 xp-done 을 바로 보내고(#try 준비)
 *       도착 장면은 불러오기가 끝나는 대로 보인다(st.skipPending). 3D 를 쓸 수 없을 때(실패)만 #try 로 옮긴다(통합 검수 RT1-01)
 * 성능: 섹션이 화면에 없으면 WebGL 렌더와 화면 레이어(iframe 그리기)를 멈춘다. 기기 화면 iframe 4개는 섹션이 화면 근처에 올 때
 *       유휴 시간에 하나씩 만들고, 다음 장(#try) 무대가 가까워지면(T.releaseOnNext) 또는 근처를 벗어나 T.releaseAfter 가 지나면
 *       해제한다(돌아오면 새로 만들어 대기 또는 도착 상태를 같은 seek 로 복원). 체험 진행 중에는 해제하지 않는다.
 * 경로: 시연 데이터는 북측 → 남측 하나뿐이라 두 번째 카드를 누르면 안내 칩만 띄우고 첫 번째(추천 경로)를 기다린다.
 * 음성 길이: 파일이 있으면 실제 길이, 없으면 manifest durationMs (voiceMs). */

import * as THREE from 'three';
import * as audio from '../audio.js';
import { T, ease } from './timing.js';
import { Run, isCancelled } from './flow.js';
import { createScene, COLLIDERS } from './scene.js';
import { createHands, POSES } from './hands.js';
import { createDevices } from './devices.js';
import { createCaptions } from './captions.js';
import { createDrive, DRIVE } from './drive.js';

/* 첫 배송지(선택한 경로의 첫 정차). 현재 UI autoplay 정차 화면(seek 38000~43000: 센터 '상동호수공원 북측 104 동 · 서쪽 공동현관',
   클러스터 '104동 정차' P 0 km/h, 폰 '104동 1203호 · 운송장 9000-0000-4023')과 postload-engine 의 A-023(stop 104, unit 1203)에서 확인한 값 */
export const STOP = Object.freeze({ building: '104', buildingLabel: '104동', entrance: '서쪽 공동현관', unit: '1203호', shipment: 'A-023' });

const ENV_YAW = -182;                    // 하역 캐노피·주차선이 앞유리 가운데~오른쪽에 오는 방향
const NOTIFY_BODY = '오늘 배송 4건을 센터 화면에서 확인하세요';
const UTTERANCE = '상동 호수공원 어디로 가요?';
const TRIGGER = '남은 배송 순서 추천해줘';   // 현재 UI 배송 도우미가 경로 선택지를 내는 요청(쇼잉에서는 UTTERANCE 로 보여 준다)
const SEL = {
  notify: '#phone .entry-notification',
  ai: '#center .cp-destination [data-cockpit="ai"]',
  route: '#center .nda-choices button',
};
const HIT_PAD = 10;                      // 클릭 판정 여유(기기 px)
const ROUTES = ['north-first'];             // 시연 데이터의 순서는 하나(상동 북측 → 상동 남측). 3D 에서는 이 경로만 진행한다
const PHONE_HOLD = { fx: 0.80, fy: 0.60, dist: 0.43, roll: -6, tilt: 4 }; // 기본 시점 화면 비율 위치와 눈까지 거리(m)
const V = (x, y, z) => new THREE.Vector3(x, y, z);

export async function init(root) {
  const $ = sel => root.querySelector(sel);
  const el = {
    stage: $('[data-xp-stage]'), viewport: $('[data-xp-viewport]'), start: $('[data-xp-start]'),
    play: $('[data-xp-play]'), load: $('[data-xp-load]'), loadBar: $('[data-xp-load-bar]'), loadFill: $('[data-xp-load-fill]'),
    loadLabel: $('[data-xp-load-label]'), fail: $('[data-xp-fail]'), failText: $('[data-xp-fail-text]'), noscene: $('[data-xp-noscene]'),
    hintAlt: $('[data-xp-hint-alt]'), routeNote: $('[data-xp-route-note]'),
    hint: $('[data-xp-hint]'), hintText: $('[data-xp-hint-text]'), hintPress: $('[data-xp-hint-press]'),
    caption: $('[data-xp-caption]'), mute: $('[data-xp-mute]'), skip: $('[data-xp-skip]'), replayTool: $('[data-xp-replay-tool]'),
    end: $('[data-xp-end]'), next: $('[data-xp-next]'), replay: $('[data-xp-replay]'),
    steps: $('[data-xp-steps]'), sound: $('.xp-sound'),
  };
  const params = new URLSearchParams(location.search);
  const debug = params.get('xpdebug') === '1';
  const captions = createCaptions(el.caption);
  const capObserver = new MutationObserver(() => el.stage.classList.toggle('has-caption', el.caption.classList.contains('is-on')));
  capObserver.observe(el.caption, { attributes: true, attributeFilter: ['class'] });

  /* ---------- 상태 ---------- */
  const st = {
    phase: 'loading', run: null, locked: true, awaiting: null, route: null,
    times: [], loaded: false, reloading: null, skipAfterReset: false,
    skipPending: false,   // 불러오는 중에 건너뛰기: 불러오기가 끝나면 도착 장면(xp-done 은 이미 보냄)
  };
  const mark = (name) => { st.times.push({ name, t: performance.now() }); log('mark', name); };
  // 검수용 기록(?xpdebug=1 에서 window.__xp.st.log 로 읽는다)
  st.log = [];
  function log(type, name) { if (debug) st.log.push({ run: st.run?.id ?? 0, type, name, t: Math.round(performance.now()) }); }
  /* 검수용 정지점: window.__xp.pauseAt 에 이름이 있으면 resume() 까지 기다린다(디버그에서만) */
  let pauseResolve = null;
  async function debugPause(run, name) {
    if (!debug || !window.__xp?.pauseAt?.includes(name)) return;
    window.__xp.paused = name;
    await run.wait(new Promise(r => { pauseResolve = r; }));
    window.__xp.paused = null;
  }

  function setStep(n) {
    for (const li of el.steps.querySelectorAll('li')) {
      const k = Number(li.dataset.step);
      li.toggleAttribute('aria-current', false);
      if (k === n) li.setAttribute('aria-current', 'step');
      li.classList.toggle('is-done', k < n);
    }
  }

  /* ---------- 불러오기 ---------- */
  const prog = { model: 0, env: 0, hands: 0, devices: 0 };
  function showProgress() {
    const p = prog.model * 0.55 + prog.env * 0.15 + prog.hands * 0.1 + prog.devices * 0.2;
    const pct = Math.round(p * 100);
    el.loadFill.style.transform = `scaleX(${p})`;
    el.loadBar.setAttribute('aria-valuenow', String(pct));
    el.loadLabel.textContent = st.skipPending ? `3D 장면 불러오는 중 ${pct}% · 끝나면 104동 도착 장면으로` : `3D 장면 불러오는 중 ${pct}%`;
  }

  // 3D 없이 보기 / 건너뛰기는 불러오기 전에도 동작
  el.noscene.addEventListener('click', () => noScene());
  el.skip.addEventListener('click', () => skip());
  el.mute.addEventListener('click', () => {
    const m = !audio.isMuted();
    audio.setMuted(m);
    el.mute.setAttribute('aria-pressed', String(m));
    el.mute.textContent = m ? '소리 켜기' : '소리 끄기';
  });

  function showFail(message) {
    st.phase = 'failed';
    el.load.hidden = true;
    el.fail.hidden = false;
    el.play.hidden = true;
    el.sound.hidden = true;
    if (message && el.failText) el.failText.textContent = message;
    el.stage.classList.add('is-failed');
    root.dataset.xpState = 'failed';
  }

  /* three r180 은 WebGL 2 가 필요하다. 없으면 불러오기 전에 '3D 없이 보기' 안내 */
  function webgl2() {
    try { const c = document.createElement('canvas'); return !!(window.WebGL2RenderingContext && c.getContext('webgl2')); } catch { return false; }
  }
  if (!webgl2() || params.get('xpfail') === 'webgl') {
    showFail('이 브라우저에서는 3D를 표시할 수 없습니다');
    return;
  }

  let S, H, DR, D = null;
  try {
    S = await createScene({ viewport: el.viewport, envYawDeg: ENV_YAW, debug, onProgress: p => { prog.model = p.model; prog.env = p.env; showProgress(); } });
    H = await createHands(S);
    // ?lightmap=1: 손·폰 재질에 창밖 HDR 반사를 직접 넣는다(라이트맵 비교용, 기본은 아무것도 하지 않음)
    S.lightmap?.applyDynamic(['ARM_ROOT', 'PHONE_ROOT'].map(n => S.scene.getObjectByName(n)));
    DR = await createDrive(S, { envYawDeg: ENV_YAW });
    prog.hands = 1; showProgress();
  } catch (err) {
    console.error('[xp] 3D 불러오기 실패', err);
    showFail('3D 장면을 불러오지 못했습니다');
    return;
  }

  /* 화면 레이어(기기 iframe 이 붙는 CSS3D 층)는 보이기만 하는 화면이다. 조작은 캔버스 레이캐스트로 하므로
     이 층만 inert 로 Tab 순서·보조기기에서 뺀다. 캔버스는 같은 [data-xp-viewport] 안에 있어 viewport 전체를 inert 로 하면 클릭이 막힌다 */
  S.css.domElement.inert = true;

  /* ---------- 보이는 동안만 렌더 ---------- */
  const io = new IntersectionObserver(entries => {
    for (const e of entries) S.setActive(e.isIntersecting);
  }, { threshold: 0 });
  io.observe(el.stage);

  /* ---------- 미리 올리기(성능) ----------
   * 첫 WebGL 렌더는 텍스처 업로드(창밖 4096×2048, 손·소매 2048² 세 장)와 셰이더 연결 때문에 0.4~0.6s 멈췄다.
   * 그 멈춤이 3D 장으로 스크롤해 들어가는 순간에 났다(통합 검수 RT-03). 무대가 보이기 전 유휴 시간에
   * 텍스처를 한 장씩 올리고(작업을 나눠서), 숨겨 둔 손·폰까지 셰이더를 병렬 컴파일하고, 화면 밖에서 한 번 그려 둔다.
   * 무대가 이미 보이면(S.active) 그만둔다. 그때는 보이는 첫 렌더가 같은 일을 한다 */
  const idle = (timeout = 1500) => new Promise(r => (window.requestIdleCallback ? requestIdleCallback(() => r(), { timeout }) : setTimeout(r, 120)));
  async function warmUp() {
    const textures = new Set();
    S.scene.traverse(o => {
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) for (const k of Object.keys(m)) { const v = m[k]; if (v && v.isTexture && !v.isRenderTargetTexture) textures.add(v); }
    });
    for (const t of textures) {
      await idle();
      if (S.active) return;
      try { S.renderer.initTexture(t); } catch { /* 첫 렌더가 다시 시도한다 */ }
    }
    await idle();
    if (S.active || st.phase === 'running') return;
    // 손·폰은 숨겨져 있어 compile(보이는 것만 훑음)에서 빠진다. 같은 작업 안에서 잠깐 켰다 끈다(그리지 않음)
    let pending = null;
    H.setVisible(true); H.setPhoneVisible(true);
    const was = [DR.world.visible, DR.sky.visible];
    DR.world.visible = true; DR.sky.visible = true;   // 첫 배송지 주행 장면도 함께(숨겨 둔 상태)
    try { pending = S.renderer.compileAsync ? S.renderer.compileAsync(S.scene, S.camera) : S.renderer.compile(S.scene, S.camera); } catch { /* noop */ }
    H.setVisible(false); H.setPhoneVisible(false);
    DR.world.visible = was[0]; DR.sky.visible = was[1];
    try { await pending; } catch { /* noop */ }
    await idle();
    if (!S.active) { try { S.renderer.render(S.scene, S.camera); } catch { /* noop */ } }
    log('warm', 'done');
  }

  /* ---------- 장면 기준 값 ---------- */
  const centerFrame = S.screens.center.frame;
  const eyeDefault = S.eyeDefault.clone();

  function cameraPoint(fx, fy, dist) {
    const blend = S.blend;
    S.setBlend(0);
    const p = V(fx * 2 - 1, 1 - fy * 2, 0.5).unproject(S.camera).sub(S.camera.position).normalize().multiplyScalar(dist).add(S.camera.position);
    S.setBlend(blend);
    return p;
  }

  /* 폰을 든 손 키 */
  const phonePos = cameraPoint(PHONE_HOLD.fx, PHONE_HOLD.fy, PHONE_HOLD.dist);
  const phoneQuat = H.phoneFacing(phonePos, eyeDefault, PHONE_HOLD.roll, PHONE_HOLD.tilt);
  // 팔: 아래팔 방향은 손 회전에서 손목을 거의 굽히지 않은 방향(최대 maxBend 도), 위팔은 화면 밖으로 빠지는 방향.
  // 기본 시점 카메라는 운전자 눈보다 0.3m 뒤에 있어(03_camera.json) 해부학적 어깨 위치로 위팔을 그리면 카메라 바로 앞을 가린다.
  // 그래서 위팔은 팔꿈치에서 화면 밖(아래·뒤)으로 빠지게 두고, 검수에서 위팔 표본점이 화면 밖인지 확인한다
  const phoneNatural = { pref: V(-0.35, 0.55, -0.55), maxBend: 22, upper: V(0.1, -0.85, -0.35) };
  function phoneKey(pos, quat, fingers) {
    const hk = H.handFromPhone(pos, quat);
    return { pos: hk.pos, quat: hk.quat, natural: phoneNatural, fingers };
  }
  const phoneLowPos = phonePos.clone().add(V(0.16, -0.36, 0.12));
  const phoneLowQuat = phoneQuat.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5, 0.25, 0.2)));

  /* 알림 탭용 엄지: 알림 카드 안 한 점(UV)을 정해 엄지 끝을 화면 위 1mm(탭) / 12mm(대기)에 둔다 */
  let thumb = null;
  function solveThumb(u, v) {
    const tap = H.solveThumbForScreenUV(u, v, 0.001);
    const hover = H.solveThumbForScreenUV(u, v, 0.012);
    thumb = { u, v, tap: tap.spec.thumb, hover: hover.spec.thumb, tapErr: tap.error, hoverErr: hover.error, clearance: tap.minClearance };
    return thumb;
  }
  solveThumb(0.62, 0.47); // 현재 UI 알림 카드 안(390×844 기준 약 x240, y397). 알림이 뜨면 실제 사각형으로 다시 확인

  /* 검지 탭 키 */
  const up = V(0, 1, 0);
  const left = V(-1, 0, 0);
  const pointNatural = { pref: V(-0.42, 0.32, -0.85), maxBend: 24, upper: V(-0.2, 0.62, -0.75) };
  function tapKeys(px, py) {
    const u = px / 1280, v = py / 720;
    const target = S.uvToWorld('center', u, v);
    const n = centerFrame.normal.clone();
    const dir = n.clone().multiplyScalar(-0.78).addScaledVector(up, 0.36).addScaledVector(left, 0.30).normalize();
    const palm = V(-0.35, -0.85, -0.25).normalize();
    const opts = { dir, palm, natural: pointNatural, screenFrame: centerFrame };
    const touch = H.pointKey(target, n, { ...opts, clearance: 0.003 });
    const pre = H.pointKey(target, n, { ...opts, clearance: 0.06 });
    const away = { ...pre, pos: pre.pos.clone().add(V(0.14, -0.24, 0.16)), fingers: H.lerpSpec(POSES.relaxed, POSES.point, 0.4) };
    return { target, touch, pre, away };
  }

  /* ---------- 손 애니메이션 ---------- */
  let handKey = null;
  function setHand(key) { handKey = key; H.applyKey(key); S.requestRender(); }
  function tweenHand(run, from, to, ms, easing) {
    return run.tween(ms, e => setHand(H.lerpKey(from, to, e)), easing);
  }

  /* ---------- 기기 상태 도우미 ---------- */
  const hs = () => D.handles;
  const xs = name => hs()[name]?.win?.NextXpStates;

  /* 끝 상태 화면: autoplay 경로 표시(북측 → 남측). seek 는 #center 를 다시 그려 요청 카드 제목이 내부 요청 문장(TRIGGER)으로
     돌아오므로 쇼잉 대사(UTTERANCE)로 다시 맞춘다(xp-states 의 alias 는 이후 다시 그려져도 계속 바꾼다) */
  function seekRouteMap() {
    hs().centerAuto.seek(T.routeMapSeek);
    hs().cluster.seek(T.routeMapSeek);
    xs('centerAuto')?.center.alias(TRIGGER, UTTERANCE);
  }
  /* 첫 정차 화면(같은 값으로 끝·건너뛰기·복원): 센터 104동 · 서쪽 공동현관, 클러스터 P 0 km/h '104동 정차' */
  function seekArrive() {
    hs().centerAuto.seek(T.arriveSeek);
    hs().cluster.seek(T.arriveSeek);
    setArrived(true);
  }
  /* 정차 상태 표식(xp-states arrived → body.xp-arrived). 표시는 바꾸지 않는다(경로선은 현재 UI 정차 화면 그대로, 통합 검수 R2-REQ-03) */
  function setArrived(on) {
    for (const n of ['centerAuto', 'cluster']) xs(n)?.arrived?.(on);
  }
  /* 도착 끝 장면(소리·손 없이 상태만): 건너뛰기·해제 뒤 복원에서 쓴다 */
  function showArrival() {
    H.setVisible(false);
    H.setPhoneVisible(false);
    el.stage.classList.remove('is-idle');
    D.setPower('center', true, 0);
    D.setPower('cluster', true, 0);
    D.setPower('phone', true, 0);
    D.showCenter('auto', 0);
    seekArrive();
    DR.arrive();
    S.setBlend(T.arriveFocus);
    S.requestRender();
  }

  function resetWorld() {
    DR.reset();
    S.setBlend(0);
    H.setVisible(false);
    H.setPhoneVisible(false);
    D.setPower('center', false, 0);
    D.setPower('cluster', false, 0);
    D.setPower('phone', true, 0);
    D.showCenter('entry', 0);
    hs().cluster.seek(0);
    hs().centerAuto.seek(0);
    xs('phone')?.phone.quietLock(true);
    for (const n of ['phone', 'centerAuto', 'centerEntry', 'cluster']) xs(n)?.clearMarks();
    setArrived(false);
    captions.clear();
    hideHint();
    hideRouteNote();
    el.end.hidden = true;
    el.replayTool.hidden = true;
    el.skip.hidden = false;
    S.requestRender();
  }

  /* ---------- 입력 대기 ---------- */
  let clickResolve = null;
  // 키보드로 조작 중이면(마지막 입력이 키) 입력 안내가 뜰 때 그 버튼으로 초점을 옮긴다
  let keyboardMode = false;
  window.addEventListener('keydown', e => { if (e.key === 'Tab' || e.key === 'Enter' || e.key === ' ') keyboardMode = true; }, true);
  window.addEventListener('pointerdown', () => { keyboardMode = false; }, true);
  function focusIfKeyboard(btn) { if (keyboardMode && btn && !btn.hidden) btn.focus({ preventScroll: true }); }

  function showHint(text, keys) {
    el.hintText.textContent = text;
    el.hintPress.textContent = keys?.[0] || '키보드로 누르기';
    el.hintAlt.hidden = !keys?.[1];
    if (keys?.[1]) el.hintAlt.textContent = keys[1];
    el.hint.hidden = false;
    requestAnimationFrame(() => el.hint.classList.add('is-on'));
    focusIfKeyboard(el.hintPress);
  }
  function hideHint() {
    const hadFocus = el.hint.contains(document.activeElement);
    el.hint.classList.remove('is-on');
    el.hint.hidden = true;
    // 초점이 사라지지 않게 무대(tabindex=-1)로 옮긴다. 건너뛰기 버튼으로 옮기면 Enter 연타에 체험이 건너뛰어진다
    if (hadFocus) el.stage.focus({ preventScroll: true });
  }

  function waitClick(run, target, hintText, keys) {
    st.awaiting = target;
    st.locked = false;
    run.sleep(T.hintDelay).then(() => { if (st.awaiting === target) showHint(hintText, keys); }, () => {});
    return run.wait(new Promise(resolve => { clickResolve = resolve; })).finally(() => {
      st.awaiting = null;
      st.locked = true;
      clickResolve = null;
      hideHint();
    });
  }

  function targetHandle(device) { return device === 'phone' ? hs().phone : hs().centerAuto; }
  function targetMesh(device) { return device === 'phone' ? H.phoneScreen : S.screens.center.mesh; }

  /* 레이캐스트 → 대상이면 { index } */
  function hitTest(clientX, clientY) {
    const a = st.awaiting;
    if (!a) return null;
    // 대상 화면 메시만 검사한다(기본 시점의 핸들 림 등은 집중 시점·폰 단계에서 화면을 가리지 않는다.
    // 화면 위에 떠 있는 엄지를 눌러도 알림을 누른 것으로 본다)
    const hit = S.raycast(clientX, clientY, [targetMesh(a.device)], false);
    if (!hit || !hit.uv) return null;
    const px = D.uvToPx(a.device, hit.uv.x, hit.uv.y);
    const h = targetHandle(a.device);
    const list = [...(h.doc?.querySelectorAll(a.selector) || [])];
    for (let i = 0; i < list.length; i++) {
      const r = h.rectOf(list[i]);
      if (!r) continue;
      if (px.x >= r.x - HIT_PAD && px.x <= r.x + r.w + HIT_PAD && px.y >= r.y - HIT_PAD && px.y <= r.y + r.h + HIT_PAD) return { index: i, px };
    }
    return null;
  }

  const canvas = S.renderer.domElement;
  canvas.addEventListener('pointermove', e => {
    const ok = !st.locked && st.awaiting && hitTest(e.clientX, e.clientY);
    el.stage.classList.toggle('is-target-hover', !!ok);
  });
  /* 대기 대상이 accept(받을 순번)를 정해 두면 다른 순번은 진행하지 않고 안내만 띄운다(두 번째 경로) */
  function offer(hit) {
    const a = st.awaiting;
    if (a.accept != null && hit.index !== a.accept) { log('reject', `index:${hit.index}`); showRouteNote(); return; }
    clickResolve(hit);
  }
  canvas.addEventListener('click', e => {
    if (st.locked || !st.awaiting || !clickResolve) return; // 손이 움직이는 동안의 클릭은 무시
    const hit = hitTest(e.clientX, e.clientY);
    if (hit) offer(hit);
  });
  el.hintPress.addEventListener('click', () => {
    if (st.locked || !st.awaiting || !clickResolve) return;
    offer({ index: 0, keyboard: true });
  });
  el.hintAlt.addEventListener('click', () => {
    if (st.locked || !st.awaiting || !clickResolve) return;
    offer({ index: 1, keyboard: true });
  });

  /* 두 번째 경로 안내 칩: 시연 데이터가 북측 → 남측 하나뿐임을 밝히고 첫 번째를 누르게 한다 */
  let noteTimer = 0;
  function showRouteNote() {
    clearTimeout(noteTimer);
    el.routeNote.hidden = false;
    el.routeNote.classList.remove('is-on');
    void el.routeNote.offsetWidth;
    el.routeNote.classList.add('is-on');
    noteTimer = setTimeout(hideRouteNote, T.routeNoteHold);
  }
  function hideRouteNote() {
    clearTimeout(noteTimer);
    noteTimer = 0;
    el.routeNote.classList.remove('is-on');
    el.routeNote.hidden = true;
  }

  /* ---------- 오디오 ---------- */
  function sfx(name) { log('sfx', name); captions.sfx(name); return audio.play(name); }

  /* 음성 길이(ms): 파일이 있으면(available:true) 실제 파일 길이, 없거나 아직 모르면 manifest durationMs.
     받아쓰기 글자 속도가 이 값을 따른다. 장면 대기 자체는 audio.play 가 파일 끝(없으면 durationMs)에 풀어 준다 */
  const SITE_ROOT = new URL('../../', import.meta.url);
  const realMs = new Map();
  async function probeVoices() {
    await audio.ready();
    const list = audio.list();
    for (const [name, item] of Object.entries(list)) {
      if (item.channel !== 'voice' || !audio.has(name)) continue;
      const a = new Audio();
      a.preload = 'metadata';
      a.addEventListener('loadedmetadata', () => { if (Number.isFinite(a.duration) && a.duration > 0) realMs.set(name, Math.round(a.duration * 1000)); }, { once: true });
      a.src = new URL(item.file, SITE_ROOT).href;
    }
  }
  function voiceMs(name) { return realMs.get(name) ?? audio.caption(name)?.durationMs ?? 2000; }

  /* ---------- 시나리오 ---------- */
  async function scenario(run) {
    st.times = [];
    mark('start');
    setStep(1);
    /* S1 시동 */
    el.stage.classList.remove('is-idle');
    el.replayTool.hidden = false;
    S.setContinuous(true);
    await run.sleep(T.powerOnDelay);
    sfx('sfx-ev-start');
    D.setPower('cluster', true, T.powerOnFade);
    await run.sleep(T.powerStagger);
    D.setPower('center', true, T.powerOnFade);
    await run.sleep(T.powerOnFade + T.s1Hold);
    mark('s1-end');

    /* S2 알림 */
    await run.sleep(T.s2Delay);
    setStep(2);
    sfx('sfx-vibrate');
    const low = phoneKey(phoneLowPos, phoneLowQuat, { ...H.cloneSpec(H.GRIP), thumb: [...thumb.hover] });
    const hold = phoneKey(phonePos, phoneQuat, { ...H.cloneSpec(H.GRIP), thumb: [...thumb.hover] });
    setHand(low);
    H.setVisible(true);
    H.setPhoneVisible(true);
    await tweenHand(run, low, hold, T.phoneRise, ease.reach);
    await run.sleep(T.lockToNotify);
    xs('phone').phone.notify(NOTIFY_BODY);
    sfx('sfx-notify');
    await run.sleep(T.notifySlide);
    // 실제 알림 사각형 안에 엄지 점이 있는지 확인(아니면 다시 푼다)
    const nr = hs().phone.rectOf(SEL.notify);
    if (nr) {
      const p = D.uvToPx('phone', thumb.u, thumb.v);
      if (!(p.x > nr.x + 12 && p.x < nr.x + nr.w - 12 && p.y > nr.y + 12 && p.y < nr.y + nr.h - 12)) {
        const uv = D.pxToUV('phone', nr.x + nr.w * 0.62, nr.y + nr.h * 0.5);
        solveThumb(uv.u, uv.v);
      }
    }
    xs('phone').pulse(SEL.notify, true);
    mark('s2-ready');
    await waitClick(run, { device: 'phone', selector: SEL.notify }, '휴대폰 알림을 눌러 오늘 배송을 여세요', ['알림 누르기']);
    mark('s2-click');

    /* S2' 알림 탭 */
    xs('phone').pulse(SEL.notify, false);
    const tapKey = { ...hold, fingers: { ...H.cloneSpec(H.GRIP), thumb: [...thumb.tap] } };
    await tweenHand(run, hold, tapKey, T.thumbTap, ease.press);
    sfx('sfx-tap');
    xs('phone').press(SEL.notify, true);
    mark('s2-contact');
    await debugPause(run, 's2-contact');
    await run.sleep(T.pressHold);
    D.showCenter('auto', T.centerSwap);
    hs().centerAuto.seek(0);
    xs('phone').phone.open();
    const v1 = audio.play('voice-v1');
    await tweenHand(run, tapKey, hold, T.thumbRelease, ease.press);
    /* S3 센터 집중(V1 과 동시) + 폰 내리기 */
    setStep(3);
    const cam = run.tween(T.cameraFocus, e => S.setBlend(e), ease.camera);
    cam.catch(() => {});      // 나중에 await 한다. 그 전에 취소되면 거부를 여기서 받아 둔다(처리 안 된 거부 방지)
    await run.sleep(T.phoneLowerDelay);
    await tweenHand(run, hold, low, T.phoneLower, ease.lower);
    H.setVisible(false);
    H.setPhoneVisible(false);
    await cam;
    xs('centerAuto').pulse(SEL.ai, true);
    // 손 경로는 클릭 전에 미리 계산해 둔다(클릭 뒤 멈칫 없음)
    const ar = hs().centerAuto.rectOf(SEL.ai);
    const k1 = tapKeys(ar.x + ar.w * 0.5, ar.y + ar.h * 0.5);
    mark('s3-ready');
    await waitClick(run, { device: 'center', selector: SEL.ai }, '센터 화면의 음성으로 요청하기를 눌러 방문 순서를 물어보세요', ['음성으로 요청하기']);
    mark('s3-click');

    /* S3' 음성으로 요청하기 */
    audio.stop('voice');      // 안내 음성이 남아 있으면 끊고 진행(겹침 없음)
    void v1;
    xs('centerAuto').pulse(SEL.ai, false);
    setHand(k1.away);
    H.setVisible(true);
    const reach = T.indexReach;
    await tweenHand(run, k1.away, k1.pre, reach * (1 - T.indexPressShare), ease.reach);
    await tweenHand(run, k1.pre, k1.touch, reach * T.indexPressShare, ease.press);
    sfx('sfx-tap');
    xs('centerAuto').press(SEL.ai, true);
    mark('s3-contact');
    st.debugMeasure = H.measureAgainst(centerFrame);
    await debugPause(run, 's3-contact');
    await run.sleep(T.pressHold);
    const xc = xs('centerAuto');
    xc.center.openAssistant();
    xc.center.micDown();
    const retract = (async () => {
      await tweenHand(run, k1.touch, k1.pre, T.indexRelease, ease.press);
      await tweenHand(run, k1.pre, k1.away, T.handRetract, ease.lower);
      H.setVisible(false);
    })();
    retract.catch(() => {});  // 아래 await retract 전에 건너뛰기·다시 체험으로 취소되는 경우
    await run.sleep(T.micConnect);
    hs().centerAuto.voice.listen();
    xc.center.listening(true);
    // 원본 음성 1 과 맞춰 글자 단위 입력
    const speech = audio.play('source-0418');
    const typeMs = Math.max(400, voiceMs('source-0418') - T.typingLead);
    await run.sleep(T.typingLead);
    const chars = [...UTTERANCE];
    await run.tween(typeMs, (e) => {
      const n = Math.max(1, Math.round(chars.length * e));
      xc.center.transcript(chars.slice(0, n).join(''));
    }, ease.linear);
    await run.wait(speech);
    await retract;
    mark('s3-voice-end');

    /* S4 AI 대기 */
    setStep(4);
    await run.sleep(T.recognizedDelay);
    xc.center.recognized(UTTERANCE);
    await run.sleep(T.recognizedHold);
    xc.center.thinking(true);
    await run.sleep(T.aiWait);
    xc.center.alias(TRIGGER, UTTERANCE);
    hs().centerAuto.voice.result(TRIGGER, true);   // 현재 UI 가 경로 선택지 두 개를 그린다
    /* S4' 추천 */
    xc.pulse(`${SEL.route}:first-of-type`, true);
    const v2 = audio.play('voice-v2');
    const firstRoute = hs().centerAuto.doc.querySelector(SEL.route);
    const fr = hs().centerAuto.rectOf(firstRoute);
    const k2 = tapKeys(fr.x + fr.w * 0.42, fr.y + fr.h * 0.5);   // 손 경로는 미리 계산(첫 번째 카드만 진행)
    mark('s4-ready');
    // 시연 데이터(현재 UI autoplay·하루 이야기)는 북측 → 남측 하나뿐이다. 두 번째 카드를 누르면 손은 움직이지 않고
    // 화면 위 안내만 띄운 채 첫 번째(추천 경로)를 기다린다(accept: 0)
    await waitClick(run, { device: 'center', selector: SEL.route, accept: 0 }, '규칙으로 정한 두 순서 중 첫 번째(북측 먼저)를 누르세요', ['첫 번째 순서', '두 번째 순서']);
    mark('s4-click');

    /* S4'' 경로 탭 */
    audio.stop('voice');
    void v2;
    hideRouteNote();
    xc.clearMarks();
    st.route = ROUTES[0];
    setHand(k2.away);
    H.setVisible(true);
    await tweenHand(run, k2.away, k2.pre, T.routeReach * (1 - T.indexPressShare), ease.reach);
    await tweenHand(run, k2.pre, k2.touch, T.routeReach * T.indexPressShare, ease.press);
    sfx('sfx-tap');
    mark('s4-contact');
    st.debugMeasure2 = H.measureAgainst(centerFrame);
    await debugPause(run, 's4-contact');
    (hs().centerAuto.doc.querySelector(SEL.route) || firstRoute).click();   // 현재 UI: "선택됨" + 적용 확인(접촉 순간 다시 찾는다)
    const retract2 = (async () => {
      await tweenHand(run, k2.touch, k2.pre, T.indexRelease, ease.press);
      await tweenHand(run, k2.pre, k2.away, T.handRetract, ease.lower);
      H.setVisible(false);
    })();
    retract2.catch(() => {});
    const src2 = audio.play('source-0434');
    await run.sleep(T.routeSelectToMap);
    // 고른 순서(북측 → 남측)가 현재 UI autoplay 의 경로 표시와 같다. seek 는 #center 를 다시 그리므로
    // 요청 문장(카드 제목·말풍선)을 기사 발화로 다시 맞춘다
    seekRouteMap();
    log('route-applied', st.route);
    await retract2;
    await run.wait(src2);
    await run.wait(audio.play('voice-v3'));
    mark('s4-end');
    await debugPause(run, 's4-end');

    /* S5 첫 배송지 도착 */
    await arrival(run);
    finish(false);
  }

  /* S5: 경로 화면을 잠깐 두고 → 기본 시점으로 복귀 → D 출발 → 주행(현재 UI drive 구간 시간 압축) → 정차 P → 센터 동·입구.
     폰은 S3 에서 이미 내려놓았고 손은 경로 탭 뒤 물러났다(운전 중 손 조작 없음) */
  async function arrival(run) {
    await run.sleep(T.arriveSettle);
    setStep(5);
    mark('s5-start');
    DR.compile();                                   // 주행 장면 셰이더(이미 warmUp 에서 했으면 바로 끝남)
    await run.tween(T.cameraReturn, e => S.setBlend(1 - e), ease.camera);
    mark('s5-camera');
    setArrived(false);                               // 주행 중에는 경로선을 그대로 보인다
    hs().cluster.seek(T.driveSeekFrom);              // 클러스터 D · 0 km/h, 다음 안내
    hs().centerAuto.seek(T.driveSeekFrom);           // 센터 주행 지도(경로선·회전 안내는 현재 UI 그대로)
    await run.sleep(T.gearHold);
    mark('s5-depart');
    await debugPause(run, 's5-depart');
    const hazeShare = T.hazeMs / T.driveMs;
    const last = { cluster: -Infinity, center: -Infinity };
    const step = (t) => {
      // 현재 UI 속도 곡선(peak·sin(πp))과 같은 모양으로 움직인다: 거리 = 전체 · (1 - cos πt) / 2
      DR.set(DRIVE.distance * (1 - Math.cos(Math.PI * t)) / 2, Math.min(1, t / hazeShare));
      if (t >= 1) return;
      const now = performance.now();
      const ms = T.driveSeekFrom + (T.driveSeekTo - T.driveSeekFrom) * t;
      // 한 프레임에 기기 하나만 다시 그린다(센터 지도 seek 는 무겁다)
      if (now - last.cluster >= T.driveSeekCluster) { last.cluster = now; hs().cluster.seek(ms); }
      else if (now - last.center >= T.driveSeekCenter) { last.center = now; hs().centerAuto.seek(ms); }
    };
    const samples = debug ? (window.__xp?.pauseAt || []).filter(n => /^drive@/.test(n)).map(n => Number(n.slice(6))).sort((a, b) => a - b) : [];
    if (!samples.length) await run.tween(T.driveMs, (e, t) => step(t), ease.linear);
    else {
      // 검수용(?xpdebug=1 + pauseAt 'drive@0.5' 등): 그 진행값에서 멈춰 두 기기를 같은 값으로 맞춘 뒤 resume() 을 기다린다
      let t = 0, prev = performance.now();
      while (t < 1) {
        await run.wait(new Promise(r => requestAnimationFrame(r)));
        const now = performance.now();
        t = Math.min(1, t + (now - prev) / T.driveMs);
        prev = now;
        if (samples.length && t >= samples[0]) {
          t = samples.shift();
          step(t);
          const ms = T.driveSeekFrom + (T.driveSeekTo - T.driveSeekFrom) * t;
          hs().cluster.seek(ms); hs().centerAuto.seek(ms);
          await debugPause(run, `drive@${t}`);
          prev = performance.now();
        } else step(t);
      }
    }
    seekArrive();                                    // 정차: P · 0 km/h, 센터 104동 · 서쪽 공동현관
    log('arrive', STOP.buildingLabel);
    mark('s5-park');
    await debugPause(run, 's5-park');
    await run.sleep(T.parkSettle);
    if (T.arriveFocus > 0) await run.tween(T.arriveFocusMs, e => S.setBlend(T.arriveFocus * e), ease.camera);
    mark('s5-end');
  }

  /* ---------- 끝 / 건너뛰기 / 다시 ---------- */
  function doneDetail(skipped) { return { arrived: true, skipped, stop: { ...STOP } }; }

  function finish(skipped, { announce = true } = {}) {
    st.phase = 'end';
    st.locked = true;
    S.setContinuous(false);
    S.requestRender();
    setStep(6);
    el.end.hidden = false;
    el.replayTool.hidden = true;
    el.skip.hidden = true;          // 이미 도착 장면이다(다시 체험하면 다시 보인다)
    root.dataset.xpState = 'end';
    focusIfKeyboard(el.next);
    mark('end');
    if (announce) window.dispatchEvent(new CustomEvent('next:xp-done', { detail: doneDetail(skipped) }));
  }

  /* 사용자가 누른 이동만(자동 스크롤 없음): 모바일 체험(#try) */
  function goTry() {
    if (!document.getElementById('try')) return false;
    window.dispatchEvent(new CustomEvent('next:goto', { detail: { id: 'try' } }));
    return true;
  }
  /* 3D 를 쓸 수 없을 때(실패) 3D 없이 보기·건너뛰기: 도착한 시연 상태로 모바일 체험을 연다 */
  function noScene() {
    window.dispatchEvent(new CustomEvent('next:xp-done', { detail: doneDetail(true) }));
    goTry();
  }

  function stopRun() {
    st.run?.cancel();
    st.run = null;
    audio.stopAll();
    captions.clear();
    hideHint();
    hideRouteNote();
    clickResolve = null;
    st.awaiting = null;
  }

  /* 건너뛰기: 어디서 눌러도 음성·모션을 정리하고 첫 배송지 도착·정차 끝 장면으로(촬영·배송 기록은 만들지 않는다).
     다시 체험으로 기기 화면을 다시 만드는 중이면 끝난 뒤 건너뛴다. 3D 를 쓸 수 없으면 도착 상태로 모바일 체험을 연다.
     장면·기기 화면을 아직 불러오는 중이면 페이지는 그대로 두고 도착을 예약한다(xp-done 은 바로 보내 #try 를 준비) */
  function skip() {
    if (st.phase === 'resetting') { st.skipAfterReset = true; return; }
    if (st.phase === 'failed') { noScene(); return; }
    if (st.phase === 'loading' || st.dev !== 'ready') {
      if (st.phase === 'running') { stopRun(); st.phase = 'idle'; }
      reserveArrival();
      return;
    }
    stopRun();
    arriveNow(true);
  }
  function arriveNow(announce) {
    st.skipPending = false;
    el.play.hidden = false;           // 다시 체험하면 시작 화면이 다시 보인다
    el.sound.hidden = false;
    showArrival();
    st.route = ROUTES[0];
    finish(true, { announce });
  }
  function reserveArrival() {
    if (st.skipPending) return;
    st.skipPending = true;
    log('skip', 'pending');
    el.skip.hidden = true;
    el.play.hidden = true;            // 곧 도착 장면으로 바뀌므로 '체험하기'를 기다리게 하지 않는다
    el.sound.hidden = true;
    showProgress();
    window.dispatchEvent(new CustomEvent('next:xp-done', { detail: doneDetail(true) }));
    if (S && st.phase !== 'loading') ensureDevices();
  }

  async function replay() {
    stopRun();
    st.skipAfterReset = false;
    st.phase = 'resetting';
    el.play.disabled = true;
    el.end.hidden = true;
    el.stage.classList.add('is-idle');
    window.dispatchEvent(new CustomEvent('next:xp-reset'));
    // 배송 도우미 대화·알림 1회 제한 등 iframe 안 상태를 비우려고 다시 만든다(해제된 상태면 네 개 모두 새로)
    st.reloading = st.dev === 'ready' ? D.reload(['centerAuto', 'phone']) : ensureDevices();
    await st.reloading;
    st.reloading = null;
    if (st.dev !== 'ready') return;
    resetWorld();
    setStep(0);
    st.phase = 'idle';
    el.play.disabled = false;
    if (st.skipAfterReset) { st.skipAfterReset = false; skip(); return; }
    el.play.focus({ preventScroll: true });
  }

  el.replay.addEventListener('click', () => replay());
  el.replayTool.addEventListener('click', () => replay());
  // '모바일로 배송 기록하기'는 #try 링크다. main.js 의 이동(도착 고정 포함)을 쓰고, 없으면 링크 기본 동작
  el.next.addEventListener('click', e => { if (goTry()) e.preventDefault(); });

  /* 장 이동(숫자 키·상단 내비·발표 동선)은 장 머리(제목·설명)에 맞춰 도착하므로 무대 아래쪽이 화면 밖일 수 있다.
     체험하기를 누르면 무대를 내비 아래에 맞춘다. main.js 의 도착 고정(pinTo)을 쓰면 늦게 바뀌는 높이에도 다시 맞고,
     장 머리로 되돌리는 보정과 다투지 않는다. main.js 없이 띄운 개발 페이지에서는 scrollIntoView */
  async function bringStageIntoView() {
    const pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    const r = el.stage.getBoundingClientRect();
    if (Math.abs(r.top - pad) <= 2) return;
    try {
      const main = [...document.querySelectorAll('script[type="module"][src]')].find(s => /(^|\/)js\/main\.js$/.test(new URL(s.src, document.baseURI).pathname));
      if (main) {
        const mod = await import(main.src);
        if (mod.pinTo?.(el.stage, { id: root.id || 'xp' })) return;
      }
    } catch { /* 아래로 */ }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.stage.scrollIntoView({ behavior: reduce ? 'instant' : 'smooth', block: 'start' });
  }

  el.play.addEventListener('click', async () => {
    if (st.phase !== 'idle' || st.dev !== 'ready') return;
    st.phase = 'running';
    root.dataset.xpState = 'running';
    el.play.disabled = true;
    bringStageIntoView();
    await audio.unlock();
    const run = new Run();
    st.run = run;
    try {
      await scenario(run);
    } catch (err) {
      if (!isCancelled(err)) {
        console.error('[xp] 시나리오 오류', err);
        skip();
      }
    }
  });

  /* ---------- 기기 화면 iframe 수명 ---------- */
  // dev: 'none' 아직 없음/해제됨 · 'loading' 만드는 중 · 'ready'
  st.dev = 'none';
  st.releases = 0;
  let devJob = null;
  let releaseTimer = 0;
  let releaseAt = 0;
  // 검수용: ?xpdebug=1&xprelease=<ms> 로 해제 대기 시간을 줄여 확인한다
  const releaseAfter = debug && Number(params.get('xprelease')) > 0 ? Number(params.get('xprelease')) : T.releaseAfter;

  function showLoading() {
    el.load.hidden = false;
    el.play.disabled = true;
    root.dataset.xpState = 'loading';
  }

  /* 끝 상태의 화면을 다시 그린다(해제 뒤 복원용). 소리·손 없이 도착 장면(같은 seek) */
  async function paintEndScreens() { showArrival(); }

  function ensureDevices() {
    if (st.dev === 'ready') return Promise.resolve();
    if (devJob) return devJob;
    st.dev = 'loading';
    if (st.phase !== 'end') showLoading();
    devJob = (async () => {
      prog.devices = 0; showProgress();
      if (!D) D = await createDevices(S, H, { onProgress: p => { prog.devices = p; showProgress(); } });
      else await D.restore();
      st.dev = 'ready';
      if (st.phase === 'end') await paintEndScreens();
      else if (st.skipPending) arriveNow(false);   // 불러오는 중에 누른 건너뛰기(xp-done 은 이미 보냄)
      else {
        resetWorld();
        setStep(0);
        st.phase = 'idle';
        el.stage.classList.add('is-idle');
      }
      el.load.hidden = true;
      el.play.disabled = false;
      root.dataset.xpState = st.phase === 'end' ? 'end' : 'ready';
      S.requestRender();
    })().catch(err => {
      console.error('[xp] 기기 화면 불러오기 실패', err);
      st.dev = 'none';
      showFail('기기 화면을 불러오지 못했습니다');
    }).finally(() => { devJob = null; updateLife(); });
    return devJob;
  }

  function releaseDevices() {
    clearTimeout(releaseTimer);
    releaseTimer = 0;
    if (st.dev === 'none' && !devJob) return;
    // 만드는 중·다시 만드는 중·체험 진행 중에는 해제하지 않고 나중에 다시 본다(진행 중인 체험은 끊지 않는다)
    if (st.dev !== 'ready' || st.phase === 'resetting' || st.phase === 'running') {
      if (st.phase !== 'failed') releaseTimer = setTimeout(releaseDevices, RELEASE_RETRY);
      return;
    }
    D.release();
    st.dev = 'none';
    st.releases++;
    el.play.disabled = true;
    root.dataset.xpState = 'released';
    log('dev', 'release');
  }

  /* iframe 수명 판단
   *   만든다: 무대가 화면에 보이거나, 무대가 화면 근처(위아래 한 화면)이고 다음 장(#try) 무대가 가깝지 않을 때
   *   바로 해제: 다음 장 무대가 가까워졌고(그 장이 자기 기기 iframe 을 만든다) 3D 무대는 화면에 없을 때(T.releaseOnNext 뒤)
   *   늦게 해제: 3D 장 근처를 벗어나 releaseAfter 가 지났을 때
   * 아래 장의 iframe 과 겹쳐 오래 남지 않게 한다(통합 검수 RT-04) */
  const RELEASE_RETRY = 1500;
  const life = { near: false, visible: false, dayNear: false };
  function updateLife() {
    if (st.phase === 'failed') return;
    const want = life.visible || (life.near && !life.dayNear);
    if (want) {
      clearTimeout(releaseTimer);
      releaseTimer = 0;
      ensureDevices();
      return;
    }
    if (st.dev === 'none' && !devJob) return;
    const wait = life.dayNear ? T.releaseOnNext : releaseAfter;
    const at = performance.now() + wait;
    if (releaseTimer && releaseAt <= at) return;   // 이미 더 이른 해제가 잡혀 있으면 그대로
    clearTimeout(releaseTimer);
    releaseAt = at;
    releaseTimer = setTimeout(releaseDevices, wait);
  }

  const nearIo = new IntersectionObserver(entries => {
    for (const e of entries) life.near = e.isIntersecting;
    updateLife();
  }, { rootMargin: '100% 0px 100% 0px', threshold: 0 });
  nearIo.observe(el.stage);
  const visIo = new IntersectionObserver(entries => {
    for (const e of entries) life.visible = e.isIntersecting;
    updateLife();
  }, { threshold: 0 });
  visIo.observe(el.stage);
  // 다음 장(#try 모바일 체험) 무대. partial 이 들어오기 전에는 섹션 자체를 본다(예전 구성이면 하루 이야기 무대)
  const dayIo = new IntersectionObserver(entries => {
    for (const e of entries) life.dayNear = e.isIntersecting;
    updateLife();
  }, { rootMargin: '100% 0px 100% 0px', threshold: 0 });
  let dayWatched = null;
  function watchDay() {
    const d = document.querySelector('#try [data-try-stage], #try .try-stage') || document.getElementById('try')
      || document.querySelector('#day [data-story-scrolly], #day [data-story-stage]');
    if (!d || d === dayWatched) return;
    if (dayWatched) dayIo.unobserve(dayWatched);
    dayWatched = d;
    dayIo.observe(d);
  }
  watchDay();
  window.addEventListener('next:module-ready', watchDay);

  /* ---------- 준비(장면) ---------- */
  setStep(0);
  st.phase = 'idle';
  if (st.dev !== 'ready') showLoading();
  S.requestRender();
  probeVoices();
  warmUp().catch(err => console.warn('[xp] 미리 올리기 생략', err));

  /* 검수용 훅(?xpdebug=1) */
  if (debug) {
    window.__xp = { S, H, DR, DRIVE, STOP, showArrival, get D() { return D; }, st, T, ensureDevices, releaseDevices, voiceMs, realMs, hitTest, tapKeys, phoneKey, phonePos, phoneQuat, phoneLowPos, phoneLowQuat, thumb: () => thumb, setHand, COLLIDERS, skip, replay, centerFrame,
      pauseAt: [], paused: null, resume: () => { const r = pauseResolve; pauseResolve = null; r?.(); },
      phonePenetration: () => H.phonePenetration(),
      play: () => el.play.click(), target: () => st.awaiting, project: p => S.project(p),
      /* 대기 중인 대상(index 번째)의 가운데를 페이지 좌표로 */
      targetPoint(index = 0) {
        const a = st.awaiting;
        if (!a) return null;
        const h = targetHandle(a.device);
        const elx = h.doc.querySelectorAll(a.selector)[index];
        const r = elx && h.rectOf(elx);
        if (!r) return null;
        const uv = D.pxToUV(a.device, r.x + r.w / 2, r.y + r.h / 2);
        let w;
        if (a.device === 'phone') { const f = S.dynamicFrame(D.phoneItem); w = f.O.clone().addScaledVector(f.A, uv.u).addScaledVector(f.B, uv.v); }
        else w = S.uvToWorld('center', uv.u, uv.v);
        const p = S.project(w);
        const cr = S.renderer.domElement.getBoundingClientRect();
        return { x: cr.left + p.x, y: cr.top + p.y };
      } };
  }
}
