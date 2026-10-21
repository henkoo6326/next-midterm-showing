/* 오른팔(위팔·아래팔·손·재킷 소매) + 일반형 폰
 *
 * 자산: assets/models/arm_r.glb (MakeHuman CC0 + MPFB, scripts/hands/ 로 다시 만듦), assets/models/phone.glb (자체 제작)
 * 원리
 * - 손가락 포즈: GLB 클립(relaxed/grip/thumb_tap/index_point)의 본 회전에서 관절별 굽힘 축을 읽고, 각도를 장면에 맞춰 다시 푼다.
 * - 쥐기: 폰을 손바닥 앞에 두고, 손가락을 한 관절씩 굽히다가 폰 상자에 닿기 직전에 멈춘다(관통 없음). 손바닥이 폰을 뚫으면 폰을 밀어낸다.
 * - 엄지 탭: 엄지 관절 4개 각도를 좌표 하강으로 풀어 엄지 끝을 알림 위치에 닿게 한다(화면 위 1mm).
 * - 검지 탭: 목표점(화면 위 버튼)과 화면 법선으로 손 회전을 정하고, 손 전체 정점 중 화면에 가장 가까운 점이 정확히 3mm 앞이 되도록 법선 방향으로 맞춘다.
 * - 팔: 손목 위치·손 회전·아래팔 방향·위팔 방향으로 본을 직접 놓는다(손목은 굽힘만, 비틀림 없음). 어깨는 늘 화면 밖에 둔다.
 * 좌표는 three 월드(m). */

import * as THREE from 'three';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Y_AXIS = V(0, 1, 0);
const D2R = Math.PI / 180;

const FINGERS = ['index', 'middle', 'ring', 'pinky'];
const fb = (f, i) => `${f}_0${i}_r`;
const THUMB = ['thumb_01_r', 'thumb_02_r', 'thumb_03_r'];

/* 손가락 굽힘 각도(도). 클립과 같은 축, 같은 부호 */
export const POSES = {
  relaxed: { index: [10, 16, 8], middle: [14, 20, 10], ring: [18, 22, 10], pinky: [22, 24, 10], thumb: [6, 0, 10, 6] },
  point: { index: [4, 6, 3], middle: [80, 95, 55], ring: [84, 96, 55], pinky: [86, 94, 50], thumb: [26, -6, 42, 28] },
  fist: { index: [70, 90, 50], middle: [78, 92, 55], ring: [82, 94, 55], pinky: [85, 92, 50], thumb: [26, -6, 42, 28] },
};
/* 엄지 각도: [thumb_01 굽힘(X), thumb_01 벌림(Z), thumb_02 굽힘, thumb_03 굽힘] */

/* 손가락 관절 한계(도) */
const LIMIT = { j1: [-5, 90], j2: [0, 105], j3: [0, 80] };
/* 쥐기 자세(손 로컬): f=폰 오른쪽 뒷모서리의 손가락 방향 위치, n=손바닥 위 높이, roll/yaw=기울기(도), slide=새끼 쪽 이동.
   scripts/hands/README.md 의 탐색(엄지 오차·관통·손끝 접촉 점수)으로 정했다: 엄지 오차 1mm, 관통 0, 네 손끝과 폰 표면 거리 1~3mm */
const GRIP_POSE = { f: 0.065, n: 0.002, roll: 45, yaw: 20, slide: 0.03 };
const GRIP_MCP_MAX = 80;            // 쥐기에서 첫 관절 최대 굽힘
const THUMB_LIMIT = [[-30, 95], [-60, 110], [-10, 85], [-10, 85]];
const THUMB_SAMPLES = 200;

export async function createHands(S, { armPath = 'assets/models/arm_r.glb', phonePath = 'assets/models/phone.glb' } = {}) {
  const [armG, phoneG] = await Promise.all([S.loadGLB(armPath), S.loadGLB(phonePath)]);
  const root = armG.scene;
  root.name = 'ARM_ROOT';
  S.scene.add(root);
  root.updateMatrixWorld(true);

  const boneMap = new Map();
  root.traverse(o => { if (o.isBone) boneMap.set(o.name, o); });
  const bone = name => {
    const b = boneMap.get(name);
    if (!b) throw new Error(`hands: 본 ${name} 없음`);
    return b;
  };
  const upper = bone('upperarm_r'), lower = bone('lowerarm_r'), hand = bone('hand_r');
  const restQ = new Map();
  root.traverse(o => { if (o.isBone) restQ.set(o.name, o.quaternion.clone()); });
  const L_UPPER = lower.position.length();
  const L_FORE = hand.position.length();

  const meshes = [];
  root.traverse(o => {
    if (o.isSkinnedMesh) {
      o.frustumCulled = false;
      o.castShadow = false;
      o.receiveShadow = false;
      meshes.push(o);
      const m = o.material;
      if (/body/i.test(m.name)) {
        // 피부: 차량 실내의 무채색 톤과 맞추기 위해 반사를 낮춘다(텍스처 채도는 빌드 단계에서 낮춤)
        m.roughness = 0.6;
        m.metalness = 0;
        m.envMapIntensity = 0.6;
        o.name = 'ARM_SKIN';
      } else {
        m.roughness = 0.9;
        m.metalness = 0;
        m.envMapIntensity = 0.5;
        o.name = 'ARM_SLEEVE';
      }
      m.side = THREE.FrontSide;
    }
  });
  const skin = meshes.find(m => m.name === 'ARM_SKIN');

  /* 클립에서 관절별 굽힘 축 */
  const clipQ = {};
  for (const clip of armG.animations) {
    clipQ[clip.name] = {};
    for (const track of clip.tracks) {
      const [name, prop] = track.name.split('.');
      if (prop !== 'quaternion') continue;
      const v = track.values;
      clipQ[clip.name][name] = new THREE.Quaternion(v[0], v[1], v[2], v[3]);
    }
  }
  function axisFrom(clipName, boneName, fallback) {
    const q = clipQ[clipName]?.[boneName];
    const r = restQ.get(boneName);
    if (!q || !r) return fallback.clone();
    const d = r.clone().invert().multiply(q);
    const s = Math.sqrt(1 - Math.min(1, d.w * d.w));
    if (s < 1e-4) return fallback.clone();
    const ax = V(d.x / s, d.y / s, d.z / s);
    if (d.w < 0) ax.negate();
    return ax.normalize();
  }
  const AXIS = {};
  for (const f of FINGERS) {
    for (let i = 1; i <= 3; i++) {
      AXIS[fb(f, i)] = axisFrom(f === 'index' ? 'grip' : 'index_point', fb(f, i), V(1, 0, 0));
    }
  }
  AXIS.thumb_01_r = axisFrom('thumb_tap', 'thumb_01_r', V(1, 0, 0));
  AXIS.thumb_01_r_spread = V(0, 0, 1).sub(AXIS.thumb_01_r.clone().multiplyScalar(AXIS.thumb_01_r.z)).normalize();
  AXIS.thumb_02_r = axisFrom('thumb_tap', 'thumb_02_r', V(0, 0, -1));
  AXIS.thumb_03_r = axisFrom('thumb_tap', 'thumb_03_r', V(0, 0, -1));

  const tmpQ = new THREE.Quaternion();
  function setBoneAngle(name, axis, deg) {
    const b = bones[name];
    b.quaternion.copy(restQ.get(name)).multiply(tmpQ.setFromAxisAngle(axis, deg * D2R));
  }
  const bones = {};
  for (const f of FINGERS) for (let i = 1; i <= 3; i++) bones[fb(f, i)] = bone(fb(f, i));
  for (const n of THUMB) bones[n] = bone(n);

  /* 손가락 포즈 적용. spec = { index:[a,b,c], ..., thumb:[x,z,b,c] } */
  function applyFingers(spec) {
    for (const f of FINGERS) {
      const a = spec[f];
      for (let i = 1; i <= 3; i++) setBoneAngle(fb(f, i), AXIS[fb(f, i)], a[i - 1]);
    }
    const t = spec.thumb;
    const b1 = bones.thumb_01_r;
    b1.quaternion.copy(restQ.get('thumb_01_r'))
      .multiply(tmpQ.setFromAxisAngle(AXIS.thumb_01_r_spread, t[1] * D2R))
      .multiply(new THREE.Quaternion().setFromAxisAngle(AXIS.thumb_01_r, t[0] * D2R));
    setBoneAngle('thumb_02_r', AXIS.thumb_02_r, t[2]);
    setBoneAngle('thumb_03_r', AXIS.thumb_03_r, t[3]);
  }
  const cloneSpec = s => ({ index: [...s.index], middle: [...s.middle], ring: [...s.ring], pinky: [...s.pinky], thumb: [...s.thumb] });
  function lerpSpec(a, b, t) {
    const o = {};
    for (const k of [...FINGERS, 'thumb']) o[k] = a[k].map((v, i) => v + (b[k][i] - v) * t);
    return o;
  }

  /* 정점 분류(지배 본) */
  const skinIdx = skin.geometry.attributes.skinIndex;
  const skinW = skin.geometry.attributes.skinWeight;
  const boneNameOf = i => skin.skeleton.bones[i].name;
  const byBone = new Map();
  for (let v = 0; v < skinIdx.count; v++) {
    let best = -1, bw = -1;
    for (let k = 0; k < 4; k++) {
      const w = skinW.getComponent(v, k);
      if (w > bw) { bw = w; best = skinIdx.getComponent(v, k); }
    }
    const name = boneNameOf(best);
    if (!byBone.has(name)) byBone.set(name, []);
    byBone.get(name).push(v);
  }
  const vertexBone = [];
  for (const [name, ids] of byBone) for (const v of ids) vertexBone[v] = name;
  const vertsOf = names => names.flatMap(n => byBone.get(n) || []);
  const HAND_SET = vertsOf(['hand_r', ...THUMB, ...FINGERS.flatMap(f => [1, 2, 3].map(i => fb(f, i)))]);
  // 계산을 가볍게: 서브디비전 메시는 정점이 많으므로 균등 추출
  const thin = (arr, max) => arr.length <= max ? arr : arr.filter((_, i) => i % Math.ceil(arr.length / max) === 0);

  const _v = V();
  function skinnedWorld(index, out = V()) {
    skin.getVertexPosition(index, out);
    return out.applyMatrix4(skin.matrixWorld);
  }

  // 어깨 근처 정점은 쇄골·몸통 본에도 웨이트가 걸려 있다. 몸통 본(뿌리)을 어깨 피벗과 함께 옮겨야 늘어난 띠가 생기지 않는다
  const upperRestHead = upper.getWorldPosition(V());
  /* 팔을 붙일 어깨 피벗: 위팔 본을 장면 직속으로 옮긴다(스키닝은 본의 월드 행렬만 쓴다) */
  const pivot = new THREE.Object3D();
  pivot.name = 'ARM_SHOULDER';
  S.scene.add(pivot);

  /* ---------- 손 좌표계(손 본 로컬) ---------- */
  applyFingers(POSES.relaxed);
  // 손을 원점·기본 회전에 두고(쥐기 계산을 손 로컬에서 하기 위해) 위팔을 피벗에 붙인다
  pivot.attach(upper);
  upper.position.set(0, 0, 0);
  pivot.position.set(0, 0, 0);
  pivot.updateMatrixWorld(true);
  root.updateMatrixWorld(true);

  const handInv = () => hand.matrixWorld.clone().invert();
  function toHandLocal(worldPoint) { return worldPoint.clone().applyMatrix4(handInv()); }
  const headLocal = name => toHandLocal(bone(name).getWorldPosition(V()));

  // 손가락을 편 상태에서 손 축을 잰다
  applyFingers({ index: [0, 0, 0], middle: [0, 0, 0], ring: [0, 0, 0], pinky: [0, 0, 0], thumb: [0, 0, 0, 0] });
  root.updateMatrixWorld(true); pivot.updateMatrixWorld(true);
  const hIndex = headLocal('index_01_r'), hMiddle = headLocal('middle_01_r'), hPinky = headLocal('pinky_01_r');
  const fAx = hMiddle.clone().normalize();                                  // 손가락 방향
  let aAx = hPinky.clone().sub(hIndex).normalize();                          // 검지 → 새끼
  const nAx = new THREE.Vector3().crossVectors(fAx, aAx).normalize();       // 손바닥이 향하는 쪽
  aAx = new THREE.Vector3().crossVectors(nAx, fAx).normalize();
  const pipF = FINGERS.map(f => headLocal(fb(f, 2)).dot(fAx));
  const pipFMean = pipF.reduce((s, v) => s + v, 0) / pipF.length;
  const pinkyA = Math.max(...FINGERS.map(f => headLocal(fb(f, 1)).dot(aAx)));
  const indexA = Math.min(...FINGERS.map(f => headLocal(fb(f, 1)).dot(aAx)));
  // 손바닥 면 높이(n): 손 본 정점 중 손가락 뿌리 앞쪽 손바닥 영역
  const palmN = (() => {
    const list = [];
    for (const v of byBone.get('hand_r') || []) {
      const p = toHandLocal(skinnedWorld(v, _v));
      const fc = p.dot(fAx);
      if (fc > 0.025 && fc < pipFMean - 0.03) list.push(p.dot(nAx));
    }
    list.sort((x, y) => x - y);
    return list[Math.floor(list.length * 0.96)] ?? 0.02;
  })();

  /* 검지 끝(손 로컬, index_point 포즈) */
  function tipLocalOf(boneName) {
    const ids = byBone.get(boneName) || [];
    const b = bone(boneName);
    const inv = b.matrixWorld.clone().invert();
    let best = null, bestY = -Infinity;
    for (const v of ids) {
      const p = skinnedWorld(v, V()).applyMatrix4(inv);
      if (p.y > bestY) { bestY = p.y; best = p; }
    }
    return best; // 마지막 마디 본 로컬
  }
  const indexTipBoneLocal = tipLocalOf('index_03_r');
  const thumbTipBoneLocal = tipLocalOf('thumb_03_r');

  /* ---------- 폰 ---------- */
  const phoneRoot = new THREE.Object3D();
  phoneRoot.name = 'PHONE_ROOT';
  const phoneModel = phoneG.scene;
  let phoneScreen = null;
  phoneModel.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = false;
    o.receiveShadow = false;
    if (o.name === 'SCREEN') phoneScreen = o;
    const m = o.material;
    if (m && /FRAME/.test(m.name)) { m.metalness = 0.6; m.roughness = 0.35; m.color.setRGB(0.36, 0.37, 0.38); }
  });
  if (!phoneScreen) throw new Error('hands: 폰 SCREEN 메시 없음');
  phoneModel.updateMatrixWorld(true);
  // 화면 평면(폰 모델 로컬)으로 폰 좌표계: x=화면 오른쪽, y=화면 위, z=화면 법선(보는 쪽)
  const screenFit = (() => {
    const g = phoneScreen.geometry;
    const pos = g.attributes.position, uv = g.attributes.uv;
    let s1 = 0, su = 0, sv = 0, suu = 0, suv = 0, svv = 0; const rx = [0, 0, 0], ry = [0, 0, 0], rz = [0, 0, 0];
    const p = V();
    for (let i = 0; i < pos.count; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      p.fromBufferAttribute(pos, i).applyMatrix4(phoneScreen.matrixWorld); // phoneModel 로컬(=월드, 아직 장면 밖)
      s1 += 1; su += u; sv += v; suu += u * u; suv += u * v; svv += v * v;
      const b = [1, u, v];
      for (let k = 0; k < 3; k++) { rx[k] += b[k] * p.x; ry[k] += b[k] * p.y; rz[k] += b[k] * p.z; }
    }
    const M = new THREE.Matrix3().set(s1, su, sv, su, suu, suv, sv, suv, svv).invert();
    const sol = r => V(...r).applyMatrix3(M);
    const cx = sol(rx), cy = sol(ry), cz = sol(rz);
    return { O: V(cx.x, cy.x, cz.x), A: V(cx.y, cy.y, cz.y), B: V(cx.z, cy.z, cz.z) };
  })();
  const scrW = screenFit.A.length(), scrH = screenFit.B.length();
  const ex = screenFit.A.clone().normalize();
  const ey = screenFit.B.clone().normalize().negate();
  const ez = new THREE.Vector3().crossVectors(ex, ey).normalize();
  const bodyBox = new THREE.Box3().setFromObject(phoneModel);
  // 폰 모델 → 폰 좌표계 변환
  const basis = new THREE.Matrix4().makeBasis(ex, ey, ez);
  const bodyCenter = bodyBox.getCenter(V());
  const toPhone = basis.clone().invert().multiply(new THREE.Matrix4().makeTranslation(-bodyCenter.x, -bodyCenter.y, -bodyCenter.z));
  phoneModel.applyMatrix4(toPhone);
  phoneRoot.add(phoneModel);
  phoneModel.updateMatrixWorld(true);
  const pbox = new THREE.Box3().setFromObject(phoneModel); // 폰 좌표계 상자
  const PH = { hx: (pbox.max.x - pbox.min.x) / 2, hy: (pbox.max.y - pbox.min.y) / 2, hz: (pbox.max.z - pbox.min.z) / 2 };
  const screenZ = screenFit.O.clone().applyMatrix4(toPhone).z; // 화면 면의 z(폰 좌표계)
  const screenOrigin = screenFit.O.clone().applyMatrix4(toPhone);
  const screenA = screenFit.A.clone().transformDirection(toPhone).multiplyScalar(scrW);
  const screenB = screenFit.B.clone().transformDirection(toPhone).multiplyScalar(scrH);
  /* 화면 UV → 폰 좌표계 점 */
  const phoneScreenPoint = (u, v) => screenOrigin.clone().addScaledVector(screenA, u).addScaledVector(screenB, v);

  /* ---------- 쥐기 풀기 (손 로컬) ---------- */
  hand.add(phoneRoot);
  const phoneInHand = new THREE.Matrix4();
  function setPhoneInHand(center, rotBasis) {
    phoneInHand.copy(rotBasis).setPosition(center);
    phoneRoot.matrixAutoUpdate = false;
    phoneRoot.matrix.copy(phoneInHand);
    phoneRoot.matrixWorldNeedsUpdate = true;
  }
  // 폰 축: x(화면 오른쪽) = -f, y(화면 위) = -a, z(화면) = n
  const phoneRot = new THREE.Matrix4().makeBasis(fAx.clone().negate(), aAx.clone().negate(), nAx.clone());
  const margin = 0.0012;
  function phoneLocalOfVertex(v, inv) { return skinnedWorld(v, V()).applyMatrix4(inv); }
  function penetrates(ids, inv, m = margin) {
    for (const v of ids) {
      const p = phoneLocalOfVertex(v, inv);
      if (Math.abs(p.x) < PH.hx + m && Math.abs(p.y) < PH.hy + m && Math.abs(p.z) < PH.hz + m) return true;
    }
    return false;
  }
  const fingerSets = {};
  for (const f of FINGERS) {
    // 관절 1 은 첫 마디만, 관절 2·3 은 그 마디부터 끝까지 검사
    fingerSets[f] = [
      thin(vertsOf([fb(f, 1)]), 200),
      thin(vertsOf([fb(f, 2), fb(f, 3)]), 260),
      thin(vertsOf([fb(f, 3)]), 200),
    ];
  }
  const handBody = thin(vertsOf(['hand_r']), 3000);
  const thumbSet = thin(vertsOf(THUMB), 300);
  const thumbCostSet = thin(vertsOf(['thumb_02_r', 'thumb_03_r']), 90);

  function phoneInv() {
    root.updateMatrixWorld(true);
    pivot.updateMatrixWorld(true);
    phoneRoot.updateMatrixWorld(true);
    return phoneRoot.matrixWorld.clone().invert();
  }

  /* 폰 자세(손 로컬): 폰 오른쪽 뒷모서리를 손바닥 엄지두덩 쪽(f=gp.f, n=palmN+gp.n)에 얹고, 긴 축을 기준으로 gp.roll 만큼 기울인다
     (오른쪽 모서리는 손바닥 쪽으로, 왼쪽 모서리는 손가락 쪽으로 올라가 손가락이 감싼다) */
  function solveGrip(gp = GRIP_POSE) {
    const spec = { index: [0, 0, 0], middle: [0, 0, 0], ring: [0, 0, 0], pinky: [0, 0, 0], thumb: [18, 8, 14, 10] };
    applyFingers(spec);
    const roll = new THREE.Matrix4().makeRotationY(gp.roll * D2R);
    const yaw = new THREE.Matrix4().makeRotationZ((gp.yaw || 0) * D2R);
    const rot = phoneRot.clone().multiply(yaw).multiply(roll);
    const cA = pinkyA + 0.012 - PH.hy + gp.slide;
    let nOff = palmN + gp.n;
    const center = () => {
      const edge = fAx.clone().multiplyScalar(gp.f).addScaledVector(aAx, cA).addScaledVector(nAx, nOff);
      return edge.add(new THREE.Vector3(-PH.hx, 0, PH.hz).applyMatrix4(rot));
    };
    setPhoneInHand(center(), rot);
    for (let k = 0; k < 60 && penetrates(handBody, phoneInv()); k++) {
      nOff += 0.0008;
      setPhoneInHand(center(), rot);
    }
    // 손가락: 세 관절을 함께 굽히다가 어느 마디가 폰에 닿으면 그 마디까지의 관절을 멈추고 나머지를 계속 굽힌다(쥐기 시뮬레이션)
    const lims = [[0, GRIP_MCP_MAX], LIMIT.j2, LIMIT.j3];
    const ratio = [0.7, 1.0, 0.8];
    for (const f of FINGERS) {
      const segs = [thin(vertsOf([fb(f, 1)]), 160), thin(vertsOf([fb(f, 2)]), 160), thin(vertsOf([fb(f, 3)]), 160)];
      const ang = [0, 0, 0];
      const frozen = [false, false, false];
      for (let it = 0; it < 200 && frozen.some(x => !x); it++) {
        const prev = [...ang];
        for (let j = 0; j < 3; j++) if (!frozen[j]) ang[j] = Math.min(lims[j][1], ang[j] + 1.5 * ratio[j]);
        spec[f] = [...ang];
        applyFingers(spec);
        const inv = phoneInv();
        let hit = -1;
        for (let k = 0; k < 3; k++) if (penetrates(segs[k], inv, 0.0008)) { hit = k; break; }
        if (hit >= 0) {
          for (let j = 0; j < 3; j++) ang[j] = prev[j];
          for (let j = 0; j <= hit; j++) frozen[j] = true;
        }
        for (let j = 0; j < 3; j++) if (ang[j] >= lims[j][1]) frozen[j] = true;
      }
      spec[f] = ang.map(v => Math.round(v * 10) / 10);
      applyFingers(spec);
    }
    return { spec, center: center(), cN: nOff };
  }

  /* 엄지 끝을 폰 화면 점(폰 좌표계)에 가져가기: [x,z,b,c] 좌표 하강. clearance 는 화면 위 높이(m) */
  const thumbTipWorld = () => thumbTipBoneLocal.clone().applyMatrix4(bones.thumb_03_r.matrixWorld);
  function solveThumb(baseSpec, targetPhone, clearance) {
    const spec = cloneSpec(baseSpec);
    const target = targetPhone.clone(); target.z = screenZ + clearance;
    const cost = () => {
      applyFingers(spec);
      hand.updateMatrixWorld(true);
      const inv = phoneRoot.matrixWorld.clone().invert();
      const tip = thumbTipWorld().applyMatrix4(inv);
      // 엄지가 폰 몸체를 뚫으면 벌점(깊이 제곱)
      let pen = 0;
      for (const v of thumbCostSet) {
        const p = phoneLocalOfVertex(v, inv);
        const dx = PH.hx + 0.001 - Math.abs(p.x), dy = PH.hy + 0.001 - Math.abs(p.y), dz = PH.hz + 0.001 - Math.abs(p.z);
        if (dx > 0 && dy > 0 && dz > 0) { const d = Math.min(dx, dy, dz); pen += d * d; }
      }
      // 관절 각이 클수록 약한 벌점(자연스러운 쪽을 고른다)
      const t = spec.thumb;
      const comfort = (t[0] * t[0] + t[1] * t[1] + t[2] * t[2] + t[3] * t[3]) * 1e-9;
      return tip.distanceToSquared(target) + pen * 40 + comfort;
    };
    // 전역 탐색(결정적 의사난수) 뒤 좌표 하강. 시작점에 따라 엄지가 폰을 뚫는 국소해에 빠지는 것을 막는다
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const start = [...spec.thumb];
    const cands = [[cost(), [...start]]];
    for (let i = 0; i < THUMB_SAMPLES; i++) {
      spec.thumb = THUMB_LIMIT.map(([lo, hi]) => lo + rnd() * (hi - lo));
      cands.push([cost(), [...spec.thumb]]);
    }
    cands.sort((x, y) => x[0] - y[0]);
    let best = Infinity, bestT = start;
    for (const [, t0] of cands.slice(0, 4)) {
      spec.thumb = [...t0];
      let c = cost();
      for (const step of [8, 4, 2, 1, 0.5, 0.25]) {
        let improved = true;
        for (let it = 0; it < 40 && improved; it++) {
          improved = false;
          for (let k = 0; k < 4; k++) {
            for (const sgn of [step, -step]) {
              const old = spec.thumb[k];
              const nv = Math.min(THUMB_LIMIT[k][1], Math.max(THUMB_LIMIT[k][0], old + sgn));
              if (nv === old) continue;
              spec.thumb[k] = nv;
              const cc = cost();
              if (cc < c - 1e-12) { c = cc; improved = true; } else spec.thumb[k] = old;
            }
          }
        }
      }
      if (c < best) { best = c; bestT = [...spec.thumb]; }
    }
    spec.thumb = bestT;
    cost();
    const tipErr = (() => { const inv = phoneRoot.matrixWorld.clone().invert(); return thumbTipWorld().applyMatrix4(inv).distanceTo(target); })();
    best = tipErr * tipErr;
    applyFingers(spec);
    // 엄지가 화면을 뚫는지 확인하고 목표를 들어 올린다
    hand.updateMatrixWorld(true);
    const inv = phoneRoot.matrixWorld.clone().invert();
    let minZ = Infinity;
    for (const v of thumbSet) {
      const p = phoneLocalOfVertex(v, inv);
      if (Math.abs(p.x) < PH.hx && Math.abs(p.y) < PH.hy) minZ = Math.min(minZ, p.z - screenZ);
    }
    return { spec, error: Math.sqrt(best), minClearance: minZ };
  }
  function solveThumbClear(baseSpec, targetPhone, clearance) {
    let r = solveThumb(baseSpec, targetPhone, clearance);
    let c = clearance;
    for (let k = 0; k < 4 && r.minClearance < clearance - 0.0002; k++) {
      c += clearance - r.minClearance;
      r = solveThumb(baseSpec, targetPhone, c);
    }
    return r;
  }

  var api = null;
  // 쥐기는 손을 원점에 둔 상태에서 한 번 푼다
  const grip = solveGrip();
  const gripRestThumbTarget = phoneScreenPoint(0.6, 0.48);
  const gripThumb = solveThumbClear(grip.spec, gripRestThumbTarget, 0.012);
  const GRIP = gripThumb.spec;

  /* ---------- 팔 배치 ---------- */
  const qRestHandLocal = restQ.get('hand_r');
  const qRestLowerLocal = restQ.get('lowerarm_r');
  const _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion(), _qs = new THREE.Quaternion();
  const _y = V();

  /* 두 마디 역기구학: 어깨 S, 손목 W, 팔꿈치가 향할 쪽 pole → fore/upper 방향.
     닿지 않는 거리면 어깨를 손목 쪽으로 당긴다(몸을 기울이는 것과 같음, 어깨는 늘 화면 밖) */
  function solveArm(S0, W, pole) {
    const S = S0.clone();
    const reach = (L_UPPER + L_FORE) * 0.985;
    let d = W.clone().sub(S);
    if (d.length() > reach) { S.copy(W).addScaledVector(d.normalize(), -reach); d = W.clone().sub(S); }
    const dist = Math.max(1e-4, d.length());
    const dirSW = d.clone().divideScalar(dist);
    const cosA = THREE.MathUtils.clamp((L_UPPER * L_UPPER + dist * dist - L_FORE * L_FORE) / (2 * L_UPPER * dist), -1, 1);
    const along = L_UPPER * cosA;
    const h = Math.sqrt(Math.max(0, L_UPPER * L_UPPER - along * along));
    const side = pole.clone().sub(dirSW.clone().multiplyScalar(pole.dot(dirSW)));
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
    side.normalize();
    const E = S.clone().addScaledVector(dirSW, along).addScaledVector(side, h);
    return { shoulder: S, elbow: E, upper: E.clone().sub(S).normalize(), fore: W.clone().sub(E).normalize() };
  }

  /* key: { pos(손 원점 월드), quat(손 월드), shoulder, pole 또는 fore/upper, fingers(spec) } */
  /* 손 회전에서 손목을 굽히지 않은 아래팔 방향(d0)을 구하고, pref 쪽으로 최대 maxBend 도까지만 꺾는다 */
  function naturalFore(quat, pref, maxBend) {
    _q0.copy(quat).multiply(_qs.copy(qRestHandLocal).invert());
    const d0 = V(0, 1, 0).applyQuaternion(_q0).normalize();
    if (!pref) return d0;
    const p = pref.clone().normalize();
    const ang = Math.acos(THREE.MathUtils.clamp(d0.dot(p), -1, 1));
    if (ang < 1e-4) return d0;
    const t = Math.min(1, (maxBend * D2R) / ang);
    const q = new THREE.Quaternion().setFromUnitVectors(d0, p);
    return d0.applyQuaternion(new THREE.Quaternion().slerp(q, t)).normalize();
  }

  function applyKey(key) {
    if (key.natural) {
      const fore = naturalFore(key.quat, key.natural.pref, key.natural.maxBend ?? 25);
      let up = key.natural.upper ? key.natural.upper.clone().normalize() : null;
      if (key.natural.shoulder) {
        // 위팔은 팔꿈치에서 (가상의) 어깨 쪽으로 향한다. 어깨는 화면 밖
        const elbow = key.pos.clone().addScaledVector(fore, -L_FORE);
        up = elbow.sub(key.natural.shoulder).normalize();
      }
      key = { ...key, fore, upper: up };
    } else if (key.shoulder) {
      const ik = solveArm(key.shoulder, key.pos, key.pole || V(0.6, -0.8, 0.2));
      key = { ...key, fore: ik.fore, upper: ik.upper };
    }
    const Qh = key.quat;
    _q0.copy(Qh).multiply(_qs.copy(qRestHandLocal).invert());
    _y.copy(Y_AXIS).applyQuaternion(_q0);
    const Ql = new THREE.Quaternion().setFromUnitVectors(_y, key.fore).multiply(_q0);
    const elbow = key.pos.clone().addScaledVector(key.fore, -L_FORE);
    _q1.copy(Ql).multiply(_qs.copy(qRestLowerLocal).invert());
    _y.copy(Y_AXIS).applyQuaternion(_q1);
    const Qu = new THREE.Quaternion().setFromUnitVectors(_y, key.upper).multiply(_q1);
    const shoulder = elbow.clone().addScaledVector(key.upper, -L_UPPER);
    pivot.position.copy(shoulder);
    pivot.quaternion.identity();
    root.position.copy(shoulder).sub(upperRestHead);
    root.updateMatrixWorld(true);
    upper.quaternion.copy(Qu);
    lower.quaternion.copy(Qu).invert().multiply(Ql);
    hand.quaternion.copy(Ql).invert().multiply(Qh);
    if (key.fingers) applyFingers(key.fingers);
    pivot.updateMatrixWorld(true);
    return { elbow, shoulder };
  }
  function lerpKey(a, b, t) {
    return {
      pos: a.pos.clone().lerp(b.pos, t),
      quat: a.quat.clone().slerp(b.quat, t),
      shoulder: a.shoulder && b.shoulder ? a.shoulder.clone().lerp(b.shoulder, t) : (b.shoulder || a.shoulder),
      pole: a.pole && b.pole ? a.pole.clone().lerp(b.pole, t).normalize() : (b.pole || a.pole),
      fore: a.fore && b.fore ? a.fore.clone().lerp(b.fore, t).normalize() : undefined,
      upper: a.upper && b.upper ? a.upper.clone().lerp(b.upper, t).normalize() : undefined,
      natural: a.natural && b.natural ? {
        pref: a.natural.pref.clone().lerp(b.natural.pref, t).normalize(),
        maxBend: a.natural.maxBend + ((b.natural.maxBend ?? 25) - (a.natural.maxBend ?? 25)) * t,
        upper: a.natural.upper && b.natural.upper ? a.natural.upper.clone().lerp(b.natural.upper, t).normalize() : (b.natural.upper || a.natural.upper),
        shoulder: a.natural.shoulder && b.natural.shoulder ? a.natural.shoulder.clone().lerp(b.natural.shoulder, t) : (b.natural.shoulder || a.natural.shoulder),
      } : (b.natural || a.natural),
      fingers: a.fingers && b.fingers ? lerpSpec(a.fingers, b.fingers, t) : (b.fingers || a.fingers),
    };
  }

  /* 기준 벡터 둘(손 로컬 u1,u2)을 월드 w1,w2 에 맞추는 회전 */
  function basisRotation(u1, u2, w1, w2) {
    const a1 = u1.clone().normalize(), a3 = new THREE.Vector3().crossVectors(u1, u2).normalize(), a2 = new THREE.Vector3().crossVectors(a3, a1);
    const b1 = w1.clone().normalize(), b3 = new THREE.Vector3().crossVectors(w1, w2).normalize(), b2 = new THREE.Vector3().crossVectors(b3, b1);
    const Ma = new THREE.Matrix4().makeBasis(a1, a2, a3);
    const Mb = new THREE.Matrix4().makeBasis(b1, b2, b3);
    return new THREE.Quaternion().setFromRotationMatrix(Mb.multiply(Ma.transpose()));
  }

  /* 손 로컬 기준점(손가락 포즈 적용 상태) */
  function localPointInHand(boneName, pointInBone) {
    hand.updateMatrixWorld(true);
    return pointInBone.clone().applyMatrix4(bone(boneName).matrixWorld).applyMatrix4(handInv());
  }

  /* ---------- 폰을 든 손 키 ---------- */
  /* phonePose: { pos(폰 중심 월드), quat(폰 월드) } → 손 월드 */
  function handFromPhone(pos, quat) {
    const P = new THREE.Matrix4().compose(pos, quat, V(1, 1, 1));
    const H = P.multiply(phoneInHand.clone().invert());
    const hp = V(), hq = new THREE.Quaternion(), hs = V();
    H.decompose(hp, hq, hs);
    return { pos: hp, quat: hq };
  }
  /* 화면이 눈을 향하는 폰 회전 */
  function phoneFacing(pos, eye, rollDeg = 0, tiltDeg = 0) {
    const z = eye.clone().sub(pos).normalize();
    const up = V(0, 1, 0);
    const x = new THREE.Vector3().crossVectors(up, z).normalize();
    const y = new THREE.Vector3().crossVectors(z, x);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    q.multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), tiltDeg * D2R));
    q.multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), rollDeg * D2R));
    return q;
  }

  /* ---------- 검지 탭 키 ---------- */
  /* target: 월드 점(화면 위), normal: 화면에서 운전자 쪽 법선, opts.dir: 검지가 가리킬 방향(화면 안쪽), opts.palm: 손바닥 방향 힌트 */
  function pointKey(target, normal, { dir, palm, clearance = 0.003, natural, screenFrame, fingers = POSES.point }) {
    applyFingers(fingers);
    root.updateMatrixWorld(true);
    pivot.updateMatrixWorld(true);
    // 손 로컬에서 검지 방향 = index_02 머리 → 검지 끝
    const tipL = localPointInHand('index_03_r', indexTipBoneLocal);
    const midL = headLocal('index_02_r');
    const fingerDirL = tipL.clone().sub(midL).normalize();
    const q = basisRotation(fingerDirL, nAx, dir, palm);
    // 끝이 목표에서 법선 방향 clearance 에 오도록
    let pos = target.clone().addScaledVector(normal, clearance).sub(tipL.clone().applyQuaternion(q));
    let key = { pos, quat: q, natural, fingers: cloneSpec(fingers) };
    // 손 정점 전체에서 화면 평면까지 최소 거리를 재서 정확히 clearance 로 맞춘다(화면 영역 안의 점만)
    for (let k = 0; k < 3; k++) {
      applyKey(key);
      root.updateMatrixWorld(true);
      let minD = Infinity;
      for (const v of HAND_SET) {
        const p = skinnedWorld(v, _v);
        const d = p.clone().sub(target).dot(normal);
        if (screenFrame) {
          const rel = p.clone().sub(screenFrame.O);
          const u = rel.dot(screenFrame.A) / screenFrame.A.lengthSq();
          const w = rel.dot(screenFrame.B) / screenFrame.B.lengthSq();
          if (u < -0.03 || u > 1.03 || w < -0.03 || w > 1.03) continue;
        }
        if (d < minD) minD = d;
      }
      const delta = clearance - minD;
      if (Math.abs(delta) < 0.00005) break;
      key.pos.addScaledVector(normal, delta);
    }
    return key;
  }

  /* 측정용: 손·팔 정점 중 화면 평면과의 최소 거리, 검지 끝 거리 */
  function measureAgainst(frame) {
    root.updateMatrixWorld(true);
    let minD = Infinity, minId = -1;
    const n = frame.normal;
    for (const v of HAND_SET) {
      const p = skinnedWorld(v, V());
      const rel = p.clone().sub(frame.O);
      const u = rel.dot(frame.A) / frame.A.lengthSq();
      const w = rel.dot(frame.B) / frame.B.lengthSq();
      if (u < 0 || u > 1 || w < 0 || w > 1) continue;
      const d = rel.dot(n);
      if (d < minD) { minD = d; minId = v; }
    }
    const tip = indexTipBoneLocal.clone().applyMatrix4(bones.index_03_r.matrixWorld);
    return { minDistance: minD, tipDistance: tip.clone().sub(frame.O).dot(n), closestBone: minId >= 0 ? boneNameOfVertex(minId) : null };
  }
  function boneNameOfVertex(v) {
    for (const [name, ids] of byBone) if (ids.includes(v)) return name;
    return null;
  }

  /* 폰 관통 검사(현재 포즈): 폰 상자 안에 들어간 손 정점 수와 최대 깊이 */
  function phonePenetration() {
    const inv = phoneInv();
    let count = 0, depth = 0;
    const bonesHit = {};
    for (const v of HAND_SET) {
      const p = phoneLocalOfVertex(v, inv);
      const dx = PH.hx - Math.abs(p.x), dy = PH.hy - Math.abs(p.y), dz = PH.hz - Math.abs(p.z);
      if (dx > 0 && dy > 0 && dz > 0) {
        count++; depth = Math.max(depth, Math.min(dx, dy, dz));
        const b = vertexBone[v]; bonesHit[b] = (bonesHit[b] || 0) + 1;
      }
    }
    return { count, depth, bones: bonesHit };
  }

  /* 팔 캡슐 표본점(충돌 AABB 검사용) */
  function armSamples() {
    root.updateMatrixWorld(true);
    const s = upper.getWorldPosition(V()), e = lower.getWorldPosition(V()), w = hand.getWorldPosition(V());
    const pts = [];
    for (let i = 0; i <= 8; i++) pts.push({ p: s.clone().lerp(e, i / 8), r: 0.05 });
    for (let i = 0; i <= 8; i++) pts.push({ p: e.clone().lerp(w, i / 8), r: 0.04 });
    for (const v of thin(HAND_SET, 400)) pts.push({ p: skinnedWorld(v, V()), r: 0 });
    return pts;
  }

  var api = {
    root, pivot, hand, meshes, phoneRoot, phoneModel, phoneScreen,
    L_UPPER, L_FORE, AXIS, POSES, GRIP, grip, gripThumb,
    phone: { half: PH, screenZ, scrW, scrH, screenPoint: phoneScreenPoint, inHand: phoneInHand },
    frame: { f: fAx, a: aAx, n: nAx, palmN, pipFMean, pinkyA, indexA },
    applyKey, lerpKey, applyFingers, lerpSpec, cloneSpec, solveArm, naturalFore,
    /* 현재 키의 팔 관절 위치(검수용) */
    jointsOf(key) { applyKey(key); root.updateMatrixWorld(true); return { shoulder: upper.getWorldPosition(V()), elbow: lower.getWorldPosition(V()), wrist: hand.getWorldPosition(V()) }; },
    wristBend(key) { const ik = solveArm(key.shoulder, key.pos, key.pole); _q0.copy(key.quat).multiply(_qs.copy(qRestHandLocal).invert()); const d0 = V(0, 1, 0).applyQuaternion(_q0); return Math.acos(THREE.MathUtils.clamp(d0.dot(ik.fore), -1, 1)) / D2R; },
    handFromPhone, phoneFacing, pointKey, basisRotation,
    debugSolve(gp, u = 0.5, v = 0.48) {
      const t0 = performance.now();
      const g = solveGrip({ ...GRIP_POSE, ...gp });
      const th = solveThumbClear(g.spec, phoneScreenPoint(u, v), 0.001);
      applyFingers(th.spec);
      // 손가락 끝이 폰 표면에 닿아 있는가(감싸기): 끝점에서 폰 상자 표면까지 거리(mm)
      const inv = phoneInv();
      const tips = FINGERS.map(f => {
        const tl = tipLocalOf(fb(f, 3));
        const p = tl.applyMatrix4(bone(fb(f, 3)).matrixWorld).applyMatrix4(inv);
        const dx = Math.max(Math.abs(p.x) - PH.hx, 0), dy = Math.max(Math.abs(p.y) - PH.hy, 0), dz = Math.max(Math.abs(p.z) - PH.hz, 0);
        return Math.round(Math.hypot(dx, dy, dz) * 1000);
      });
      return { gp, tips, grip: g.spec, nOff: g.cN, thumb: th.spec.thumb, err: th.error, clr: th.minClearance, pen: api.phonePenetration(), ms: performance.now() - t0 };
    },
    solveThumbForScreenUV(u, v, clearance = 0.001) { return solveThumbClear(GRIP, phoneScreenPoint(u, v), clearance); },
    measureAgainst, phonePenetration, armSamples,
    setVisible(v) { root.visible = v; pivot.visible = v; },
    setPhoneVisible(v) { phoneRoot.visible = v; },
    indexTipWorld() { root.updateMatrixWorld(true); return indexTipBoneLocal.clone().applyMatrix4(bones.index_03_r.matrixWorld); },
    thumbTipWorld() { root.updateMatrixWorld(true); return thumbTipWorld(); },
  };
  api.setVisible(false);
  return api;
}
