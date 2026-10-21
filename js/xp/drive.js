/* 3D 체험 S5: 첫 배송지까지의 짧은 주행 환경 (xp-road: 실사 텍스처·한국 아파트 단지)
 *
 * 카메라는 운전석에 고정하고 바깥 세계가 차량 반대 방향(+Z)으로 움직인다. 차량 앞 = -Z, 바닥 = 타이어 아래(three y -1.12).
 * 세계 좌표: +X 오른쪽(단지), -X 왼쪽(상동호수공원), -Z 북쪽(진행 방향). 정차 위치 z = DRIVE.stopZ.
 * 출발지 창밖(learner_park 배경 구)은 출구로 나가는 동안 안개색으로 밝아지며(노출 전환) 같은 색의 안개에서 주행 환경이 드러난다.
 *   haze 0 → 0.5 : 배경 구가 앞으로 지나가며(이동·왼쪽으로 조금 도는 회전) 안개색으로 바뀐다
 *   haze 0.5      : 배경 구를 숨기고 하늘·도로·단지를 켠다. 이 순간 화면 밖 세계는 모두 같은 안개색이라 바뀌는 순간이 보이지 않는다
 *   haze 0.5 → 1 : 안개가 걷힌다(가까운 곳부터)
 *
 * 재질(xp-road): Poly Haven CC0 실사 텍스처(아스팔트·보도블록·콘크리트·잔디, assets/models/drive/*.webp, 1K, 반복 타일링)를
 *   MeshStandardMaterial 의 색·노멀·러프니스 맵으로 쓴다. 타일 반복이 보이지 않게 같은 맵을 다른 축척·방향으로 한 번 더 읽어 섞고
 *   (de-tiling) 세계 좌표 저주파 잡음으로 밝기·색을 흔든다. 차선(노란 중앙 복선·흰 길가장자리선 15cm, 횡단보도·정지선)은
 *   아스팔트 셰이더 안에서 그린다(fwidth 로 먼 곳까지 계단 없이, 도색 마모 잡음, 바퀴 자국 어둡게).
 * 단지: 판상형 동(층 높이 2.8m, 15~20층). 남측 정면은 캔버스 아틀라스(4세대 × 8개 층, 유리 반사·커튼·블라인드·실외기실 루버가
 *   칸마다 다름) + 층 슬래브 띠·세대 구분 벽 돌출 + 옥상 난간·기계실. 도로 쪽 측벽에 큰 동 번호(104, 105).
 *   104동 서쪽 측벽 1층에 공동현관 캐노피(정차 위치에서 오른쪽 앞, 단지 진입로 끝)와 단지 입구 '104동' 표지.
 * 가로수: 은행나무(가로), 느티나무·소나무(단지), 활엽수(공원). 줄기·가지 + 잎 덩어리(정점 흔듦, 구형 법선, 정점색 그늘) 인스턴싱.
 * 조명: 실내와 같은 조명(Hemisphere·Directional)을 받고, 주행 재질에만 하늘 그라데이션 PMREM 을 envMap 으로 직접 넣는다
 *   (scene.environment 는 실내용이라 건드리지 않는다. ?lightmap=1 에서도 주행 세계는 같은 하늘 반사). 그림자는 그림자 맵 대신
 *   AO 느낌의 접지 그림자 데칼(나무·차·건물 밑동·생울타리)로 낸다(실내 조명·그림자 설정을 바꾸지 않기 위해).
 * 차량 모델·재질·환경 조명·카메라는 건드리지 않는다. scene.fog 는 처음부터 '꺼진 안개'(near 1e4)로 두어 실내 셰이더를 미리 맞춰 둔다
 * (주행 직전에 안개를 켜면 실내 재질 전체가 다시 컴파일돼 멈칫한다). 꺼진 안개는 실내 픽셀을 바꾸지 않는다(fogFactor 0) */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assetUrl } from './scene.js';

export const DRIVE = Object.freeze({
  distance: 72,            // 출발 → 정차 이동 거리(m). 속도 곡선은 현재 UI autoplay 와 같은 sin(최고 속도 시점이 가운데)
  ground: -1.12,           // 타이어 바닥(three y)
  turnDeg: 14,             // 출구에서 왼쪽으로 도는 만큼(배경 구 회전, 현재 UI 첫 안내 '좌회전'과 같은 방향)
  hazeColor: '#d5dade',    // 노출 전환·안개·지평선 색
  zenith: '#a5b5c9',
  hazeNear: 3.2,           // 전환 순간 안개 시작 거리(차량 앞 범퍼까지 약 2.9m 보다 멀게: 실내는 안개를 받지 않는다)
  fogNear: 28,
  fogFar: 280,
  stopZ: -72,              // 정차 위치(세계 좌표). distance 와 같다
});

const OFF = { near: 1e4, far: 2e4 };
const smooth = t => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };
const easeOut = t => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 2);
const FLOOR = 2.8;          // 층 높이(m)
const TEX = 'assets/models/drive/';

/* 결정적 난수(다시 체험해도 같은 배치) */
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

const FONT = '"Wanted Sans", "Apple SD Gothic Neo", sans-serif';

/* ---------- 캔버스 ---------- */
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function canvasTex(c, { srgb = true, repeat = false, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
  return t;
}
const gray = v => `rgb(${v},${v},${v})`;
function speckle(g, w, h, n, rand, light, dark, size = 2) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = rand() < 0.5 ? light : dark;
    g.fillRect(rand() * w, rand() * h, size * (0.5 + rand()), size * (0.5 + rand()));
  }
}

/* 남측 정면 아틀라스: 1024×1024 = 4세대(한 세대 폭 10m = 256px) × 8개 층(2.8m = 128px). 색 + 러프니스(유리 0.07, 벽 0.86).
   칸마다 거실 큰 창(투명 난간) + 침실 창 + 실외기실 루버. 유리 안쪽(커튼·블라인드·어두움)과 하늘 반사 밝기를 칸마다 다르게 */
function facadeAtlas(rand) {
  const W = 1024, H = 1024, UW = 256, FH = 128;
  const X = m => m * UW / 10, Y = m => m * FH / FLOOR;
  const cm = makeCanvas(W, H), cr = makeCanvas(W, H);
  const g = cm.getContext('2d'), q = cr.getContext('2d');
  const both = (x, y, w, h, col, r) => { g.fillStyle = col; g.fillRect(x, y, w, h); q.fillStyle = gray(r); q.fillRect(x, y, w, h); };
  both(0, 0, W, H, '#e8e6e0', 222);
  speckle(g, W, H, 9000, rand, 'rgba(255,255,255,0.18)', 'rgba(120,110,100,0.07)', 2);
  for (let f = 0; f < 8; f++) {
    for (let u = 0; u < 4; u++) {
      const x0 = u * UW, yb = H - f * FH;            // 칸 왼쪽, 층 바닥(캔버스 y)
      const yOf = m => yb - Y(m);
      // 층 슬래브 띠(바닥 0.22m) + 그 아래 얇은 그늘
      both(x0, yOf(0.22), UW, Y(0.22), '#f3f2ee', 205);
      g.fillStyle = 'rgba(70,70,70,0.10)'; g.fillRect(x0, yOf(0.22) - 3, UW, 3);
      // 창 두 개
      const wins = [
        { x: 0.6, w: 5.4, y: 0.3, h: 2.15, panes: 4, rail: true },
        { x: 6.55, w: 2.85, y: 0.95, h: 1.45, panes: 2, rail: false },
      ];
      for (const wdw of wins) {
        const wx = x0 + X(wdw.x), ww = X(wdw.w), wy = yOf(wdw.y + wdw.h), wh = Y(wdw.h);
        // 유리: 위가 밝은 하늘 반사 그라데이션
        const b = 0.82 + rand() * 0.3;
        const grd = g.createLinearGradient(0, wy, 0, wy + wh);
        const c1 = [118, 134, 152].map(v => Math.round(v * b)), c2 = [58, 68, 80].map(v => Math.round(v * b));
        grd.addColorStop(0, `rgb(${c1})`); grd.addColorStop(1, `rgb(${c2})`);
        g.fillStyle = grd; g.fillRect(wx, wy, ww, wh);
        q.fillStyle = gray(18); q.fillRect(wx, wy, ww, wh);
        // 안쪽
        const k = rand();
        if (k < 0.34) {                       // 커튼(한쪽 또는 양쪽으로 걷힘)
          const tone = ['rgba(236,230,218,0.86)', 'rgba(222,214,200,0.82)', 'rgba(205,198,186,0.8)', 'rgba(240,238,232,0.9)'][Math.floor(rand() * 4)];
          const cover = 0.2 + rand() * 0.55;
          g.fillStyle = tone;
          if (rand() < 0.5) g.fillRect(wx, wy + 2, ww * cover, wh - 4);
          else { g.fillRect(wx, wy + 2, ww * cover / 2, wh - 4); g.fillRect(wx + ww * (1 - cover / 2), wy + 2, ww * cover / 2, wh - 4); }
          g.fillStyle = 'rgba(120,110,100,0.12)';
          for (let i = 0; i < 9; i++) g.fillRect(wx + rand() * ww, wy + 2, 1.5, wh - 4);
        } else if (k < 0.52) {                // 블라인드(위쪽 일부)
          const hh = wh * (0.25 + rand() * 0.5);
          g.fillStyle = 'rgba(214,210,200,0.85)'; g.fillRect(wx, wy, ww, hh);
          g.fillStyle = 'rgba(150,146,138,0.35)';
          for (let yy = wy + 3; yy < wy + hh; yy += 4) g.fillRect(wx, yy, ww, 1);
        } else if (k < 0.72) {                // 안쪽이 어두움(빈 방·짙은 가구)
          g.fillStyle = 'rgba(25,30,36,0.35)'; g.fillRect(wx, wy + wh * 0.35, ww, wh * 0.65);
        } else {                              // 하늘 반사가 강함
          g.fillStyle = 'rgba(200,214,228,0.22)'; g.fillRect(wx, wy, ww, wh * 0.6);
        }
        // 빛 반사 사선
        g.save(); g.beginPath(); g.rect(wx, wy, ww, wh); g.clip();
        g.fillStyle = 'rgba(255,255,255,0.07)';
        const sx = wx + rand() * ww;
        g.beginPath(); g.moveTo(sx, wy); g.lineTo(sx + ww * 0.25, wy); g.lineTo(sx - ww * 0.1, wy + wh); g.lineTo(sx - ww * 0.35, wy + wh); g.fill();
        g.restore();
        // 창틀(샷시)
        g.strokeStyle = '#d4d6d6'; g.lineWidth = 3; g.strokeRect(wx + 1.5, wy + 1.5, ww - 3, wh - 3);
        q.strokeStyle = gray(115); q.lineWidth = 3; q.strokeRect(wx + 1.5, wy + 1.5, ww - 3, wh - 3);
        for (let p = 1; p < wdw.panes; p++) {
          const px = wx + ww * p / wdw.panes;
          both(px - 1.5, wy, 3, wh, '#cfd2d3', 115);
        }
        if (wdw.rail) {                       // 투명 난간(유리 + 손스침)
          const ry = yOf(wdw.y + 0.95);
          g.fillStyle = 'rgba(190,206,216,0.20)'; g.fillRect(wx, ry, ww, yOf(wdw.y) - ry);
          both(wx, ry - 2, ww, 3, '#8e979d', 90);
          for (let p = 0; p <= 6; p++) both(wx + ww * p / 6 - 1, ry, 2, yOf(wdw.y) - ry, '#a3abb0', 90);
        }
      }
      // 실외기실 루버(침실 창 아래)
      const lx = x0 + X(6.55), lw = X(2.85), ly = yOf(0.85), lh = Y(0.55);
      both(lx, ly, lw, lh, '#c9ccce', 150);
      g.fillStyle = 'rgba(80,86,92,0.55)';
      for (let yy = ly + 2; yy < ly + lh; yy += 4) g.fillRect(lx, yy, lw, 1.5);
      // 세대 사이 벽 미세 얼룩(빗물 자국)
      g.fillStyle = 'rgba(110,105,95,0.05)';
      g.fillRect(x0 + X(9.5) + rand() * 6, yOf(2.6), 3, Y(2.4));
    }
  }
  return { map: canvasTex(cm, { repeat: true }), rough: canvasTex(cr, { repeat: true, srgb: false }) };
}

/* 1층: 화강석 붙임 + 창(아래 반투명 필름). 1024×128 = 4세대 × 1개 층 */
function groundFloorTex(rand) {
  const W = 1024, H = 128, X = m => m * 25.6, Y = m => m * H / FLOOR;
  const c = makeCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#cfc8bb'; g.fillRect(0, 0, W, H);
  speckle(g, W, H, 5000, rand, 'rgba(255,255,255,0.25)', 'rgba(70,60,50,0.12)', 1.5);
  g.fillStyle = 'rgba(90,82,72,0.35)';
  for (let x = 0; x < W; x += X(1.2)) g.fillRect(x, 0, 1.5, H);
  for (let y = 0; y < H; y += Y(0.6)) g.fillRect(0, y, W, 1.5);
  for (let u = 0; u < 4; u++) {
    for (const [mx, mw] of [[0.9, 4.6], [6.6, 2.8]]) {
      const x = u * 256 + X(mx), w = X(mw), y = H - Y(2.35), h = Y(1.45);
      const grd = g.createLinearGradient(0, y, 0, y + h);
      grd.addColorStop(0, '#76879a'); grd.addColorStop(1, '#465462');
      g.fillStyle = grd; g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(225,228,230,0.55)'; g.fillRect(x, y + h * 0.55, w, h * 0.45);
      g.strokeStyle = '#d8dada'; g.lineWidth = 3; g.strokeRect(x, y, w, h);
      g.fillRect(x + w / 2 - 1, y, 2, h);
    }
  }
  g.fillStyle = '#efeee9'; g.fillRect(0, 0, W, Y(0.22));
  return canvasTex(c, { repeat: true });
}

/* 측벽(도로 쪽). 폭 12m. 라벨이 있으면 한 장(전체 높이), 없으면 한 층짜리 반복 타일 */
function gableTexture(label, floors) {
  const Hm = floors * FLOOR, Wm = 12;
  const pw = 320, ppm = pw / Wm;
  const ph = label ? Math.round(Hm * ppm) : Math.round(FLOOR * ppm);
  const c = makeCanvas(pw, ph), g = c.getContext('2d');
  const rand = rng(label ? Number(label) : 7);
  const yUp = m => ph - m * ppm;          // 바닥에서 m 위(캔버스 y)
  g.fillStyle = '#ecebe5'; g.fillRect(0, 0, pw, ph);
  speckle(g, pw, ph, Math.round(pw * ph / 40), rand, 'rgba(255,255,255,0.2)', 'rgba(110,100,90,0.06)', 1.5);
  // 세로 강조 띠(연한 청회색) + 가는 선
  g.fillStyle = '#c3cdd6'; g.fillRect(1.0 * ppm, 0, 2.2 * ppm, ph);
  g.fillStyle = '#9fb0bf'; g.fillRect(3.45 * ppm, 0, 0.18 * ppm, ph);
  // 모서리 쪽 작은 창(남측 끝 세대 방, u=1 쪽이 남측)
  const nF = label ? floors : 1;
  for (let f = 0; f < nF; f++) {
    if (label && f === 0) continue;
    const y = yUp(f * FLOOR + 2.3), h = 1.2 * ppm, x = 9.3 * ppm, w = 1.3 * ppm;
    const grd = g.createLinearGradient(0, y, 0, y + h); grd.addColorStop(0, '#7d8ea0'); grd.addColorStop(1, '#4a5765');
    g.fillStyle = grd; g.fillRect(x, y, w, h);
    g.strokeStyle = '#d6d8d8'; g.lineWidth = 2; g.strokeRect(x, y, w, h);
    g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(x, y + h, w, 2);
  }
  if (label) {
    // 1층 화강석
    g.fillStyle = '#cbc3b5'; g.fillRect(0, yUp(3.0), pw, 3.0 * ppm);
    g.fillStyle = 'rgba(90,82,72,0.35)';
    for (let x = 0; x < pw; x += 1.2 * ppm) g.fillRect(x, yUp(3.0), 1, 3.0 * ppm);
    for (let m = 0; m < 3.0; m += 0.6) g.fillRect(0, yUp(m), pw, 1);
    // 옥상 아래 강조 띠
    g.fillStyle = '#c3cdd6'; g.fillRect(0, 0, pw, 1.6 * ppm);
    // 동 번호: 글자 높이 4.6m, 옥상에서 6m 아래가 가운데
    g.fillStyle = '#3a4550';
    g.font = `600 ${Math.round(4.6 * ppm * 1.36)}px ${FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, 6.6 * ppm, yUp(Hm - 6.0));
  }
  const t = canvasTex(c, { repeat: !label });
  return t;
}

/* 단지 입구 동 표지: 2.0m × 2.4m 앞면. '104'와 '동'을 한 묶음으로 가운데 정렬 */
function signTexture(num) {
  const c = makeCanvas(320, 384), g = c.getContext('2d'), w = 320, h = 384;
  g.fillStyle = '#f3f2ee'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#39424b'; g.fillRect(0, 0, w, 40);
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  const big = `600 112px ${FONT}`, small = `600 50px ${FONT}`;
  g.font = big; const wn = g.measureText(num).width;
  g.font = small; const wd = g.measureText('동').width;
  const gap = 8, x0 = (w - (wn + gap + wd)) / 2;
  g.fillStyle = '#39424b';
  g.font = big; g.fillText(num, x0, 214);
  g.font = small; g.fillText('동', x0 + wn + gap, 212);
  g.fillStyle = '#c9c6bd'; g.fillRect(32, 250, w - 64, 3);
  return canvasTex(c);
}

/* 공동현관 캐노피 앞 명판: '104동' (1.8m × 0.32m) */
function plateTexture(num) {
  const c = makeCanvas(512, 96), g = c.getContext('2d');
  g.fillStyle = '#3a434c'; g.fillRect(0, 0, 512, 96);
  g.fillStyle = '#f2f1ec'; g.font = `600 58px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(`${num}동`, 256, 50);
  return canvasTex(c);
}

/* 정차 위치 앞 낮은 동 표지석 앞면: 1.1m × 0.40m. 위 '104동', 아래 '서쪽 공동현관'과 앞쪽(진행 방향) 화살표 */
function stoneTexture(num) {
  const w = 520, h = 184, c = makeCanvas(w, h), g = c.getContext('2d');
  g.fillStyle = '#3a434c'; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(0, 0, w, 6);
  g.fillStyle = '#f2f1ec'; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  const big = `600 92px ${FONT}`, mid = `600 44px ${FONT}`, small = `600 30px ${FONT}`;
  g.font = big; const wn = g.measureText(num).width;
  g.font = mid; const wd = g.measureText('동').width;
  const gap = 6, x0 = (w - (wn + gap + wd)) / 2;
  g.font = big; g.fillText(num, x0, 100);
  g.font = mid; g.fillText('동', x0 + wn + gap, 98);
  g.fillStyle = 'rgba(242,241,236,0.35)'; g.fillRect(40, 118, w - 80, 2);
  g.fillStyle = '#d9dcdf'; g.font = small;
  const label = '서쪽 공동현관', wl = g.measureText(label).width, ax = 22, lx = (w - (wl + 12 + ax)) / 2;
  g.fillText(label, lx, 160);
  const cx = lx + wl + 12 + ax / 2;                // 위쪽 화살표(앞으로)
  g.beginPath(); g.moveTo(cx, 132); g.lineTo(cx + 11, 145); g.lineTo(cx + 4, 145); g.lineTo(cx + 4, 162); g.lineTo(cx - 4, 162); g.lineTo(cx - 4, 145); g.lineTo(cx - 11, 145); g.closePath(); g.fill();
  return canvasTex(c);
}

/* 잎·나무껍질 아틀라스(회색조, 색은 정점색): u 0..0.74 잎, 0.78..1 껍질 */
function foliageAtlas(rand, leavesOnly = false) {
  const S = 256, c = makeCanvas(S, S), g = c.getContext('2d');
  const LW = leavesOnly ? S : 190;
  g.fillStyle = gray(170); g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const v = 110 + Math.floor(rand() * 145);
    g.fillStyle = gray(v);
    g.beginPath();
    g.ellipse(rand() * LW, rand() * S, 2 + rand() * 4, 1.2 + rand() * 2, rand() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 220; i++) { g.fillStyle = 'rgba(30,30,30,0.35)'; g.fillRect(rand() * LW, rand() * S, 2 + rand() * 3, 2 + rand() * 3); }
  if (leavesOnly) return canvasTex(c, { repeat: true, aniso: 4 });
  g.fillStyle = gray(150); g.fillRect(196, 0, 60, S);
  for (let i = 0; i < 160; i++) { g.fillStyle = gray(90 + Math.floor(rand() * 110)); g.fillRect(196 + rand() * 60, rand() * S, 1 + rand() * 2, 6 + rand() * 24); }
  return canvasTex(c, { repeat: true, aniso: 4 });
}

/* 접지 그림자(알파: 흰색=불투명) */
function blobTexture() {
  const c = makeCanvas(64, 64), g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, '#fff'); grd.addColorStop(0.45, '#bbb'); grd.addColorStop(1, '#000');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return canvasTex(c, { srgb: false, aniso: 1 });
}
function stripTexture() {
  const c = makeCanvas(64, 4), g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 64, 0);
  grd.addColorStop(0, '#fff'); grd.addColorStop(0.35, '#888'); grd.addColorStop(1, '#000');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 4);
  const t = canvasTex(c, { srgb: false, aniso: 1 });
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
/* 투시형 펜스(2m 한 칸): 세로살 12.5cm 간격 + 위아래 띠 + 기둥 */
function fenceTexture() {
  const c = makeCanvas(128, 64), g = c.getContext('2d');
  g.clearRect(0, 0, 128, 64);
  g.fillStyle = '#fff';
  for (let x = 2; x < 128; x += 8) g.fillRect(x, 4, 2, 58);
  g.fillRect(0, 6, 128, 3); g.fillRect(0, 54, 128, 3);
  g.fillRect(0, 0, 5, 64);
  const t = canvasTex(c, { srgb: false, repeat: true, aniso: 4 });
  return t;
}

/* ---------- 셰이더 패치 ---------- */
const GLSL_NOISE = `
varying vec3 vXp;
float xpPaint = 0.0;
float xpTrack = 0.0;
float xpHash(vec2 p){ p = mod(p, 289.0); vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float xpNoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(xpHash(i), xpHash(i + vec2(1.0, 0.0)), u.x), mix(xpHash(i + vec2(0.0, 1.0)), xpHash(i + vec2(1.0, 1.0)), u.x), u.y); }
float xpLine(float x, float c, float w){ float d = abs(x - c); float fw = fwidth(x) * 0.8 + 1e-4; return 1.0 - smoothstep(w * 0.5 - fw, w * 0.5 + fw, d); }
float xpBand(float x, float a, float b){ float fw = fwidth(x) * 0.8 + 1e-4; return smoothstep(a - fw, a + fw, x) * (1.0 - smoothstep(b - fw, b + fw, x)); }
`;
const f3 = v => `vec3(${v.map(n => n.toFixed(4)).join(', ')})`;
const lin = hex => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

/* 바닥 재질 공통: 같은 맵을 다른 축척·방향으로 한 번 더 읽어 섞기(de-tiling) + 저주파 밝기·색 흔들기. road 면 차선·바퀴 자국 */
function patchSurface(mat, key, o) {
  const { tile = 2, detile = 0.45, macro = 0.12, tintA = [1, 1, 1], tintB = [1, 1, 1], tintScale = 0.035, road = null } = o;
  mat.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vXp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvXp = position;');
    let frag = `
      #ifdef USE_MAP
      {
        vec2 q2 = vec2(vXp.z, -vXp.x) / ${(tile * 1.37).toFixed(3)} + vec2(0.31, 0.17);
        vec3 s2 = texture2D(map, q2).rgb;
        diffuseColor.rgb = diffuse * mix(sampledDiffuseColor.rgb, s2, ${detile.toFixed(3)});
      }
      #endif
      {
        float mn = xpNoise(vXp.xz * 0.11) * 0.55 + xpNoise(vXp.xz * 0.027 + 7.0) * 0.45;
        diffuseColor.rgb *= mix(${(1 - macro).toFixed(3)}, ${(1 + macro).toFixed(3)}, mn);
        diffuseColor.rgb *= mix(${f3(tintA)}, ${f3(tintB)}, smoothstep(0.25, 0.75, xpNoise(vXp.xz * ${tintScale.toFixed(4)} + 3.1)));
      }`;
    if (road) frag += `
      {
        float x = vXp.x, z = vXp.z;
        // 바퀴 자국(차로 가운데 ±0.8m), 연석 쪽 때
        float tr = 0.0;
        tr += exp(-pow((abs(x - ${road.laneR.toFixed(3)}) - 0.82) / 0.32, 2.0));
        tr += exp(-pow((abs(x - ${road.laneL.toFixed(3)}) - 0.82) / 0.32, 2.0));
        xpTrack = tr;
        diffuseColor.rgb *= 1.0 - 0.11 * tr;
        float gut = smoothstep(0.45, 0.0, abs(x - ${road.edgeR.toFixed(3)})) + smoothstep(0.45, 0.0, abs(x - ${road.edgeL.toFixed(3)}));
        diffuseColor.rgb *= 1.0 - 0.16 * gut;
        // 차선(도색 마모)
        float onRoad = step(${road.edgeL.toFixed(3)}, x) * step(x, ${road.edgeR.toFixed(3)});
        float cwA = ${road.cross0.toFixed(2)}, cwB = ${road.cross1.toFixed(2)};
        float outsideCross = 1.0 - xpBand(z, cwA - 2.6, cwB + 2.6);
        float yel = (xpLine(x, ${road.yel0.toFixed(3)}, 0.15) + xpLine(x, ${road.yel1.toFixed(3)}, 0.15)) * outsideCross;
        float wht = xpLine(x, ${road.whtR.toFixed(3)}, 0.15) + xpLine(x, ${road.whtL.toFixed(3)}, 0.15);
        // 횡단보도(막대 0.5m, 간격 0.5m, 길이 4m)와 정지선(0.45m)
        float bars = step(fract((x - ${road.edgeL.toFixed(3)} - 0.2) / 1.0), 0.5);
        float cw = xpBand(z, cwA, cwB) * bars * xpBand(x, ${(road.edgeL + 0.2).toFixed(2)}, ${(road.edgeR - 0.25).toFixed(2)});
        float stopR = xpBand(z, cwB + 2.0, cwB + 2.45) * xpBand(x, ${road.yel1.toFixed(3)} + 0.1, ${road.whtR.toFixed(3)});
        float stopL = xpBand(z, cwA - 2.45, cwA - 2.0) * xpBand(x, ${road.whtL.toFixed(3)}, ${road.yel0.toFixed(3)} - 0.1);
        wht = clamp(wht + cw + stopR + stopL, 0.0, 1.0) * onRoad;
        float wear = xpNoise(vec2(x * 7.0, z * 1.3)) * 0.6 + xpNoise(vec2(x * 23.0, z * 9.0)) * 0.4;
        float keep = mix(0.6, 1.0, smoothstep(0.12, 0.5, wear));
        float tyre = 1.0 - 0.35 * clamp(tr, 0.0, 1.0);
        yel *= keep * 0.95; wht *= keep * tyre;
        diffuseColor.rgb = mix(diffuseColor.rgb, ${f3(road.yellow)}, yel);
        diffuseColor.rgb = mix(diffuseColor.rgb, ${f3(road.white)}, wht);
        xpPaint = max(yel, wht);
      }`;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_NOISE)
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + frag)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor * (1.0 - 0.2 * clamp(xpTrack, 0.0, 1.0)), 0.55, xpPaint);`);
  };
  mat.customProgramCacheKey = () => 'xp-road-' + key;
  return mat;
}

/* ---------- 지오메트리 도우미 ---------- */
/* 법선이 큰 축으로 UV(미터) 투영 */
function uvMeters(g) {
  const p = g.attributes.position, n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = -p.getZ(i); }
    else if (ax >= az) { u = p.getZ(i); v = p.getY(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u; uv[i * 2 + 1] = v;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
const boxAt = (x0, x1, y0, y1, z0, z1) => new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
const floorAt = (x0, x1, z0, z1, y) => new THREE.PlaneGeometry(Math.abs(x1 - x0), Math.abs(z1 - z0)).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, y, (z0 + z1) / 2);
function setColor(g, c) {
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function clean(g, keepColor) {
  const out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'uv', ...(keepColor ? ['color'] : [])].includes(k)) out.deleteAttribute(k);
  if (!out.attributes.uv) out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  return out;
}

/* 잎 덩어리: 정이십면체(세분 1)를 방향 해시로 흔들고, 법선은 수관 중심 쪽 구형 법선과 섞는다. 정점색 = 색 × 그늘 */
function crownBlob(r, c, sy, crownC, color, rand, detail = 1) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  const col = new Float32Array(p.count * 3);
  const seed = rand() * 100;
  const v = new THREE.Vector3(), w = new THREE.Vector3(), s = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const h = Math.sin(v.x * 12.9 + seed) * Math.cos(v.y * 7.3 - seed) * Math.sin(v.z * 9.7 + seed * 0.5);
    const k = 1 + 0.2 * h;
    w.set(v.x * r * k, v.y * r * k * sy, v.z * r * k).add(c);
    p.setXYZ(i, w.x, w.y, w.z);
    s.copy(w).sub(crownC).normalize().lerp(v, 0.35).normalize();
    n.setXYZ(i, s.x, s.y, s.z);
    uv.setXY(i, uv.getX(i) * 0.72, uv.getY(i));
    // 그늘: 아래·안쪽 어둡게
    const up = THREE.MathUtils.clamp((w.y - (crownC.y - r * 1.2)) / (r * 2.6), 0, 1);
    const ao = 0.5 + 0.5 * up;
    col[i * 3] = color[0] * ao; col[i * 3 + 1] = color[1] * ao; col[i * 3 + 2] = color[2] * ao;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
function limb(a, b, r0, r1, color, seg = 6) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, true).translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate(a.x, a.y, a.z);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.79 + uv.getX(i) * 0.2, uv.getY(i) * len * 0.4);
  return setColor(g, color);
}
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const mul = (c, k) => c.map(x => x * k);

/* 나무 종류(로컬, 바닥 원점). 잎 정점색은 아틀라스 평균(약 0.6)을 고려해 밝게 */
function treeGeometry(kind, crownHex, rand) {
  const crown = mul(lin(crownHex), 1.6);
  const bark = mul(lin(kind === 'pine' ? '#7d5a48' : '#5f5246'), 1.6);
  const parts = [];
  if (kind === 'ginkgo') {           // 은행나무: 곧은 줄기, 좁은 달걀꼴
    const C = V3(0, 5.2, 0);
    parts.push(limb(V3(0, 0, 0), V3(0, 7.2, 0), 0.15, 0.06, bark, 7));
    parts.push(limb(V3(0, 3.0, 0), V3(0.9, 4.6, 0.3), 0.07, 0.03, bark, 5));
    for (const [x, y, z, r] of [[0, 3.8, 0, 1.55], [0.15, 5.1, 0.1, 1.45], [-0.1, 6.3, 0, 1.1], [0.75, 4.4, -0.35, 1.0], [-0.7, 4.7, 0.45, 0.95]]) parts.push(crownBlob(r, V3(x, y, z), 1.05, C, crown, rand));
  } else if (kind === 'zelkova') {   // 느티나무: 갈라지는 가지, 넓은 우산꼴
    const C = V3(0, 5.4, 0);
    parts.push(limb(V3(0, 0, 0), V3(0, 2.8, 0), 0.22, 0.16, bark, 7));
    for (const [x, z] of [[1.3, 0.3], [-1.0, 0.9], [-0.3, -1.3]]) parts.push(limb(V3(0, 2.6, 0), V3(x, 4.8, z), 0.12, 0.05, bark, 5));
    parts.push(crownBlob(2.0, V3(0, 5.7, 0), 0.78, C, crown, rand));
    for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2 + 0.4; parts.push(crownBlob(1.55, V3(Math.cos(a) * 1.8, 5.0, Math.sin(a) * 1.8), 0.8, C, crown, rand)); }
  } else if (kind === 'pine') {      // 소나무: 휜 붉은 줄기, 납작한 잎 층
    const C = V3(0.6, 4.3, 0);
    parts.push(limb(V3(0, 0, 0), V3(0.35, 2.4, 0.1), 0.17, 0.13, bark, 6));
    parts.push(limb(V3(0.35, 2.4, 0.1), V3(0.9, 5.0, -0.1), 0.13, 0.06, bark, 6));
    for (const [x, y, z, r] of [[-0.2, 3.3, 0.4, 1.5], [1.1, 4.0, -0.5, 1.4], [0.4, 4.8, 0.3, 1.25], [1.0, 5.5, 0, 0.95]]) parts.push(crownBlob(r, V3(x, y, z), 0.42, C, crown, rand));
  } else {                           // 공원 활엽수
    const C = V3(0, 4.4, 0);
    parts.push(limb(V3(0, 0, 0), V3(0, 3.6, 0), 0.19, 0.12, bark, 6));
    for (const [x, y, z, r] of [[0, 4.6, 0, 2.1], [1.2, 3.9, 0.4, 1.5], [-1.1, 4.0, -0.5, 1.6], [0.2, 5.8, 0.1, 1.35]]) parts.push(crownBlob(r, V3(x, y, z), 0.9, C, crown, rand));
  }
  return mergeGeometries(parts.map(g => clean(g, true)));
}

/* 승용차(로컬: 앞 = -Z, 길이 4.6, 폭 1.82, 높이 약 1.5). 정점색으로 차체색·유리·타이어·등을 굽는다 */
function carGeometry(bodyHex) {
  const body = lin(bodyHex), glass = lin('#46525e'), trim = lin('#25282b'), tyre = lin('#151617'), head = lin('#d9dde0'), tail = lin('#8a1d1d');
  const parts = [];
  parts.push(setColor(boxAt(-0.91, 0.91, 0.34, 0.95, -2.3, 2.3), body));
  parts.push(setColor(boxAt(-0.93, 0.93, 0.3, 0.5, -2.33, 2.33), trim));
  const cab = boxAt(-0.8, 0.8, 0.95, 1.45, -1.05, 1.4);
  const cp = cab.attributes.position;
  for (let i = 0; i < cp.count; i++) {
    if (cp.getY(i) > 1.2) { cp.setX(i, cp.getX(i) * 0.84); cp.setZ(i, cp.getZ(i) < 0 ? cp.getZ(i) + 0.55 : cp.getZ(i) - 0.3); }
  }
  cab.computeVertexNormals();
  parts.push(setColor(cab, glass));
  parts.push(setColor(boxAt(-0.66, 0.66, 1.45, 1.49, -0.45, 1.05), body));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const w = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 12).rotateZ(Math.PI / 2).translate(sx * 0.8, 0.33, sz * 1.42);
      parts.push(setColor(w, tyre));
    }
    parts.push(setColor(boxAt(sx * 0.45, sx * 0.82, 0.74, 0.86, -2.33, -2.29), head));
    parts.push(setColor(boxAt(sx * 0.5, sx * 0.84, 0.76, 0.9, 2.29, 2.33), tail));
  }
  return mergeGeometries(parts.map(g => clean(g, true)));
}

/* 가로등(로컬: 기둥 원점, 팔 = -X 쪽으로 도로 위) */
function lampGeometry() {
  const metal = lin('#7d8388'), headC = lin('#5d6267'), lens = lin('#e9ece8');
  const parts = [];
  parts.push(setColor(new THREE.CylinderGeometry(0.075, 0.12, 9.0, 8, 1, true).translate(0, 4.5, 0), metal));
  const arm = new THREE.CylinderGeometry(0.05, 0.06, 2.3, 6, 1, true).rotateZ(Math.PI / 2 - 0.12).translate(-1.12, 9.0 + 0.13, 0);
  parts.push(setColor(arm, metal));
  parts.push(setColor(boxAt(-2.55, -1.95, 9.2, 9.32, -0.17, 0.17), headC));
  parts.push(setColor(boxAt(-2.5, -2.0, 9.17, 9.2, -0.14, 0.14), lens));
  parts.push(setColor(boxAt(-0.13, 0.13, 0, 0.3, -0.13, 0.13), metal));
  return mergeGeometries(parts.map(g => clean(g, true)));
}

/* 생울타리: 둥근 모서리 단면을 z 로 뽑는다(한 구간 = 단면 변 수 × 2 삼각형) */
function hedgeGeometry(xa, xb, z0, z1, y0, h) {
  const w = xb - xa, r = Math.min(0.28, w / 2, h / 2);
  const pts = [[xa, y0]];
  const corner = (cx, cy, a0, a1) => { for (let i = 0; i <= 3; i++) { const a = a0 + (a1 - a0) * i / 3; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  corner(xa + r, y0 + h - r, Math.PI, Math.PI / 2);
  corner(xb - r, y0 + h - r, Math.PI / 2, 0);
  pts.push([xb, y0]);
  const pos = [], nrm = [], uv = [];
  let arc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    const nx = (by - ay) / len, ny = -(bx - ax) / len;   // 바깥쪽
    const N = [-nx, -ny, 0];
    const a0 = arc, a1 = arc + len; arc = a1;
    const quad = [[ax, ay, z0, a0, z0], [bx, by, z0, a1, z0], [bx, by, z1, a1, z1], [ax, ay, z1, a0, z1]];
    for (const k of [0, 2, 1, 0, 3, 2]) {
      const [x, y, z, u, v] = quad[k];
      pos.push(x, y, z); nrm.push(...N); uv.push(u / 1.3, v / 1.3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  // 법선은 감김 방향으로 다시 구한다(재질이 DoubleSide 라 보는 쪽으로 뒤집힌다)
  g.computeVertexNormals();
  return g;
}

/* ---------- 텍스처 파일(비동기, 자리 표시 → 받은 뒤 교체: 셰이더는 그대로) ---------- */
function placeholder(rgb) {
  const c = makeCanvas(2, 2), g = c.getContext('2d');
  g.fillStyle = `rgb(${rgb})`; g.fillRect(0, 0, 2, 2);
  return c;
}
function fileTexture(file, { srgb, tile, aniso, neutral }) {
  const t = new THREE.Texture(placeholder(neutral));
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / tile, 1 / tile);
  t.anisotropy = aniso;
  t.needsUpdate = true;
  const url = assetUrl(TEX + file);
  const ready = new Promise(resolve => {
    const done = img => {
      const r = new THREE.Texture(img);
      r.colorSpace = t.colorSpace; r.wrapS = r.wrapT = THREE.RepeatWrapping; r.repeat.copy(t.repeat); r.anisotropy = aniso;
      r.flipY = !(typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap);
      r.needsUpdate = true;
      resolve(r);
    };
    const viaImage = () => new THREE.ImageLoader().load(url, done, undefined, () => resolve(null));
    if (typeof createImageBitmap !== 'function') { viaImage(); return; }
    const l = new THREE.ImageBitmapLoader();
    l.setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none' });
    l.load(url, done, undefined, viaImage);
  });
  return { tex: t, ready, file };
}

/* ---------- 장면 ---------- */
export async function createDrive(S, { envYawDeg = 0 } = {}) {
  const scene = S.scene;
  const eye = S.eyeDefault.clone();
  const hazeColor = new THREE.Color(DRIVE.hazeColor);
  const aniso = Math.min(8, S.renderer.capabilities.getMaxAnisotropy());
  const rand = rng(104);

  // 글꼴이 있으면 표지·번호에 쓴다(없으면 시스템 고딕)
  try { await Promise.race([document.fonts.load(`600 100px "Wanted Sans"`), new Promise(r => setTimeout(r, 1500))]); } catch { /* noop */ }

  /* 꺼진 안개(실내 셰이더를 처음부터 안개 포함으로 컴파일) */
  const fog = new THREE.Fog(hazeColor.clone(), OFF.near, OFF.far);
  scene.fog = fog;

  /* 배경 구(출발지) 전환 값: scene.js 의 창밖 재질에 걸린 uHaze / uHazeColor */
  const env = S.envMesh;
  const envBase = { pos: env.position.clone(), yaw: THREE.MathUtils.degToRad(envYawDeg) };
  S.envUniforms.uHazeColor.value.copy(hazeColor);

  /* 하늘(주행 환경). 출력 공간(sRGB) 값 그대로 그린다 */
  const toSRGB = c => { const v = new THREE.Color(c); const o = { r: 0, g: 0, b: 0 }; v.getRGB(o, THREE.SRGBColorSpace); return new THREE.Vector3(o.r, o.g, o.b); };
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { uHorizon: { value: toSRGB(DRIVE.hazeColor) }, uZenith: { value: toSRGB(DRIVE.zenith) }, uHaze: { value: 1 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uHorizon; uniform vec3 uZenith; uniform float uHaze; varying vec3 vDir;
      void main(){ float h = clamp(vDir.y, 0.0, 1.0); vec3 c = mix(uHorizon, uZenith, pow(h, 0.55));
        gl_FragColor = vec4(mix(c, uHorizon, uHaze), 1.0); }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), skyMat);
  sky.position.copy(eye);
  sky.renderOrder = -9;
  sky.frustumCulled = false;
  sky.name = 'DRIVE_SKY';
  sky.visible = false;
  scene.add(sky);

  /* 주행 재질 전용 반사 환경: 하늘 그라데이션 + 땅(선형 값) → PMREM. 실내 scene.environment 와 따로 */
  const skyEnv = (() => {
    const s = new THREE.Scene();
    const m = new THREE.ShaderMaterial({
      uniforms: { uH: { value: new THREE.Vector3(...lin(DRIVE.hazeColor)) }, uZ: { value: new THREE.Vector3(...lin(DRIVE.zenith)) }, uG: { value: new THREE.Vector3(...lin('#6f746a')) } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uH; uniform vec3 uZ; uniform vec3 uG; varying vec3 vDir;
        void main(){ float y = vDir.y; vec3 c = y > 0.0 ? mix(uH, uZ, pow(clamp(y, 0.0, 1.0), 0.55)) : mix(uH * 0.85, uG, smoothstep(0.0, 0.18, -y));
          gl_FragColor = vec4(c, 1.0); }`,
      side: THREE.BackSide, depthWrite: false,
    });
    s.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), m));
    const pm = new THREE.PMREMGenerator(S.renderer);
    const rt = pm.fromScene(s, 0, 0.1, 200);
    pm.dispose(); m.dispose();
    return rt.texture;
  })();

  /* 세계(바닥 y=0) */
  const world = new THREE.Group();
  world.name = 'DRIVE_WORLD';
  world.position.y = DRIVE.ground;
  world.visible = false;
  scene.add(world);

  const mats = [];
  const std = (o) => { const m = new THREE.MeshStandardMaterial({ envMap: skyEnv, envMapIntensity: 0.6, metalness: 0, ...o }); mats.push(m); return m; };

  /* 파일 텍스처(Poly Haven CC0, 1K WebP). 받기 전에는 같은 평균색 자리 표시 */
  const files = [];
  const ft = (file, o) => { const f = fileTexture(file, { aniso, ...o }); files.push(f); return f; };
  const T_ = {
    asphaltD: ft('asphalt_diff.webp', { srgb: true, tile: 3.6, neutral: '90,90,85' }),
    asphaltN: ft('asphalt_nor.webp', { srgb: false, tile: 3.6, neutral: '128,128,255' }),
    asphaltR: ft('asphalt_rough.webp', { srgb: false, tile: 3.6, neutral: '196,196,196' }),
    paversD: ft('pavers_diff.webp', { srgb: true, tile: 1.8, neutral: '136,130,122' }),
    paversN: ft('pavers_nor.webp', { srgb: false, tile: 1.8, neutral: '128,128,255' }),
    paversR: ft('pavers_rough.webp', { srgb: false, tile: 1.8, neutral: '185,185,185' }),
    concD: ft('concrete_diff.webp', { srgb: true, tile: 2.0, neutral: '155,152,146' }),
    concN: ft('concrete_nor.webp', { srgb: false, tile: 2.0, neutral: '128,128,255' }),
    grassD: ft('grass_diff.webp', { srgb: true, tile: 2.2, neutral: '151,131,89' }),
    grassN: ft('grass_nor.webp', { srgb: false, tile: 2.2, neutral: '128,128,226' }),
  };

  /* 도로 단면(x): 차로 x -5.6 ~ 2.0, 오른쪽 차로 가운데 = 차량 x 0 */
  const ROAD = { edgeL: -5.6, edgeR: 2.0, yel0: -1.95, yel1: -1.67, whtR: 1.72, whtL: -5.42, laneR: 0.0, laneL: -3.55,
    cross0: -160.5, cross1: -156.5, yellow: lin('#e6ad2e'), white: lin('#e3e2dc') };
  const matRoad = patchSurface(std({ map: T_.asphaltD.tex, normalMap: T_.asphaltN.tex, roughnessMap: T_.asphaltR.tex, color: '#d8d8d8', roughness: 1, envMapIntensity: 0.55 }),
    'asphalt', { tile: 3.6, detile: 0.45, macro: 0.13, tintA: [1, 1, 1], tintB: [0.92, 0.93, 0.96], road: ROAD });
  const matWalk = patchSurface(std({ map: T_.paversD.tex, normalMap: T_.paversN.tex, roughnessMap: T_.paversR.tex, color: '#e2e0dc', roughness: 1, normalScale: new THREE.Vector2(0.8, 0.8) }),
    'pavers', { tile: 1.8, detile: 0.3, macro: 0.08, tintA: [1, 1, 1], tintB: [0.93, 0.91, 0.88] });
  const matConc = patchSurface(std({ map: T_.concD.tex, normalMap: T_.concN.tex, color: '#ffffff', roughness: 0.82, normalScale: new THREE.Vector2(0.6, 0.6) }),
    'concrete', { tile: 2.0, detile: 0.35, macro: 0.06 });
  const matLawn = patchSurface(std({ map: T_.grassD.tex, normalMap: T_.grassN.tex, color: '#b9c8a2', roughness: 0.95, envMapIntensity: 0.45 }),
    'lawn', { tile: 2.2, detile: 0.5, macro: 0.16, tintA: [0.86, 1.0, 0.8], tintB: [1.04, 0.95, 0.78], tintScale: 0.045 });
  const matPit = std({ color: '#4a4036', roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const matPad = patchSurface(std({ map: T_.asphaltD.tex, normalMap: T_.asphaltN.tex, roughnessMap: T_.asphaltR.tex, color: '#cfcfcf', roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    'pad', { tile: 3.6, detile: 0.45, macro: 0.1 });

  /* 정적 메시는 재질별로 모아 한 번에 합친다(드로콜 최소) */
  const buckets = new Map();
  const put = (mat, geo, color = false) => { if (!buckets.has(mat)) buckets.set(mat, []); buckets.get(mat).push(clean(geo, color)); };

  const Z0 = 12, Z1 = -560;   // 도로 길이(차 뒤 12m ~ 앞 560m, 그 너머는 안개)
  const stop = DRIVE.stopZ;
  const gate = { z0: stop - 23, z1: stop - 33 };   // 단지 진입로(104동 서쪽 공동현관으로)

  // 차도
  put(matRoad, uvMeters(floorAt(ROAD.edgeL, ROAD.edgeR, Z0, Z1, 0)));
  // 연석(화강석 느낌 콘크리트, 폭 18cm·높이 15cm). 진입로에서는 낮춘다
  const curb = (xa, xb, za, zb, top) => put(matConc, uvMeters(boxAt(xa, xb, -0.1, top, za, zb)));
  curb(2.0, 2.18, Z0, gate.z0, 0.15); curb(2.0, 2.18, gate.z0, gate.z1, 0.05); curb(2.0, 2.18, gate.z1, Z1, 0.15);
  curb(-5.78, -5.6, Z0, Z1, 0.15);
  // 보도(보도블록)
  put(matWalk, uvMeters(floorAt(2.18, 5.4, Z0, Z1, 0.13)));
  put(matWalk, uvMeters(floorAt(-8.8, -5.78, Z0, Z1, 0.13)));
  // 단지 잔디·공원 잔디·바깥 바닥
  put(matLawn, uvMeters(floorAt(6.3, 420, Z0, Z1, 0.1)));
  put(matLawn, uvMeters(floorAt(5.4, 6.3, gate.z0, gate.z1, 0.1)));
  put(matLawn, uvMeters(floorAt(-420, -9.5, Z0, Z1, 0.05)));
  put(matLawn, uvMeters(floorAt(-9.5, -8.8, Z0, Z1, 0.05)));
  // 단지 진입로·현관 앞 마당(콘크리트), 주차 패드(아스팔트)
  put(matConc, uvMeters(boxAt(5.4, 11.6, 0.0, 0.14, gate.z0, gate.z1)));
  put(matConc, uvMeters(boxAt(8.0, 14.0, 0.0, 0.15, gate.z0 + 4, gate.z1 - 6)));
  put(matPad, uvMeters(floorAt(6.6, 12.8, stop - 3, stop - 19, 0.13)));
  put(matPad, uvMeters(floorAt(6.6, 12.8, -33, -48, 0.13)));
  // 공원 산책로(콘크리트)
  put(matConc, uvMeters(floorAt(-24, -21.5, Z0, Z1, 0.08)));

  /* 생울타리(사철나무, 각지게 다듬음)·투시형 펜스 */
  const foliage = foliageAtlas(rand);
  const leaves = foliageAtlas(rand, true);
  const matHedge = std({ map: leaves, bumpMap: leaves, bumpScale: 3, color: '#6f8f5c', roughness: 0.95, side: THREE.DoubleSide, envMapIntensity: 0.4 });
  for (const [za, zb] of [[Z0, gate.z0], [gate.z1, Z1]]) put(matHedge, hedgeGeometry(5.45, 6.25, za, zb, 0.1, 0.8));
  put(matHedge, hedgeGeometry(-9.45, -8.85, Z0, Z1, 0.05, 0.7));
  const fenceTex = fenceTexture();
  const matFence = std({ color: '#525a57', alphaMap: fenceTex, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.55, metalness: 0.35, envMapIntensity: 0.8 });
  for (const [za, zb] of [[Z0, gate.z0], [gate.z1, Z1]]) {
    const len = Math.abs(zb - za);
    const g = new THREE.PlaneGeometry(len, 1.35).rotateY(Math.PI / 2).translate(6.4, 0.1 + 0.675, (za + zb) / 2);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 2.0, uv.getY(i));
    put(matFence, g);
  }

  /* ---------- 아파트(판상형) ---------- */
  const facade = facadeAtlas(rand);
  const matFacade = std({ map: facade.map, roughnessMap: facade.rough, roughness: 1, envMapIntensity: 0.95 });
  const matGround = std({ map: groundFloorTex(rand), roughness: 0.75, envMapIntensity: 0.7 });
  const matWhite = patchSurface(std({ color: '#efede7', roughness: 0.85, envMapIntensity: 0.7 }), 'white', { macro: 0.035 });
  const matGablePlain = std({ map: gableTexture(null, 1), roughness: 0.85, envMapIntensity: 0.7 });
  const matRoofBox = std({ color: '#d9d8d2', roughness: 0.9, envMapIntensity: 0.6 });
  const matGlass = std({ color: '#26313b', roughness: 0.08, metalness: 0, envMapIntensity: 1.3 });
  const matMetal = std({ color: '#8c9296', roughness: 0.45, metalness: 0.6, envMapIntensity: 0.9 });
  const gableMats = {};
  const shadows = { blob: [], strip: [] };   // 접지 그림자 { x, y, z, sx, sz, rot }
  let buildingCount = 0;

  /* side 1: 오른쪽(측벽 x = x0 가 도로 쪽, +X 로 뻗음), side -1: 왼쪽(측벽 x = -x0) */
  function building({ x0, len, zS, depth = 12, floors, label = null, side = 1 }) {
    buildingCount++;
    const H = floors * FLOOR;
    const xa = side > 0 ? x0 : -x0 - len, xb = side > 0 ? x0 + len : -x0;
    const xNear = side > 0 ? xa : xb;
    const zN = zS - depth;
    const off = Math.floor(rand() * 4) / 4, offV = Math.floor(rand() * 8) / 8;
    // 남측 정면(2층 이상)·1층
    const up = new THREE.PlaneGeometry(len, H - FLOOR).translate((xa + xb) / 2, FLOOR + (H - FLOOR) / 2, zS);
    let uv = up.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, off + uv.getX(i) * len / 40, offV + uv.getY(i) * (floors - 1) / 8);
    put(matFacade, up);
    const gf = new THREE.PlaneGeometry(len, FLOOR).translate((xa + xb) / 2, FLOOR / 2, zS);
    uv = gf.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, off + uv.getX(i) * len / 40, uv.getY(i));
    put(matGround, gf);
    // 층 슬래브 띠(돌출 0.3m)·세대 구분 벽(돌출 0.5m)
    for (let f = 1; f < floors; f++) put(matWhite, uvMeters(boxAt(xa - 0.05, xb + 0.05, f * FLOOR - 0.04, f * FLOOR + 0.18, zS, zS + 0.3)));
    const units = Math.round(len / 10);
    for (let k = 0; k <= units; k++) {
      const x = xa + (len * k) / units;
      put(matWhite, uvMeters(boxAt(x - 0.16, x + 0.16, FLOOR, H, zS, zS + 0.5)));
    }
    // 도로 쪽 측벽
    const gable = new THREE.PlaneGeometry(depth, H).rotateY(side > 0 ? -Math.PI / 2 : Math.PI / 2).translate(xNear, H / 2, (zS + zN) / 2);
    if (!label) { uv = gable.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), uv.getY(i) * floors); }
    let gm = matGablePlain;
    if (label) gm = gableMats[label] || (gableMats[label] = std({ map: gableTexture(label, floors), roughness: 0.85, envMapIntensity: 0.7 }));
    put(gm, gable);
    // 옥상 난간·기계실
    put(matWhite, uvMeters(boxAt(xa - 0.1, xb + 0.1, H, H + 1.1, zS - 0.35, zS + 0.05)));
    put(matWhite, uvMeters(boxAt(xNear - 0.05 * side, xNear + 0.35 * side, H, H + 1.1, zN, zS)));
    for (const xm of [xa + 7, xb - 13]) put(matRoofBox, uvMeters(boxAt(xm, xm + 6, H, H + 4.8, zS - 9, zS - 2.5)));
    put(matWhite, uvMeters(boxAt((xa + xb) / 2 - 4, (xa + xb) / 2 + 4, H, H + 2.6, zS - 7, zS - 3)));
    // 밑동 그늘(정면·측벽)
    shadows.strip.push({ x: (xa + xb) / 2, z: zS + 1.1, y: 0.12, len, w: 2.2, rot: -Math.PI / 2 });
    shadows.strip.push({ x: xNear - side * 1.1, z: (zS + zN) / 2, y: 0.12, len: depth, w: 2.2, rot: side > 0 ? Math.PI : 0 });
  }

  // 오른쪽 첫 줄(측벽이 도로에서 14~16m). 104동 = 첫 정차, 105동 = 다음 동
  building({ x0: 16, len: 46, zS: -16, floors: 15 });
  building({ x0: 16, len: 46, zS: -52, floors: 16 });
  building({ x0: 14, len: 50, zS: gate.z0 + 1, floors: 15, label: '104' });
  building({ x0: 16, len: 46, zS: -136, floors: 18, label: '105' });
  building({ x0: 16, len: 46, zS: -176, floors: 20 });
  building({ x0: 16, len: 46, zS: -216, floors: 17 });
  building({ x0: 16, len: 46, zS: -256, floors: 19 });
  // 오른쪽 둘째 줄(더 높음)
  for (const [zS, f] of [[-34, 20], [-74, 22], [-114, 20], [-154, 23], [-194, 21], [-234, 22], [-274, 20]]) building({ x0: 76, len: 50, zS, floors: f });
  // 공원 건너편(왼쪽 멀리, 측벽이 공원 쪽)
  for (const [zS, f] of [[-110, 22], [-160, 24], [-210, 21], [-260, 25], [-310, 22]]) building({ x0: 120, len: 48, zS, floors: f, side: -1 });

  /* 104동 서쪽 공동현관: 캐노피(2.6m 돌출)·기둥·유리문·명판, 현관 앞 마당 */
  const cz = (gate.z0 + gate.z1) / 2, gx = 14;
  put(matWhite, uvMeters(boxAt(gx - 2.6, gx, 3.0, 3.32, cz - 2.3, cz + 2.3)));
  for (const s of [-1, 1]) put(matMetal, uvMeters(boxAt(gx - 2.45, gx - 2.25, 0.15, 3.0, cz + s * 2.05 - 0.1, cz + s * 2.05 + 0.1)));
  put(matGlass, uvMeters(boxAt(gx - 0.12, gx + 0.02, 0.15, 2.65, cz - 1.3, cz + 1.3)));
  put(matMetal, uvMeters(boxAt(gx - 0.16, gx - 0.1, 0.15, 2.7, cz - 0.03, cz + 0.03)));
  put(matMetal, uvMeters(boxAt(gx - 0.16, gx - 0.1, 2.62, 2.7, cz - 1.33, cz + 1.33)));
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.32).rotateY(-Math.PI / 2), std({ map: plateTexture('104'), roughness: 0.6 }));
  plate.position.set(gx - 2.61, 3.16, cz);
  plate.matrixAutoUpdate = false; plate.updateMatrix();
  world.add(plate);

  /* 단지 입구 동 표지(정차 위치에서 오른쪽 앞, 진입로 옆): 돌 받침 + 판 */
  const signMat = std({ map: signTexture('104'), roughness: 0.7, envMapIntensity: 0.6 });
  const signSide = std({ color: '#d9d6ce', roughness: 0.8 });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.4, 0.32), [signSide, signSide, signSide, signSide, signMat, signSide]);
  sign.position.set(6.3, 0.45 + 1.2, gate.z0 + 0.5);
  sign.updateMatrix(); sign.matrixAutoUpdate = false;
  world.add(sign);
  put(matConc, uvMeters(boxAt(5.2, 7.4, 0.1, 0.45, gate.z0 + 0.15, gate.z0 + 0.85)));

  /* 정차 위치 바로 앞 오른쪽 보도 끝(생울타리 앞) 낮은 동 표지석(fix-xp-r2, 통합 검수 D2-05).
     끝 장면 카메라(T.arriveFocus 0.7)는 센터 쪽으로 내려다봐 위의 큰 표지·현관이 앞유리 위로 벗어난다. 그 시점에서 앞유리 안
     (1600×900 기준 x 약 1190~1420, y 약 100~190 CSS px, 오른쪽 위 '소리 끄기'와 겹치지 않게)에 들어오도록 정차 위치 8.5m 앞, 높이 0.6m 이하에 둔다.
     카메라·기존 배치는 그대로. 앞면은 다가오는 차 쪽으로 25° 돌려 운전석에서 읽힌다 */
  const stoneZ = stop - 8.5, stoneX = 4.25, stoneYaw = THREE.MathUtils.degToRad(-25);
  const stoneSide = std({ color: '#4a535c', roughness: 0.55, envMapIntensity: 0.7 });
  const stoneFace = std({ map: stoneTexture('104'), roughness: 0.5, envMapIntensity: 0.6 });
  const stone = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.40, 0.2), [stoneSide, stoneSide, stoneSide, stoneSide, stoneFace, stoneSide]);
  stone.position.set(stoneX, 0.2 + 0.2, stoneZ);
  stone.rotation.y = stoneYaw;
  stone.updateMatrix(); stone.matrixAutoUpdate = false;
  stone.name = 'DRIVE_STOP_SIGN';
  world.add(stone);
  const stoneBase = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.3), matConc);
  stoneBase.geometry = uvMeters(stoneBase.geometry);
  stoneBase.position.set(stoneX, 0.13 + 0.04, stoneZ);
  stoneBase.rotation.y = stoneYaw;
  stoneBase.updateMatrix(); stoneBase.matrixAutoUpdate = false;
  world.add(stoneBase);
  shadows.blob.push({ x: stoneX, z: stoneZ, y: 0.14, sx: 1.6, sz: 0.7 });

  /* 주차 차량(단지 안 지상 주차·공원 쪽 길가). 차체색은 정점색으로 굽고 한 메시로 합친다 */
  const carGeos = [];
  const carAt = (hex, x, z, rotY) => {
    const g = carGeometry(hex).rotateY(rotY).translate(x, 0.13, z);
    carGeos.push(g);
    const across = Math.abs(Math.sin(rotY)) > 0.5;
    shadows.blob.push({ x, z, y: 0.15, sx: across ? 5.2 : 2.5, sz: across ? 2.5 : 5.2 });
  };
  [['#e8e9e9', stop - 6], ['#a7acb1', stop - 8.6], ['#1d2024', stop - 11.2], ['#e3e4e2', stop - 16.4]].forEach(([c, z]) => carAt(c, 9.7, z, Math.PI / 2));
  [['#2a3b55', -36], ['#e8e9e9', -38.6], ['#5a6067', -43.8]].forEach(([c, z]) => carAt(c, 9.7, z, Math.PI / 2));
  carAt('#eeeeec', -4.72, -124, Math.PI); carAt('#30343a', -4.72, -130.4, Math.PI);
  const cars = new THREE.Mesh(mergeGeometries(carGeos.map(g => clean(g, true))), std({ vertexColors: true, roughness: 0.32, metalness: 0.25, envMapIntensity: 1.1 }));
  cars.matrixAutoUpdate = false; cars.updateMatrix();
  cars.name = 'DRIVE_CARS';
  world.add(cars);

  /* 나무(인스턴스). 정차 지점 앞(오른쪽 보도)은 비워 표지·104동 현관이 보이게 */
  const open = z => z < stop + 4 && z > gate.z1 - 4;
  const lists = { ginkgoA: [], ginkgoB: [], zelkovaA: [], zelkovaB: [], pine: [], park: [] };
  const pick = (a, b) => (rand() < 0.5 ? a : b);
  for (let z = Z0 - 6; z > -330; z -= 10) if (!open(z)) lists[pick('ginkgoA', 'ginkgoB')].push([3.75, z + rand() * 1.2, 0.13]);
  for (let z = Z0 - 11; z > -330; z -= 10) lists[pick('ginkgoA', 'ginkgoB')].push([-7.3, z + rand() * 1.2, 0.13]);
  for (let i = 0; i < 26; i++) lists.park.push([-12 - rand() * 60, Z0 - 10 - rand() * 300, 0.05]);
  for (let i = 0; i < 6; i++) lists.park.push([-27 + rand() * 4, -20 - i * 45 - rand() * 10, 0.05]);
  const complexSpots = [[8.5, -4], [12.5, -26], [8.2, -30], [13, -60], [8.0, gate.z1 - 6], [12.0, gate.z1 - 18], [9.0, -128], [13.5, -150], [8.5, -166], [12, -190], [8.2, -205], [13, -232]];
  complexSpots.forEach(([x, z], i) => lists[i % 3 === 0 ? 'pine' : pick('zelkovaA', 'zelkovaB')].push([x, z, 0.1]));
  const treeMat = std({ vertexColors: true, map: foliage, bumpMap: foliage, bumpScale: 4, roughness: 0.92, envMapIntensity: 0.45 });
  const treeDefs = {
    ginkgoA: treeGeometry('ginkgo', '#97a54e', rand), ginkgoB: treeGeometry('ginkgo', '#c9ab3e', rand),
    zelkovaA: treeGeometry('zelkova', '#71894c', rand), zelkovaB: treeGeometry('zelkova', '#a98647', rand),
    pine: treeGeometry('pine', '#4b6542', rand), park: treeGeometry('park', '#6c8752', rand),
  };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  const instanced = [];
  for (const [k, list] of Object.entries(lists)) {
    if (!list.length) continue;
    const im = new THREE.InstancedMesh(treeDefs[k], treeMat, list.length);
    list.forEach(([x, z, y], i) => {
      const s = 0.88 + rand() * 0.3;
      q.setFromAxisAngle(Y, rand() * Math.PI * 2);
      im.setMatrixAt(i, m4.compose(p.set(x, y, z), q, sc.set(s, s * (0.92 + rand() * 0.16), s)));
      const r = (k.startsWith('zelkova') ? 3.4 : k === 'park' ? 3.0 : k === 'pine' ? 2.4 : 2.0) * s;
      shadows.blob.push({ x: x + 0.4, z: z + 0.3, y: y + 0.02, sx: r * 2, sz: r * 2 });
      if (y > 0.12 && Math.abs(x) < 8) put(matPit, uvMeters(floorAt(x - 0.6, x + 0.6, z - 0.6, z + 0.6, y + 0.012)));
    });
    im.instanceMatrix.needsUpdate = true;
    im.name = 'DRIVE_TREES_' + k;
    instanced.push(im);
  }

  /* 가로등(오른쪽·왼쪽 보도, 엇갈림) */
  const lamps = [];
  for (let z = Z0 - 14; z > -330; z -= 32) if (!open(z)) lamps.push([2.55, z, 0]);
  for (let z = Z0 - 30; z > -330; z -= 32) lamps.push([-6.15, z, Math.PI]);
  const lampMesh = new THREE.InstancedMesh(lampGeometry(), std({ vertexColors: true, roughness: 0.5, metalness: 0.5, envMapIntensity: 0.9 }), lamps.length);
  lamps.forEach(([x, z, r], i) => { q.setFromAxisAngle(Y, r); lampMesh.setMatrixAt(i, m4.compose(p.set(x, 0.13, z), q, sc.set(1, 1, 1))); });
  lampMesh.name = 'DRIVE_LAMPS';
  instanced.push(lampMesh);

  // 생울타리 밑동 그늘
  for (const [za, zb] of [[Z0, gate.z0], [gate.z1, Z1]]) shadows.strip.push({ x: 5.45 - 0.5, z: (za + zb) / 2, y: 0.145, len: Math.abs(zb - za), w: 1.0, rot: Math.PI });

  /* 정적 메시 합치기 */
  for (const [mat, list] of buckets) {
    const mesh = new THREE.Mesh(mergeGeometries(list), mat);
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    world.add(mesh);
  }
  for (const im of instanced) world.add(im);

  /* 접지 그림자 데칼(인스턴스 두 개) */
  const decal = (alphaMap, opacity) => new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap, transparent: true, opacity, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
  const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const blobs = new THREE.InstancedMesh(plane, decal(blobTexture(), 0.4), shadows.blob.length);
  shadows.blob.forEach((b, i) => blobs.setMatrixAt(i, m4.compose(p.set(b.x, b.y, b.z), q.identity(), sc.set(b.sx, 1, b.sz))));
  const strips = new THREE.InstancedMesh(plane, decal(stripTexture(), 0.34), shadows.strip.length);
  // 평면 로컬 x = 그늘 너비 방향(u 0 = 벽 쪽, 진함), 로컬 z = 벽을 따라. rot 로 로컬 x 를 벽에서 멀어지는 쪽에 맞춘다
  // (정면 -π/2 → +Z, 오른쪽 측벽 π → -X, 왼쪽 측벽 0 → +X)
  shadows.strip.forEach((s, i) => {
    q.setFromAxisAngle(Y, s.rot);
    strips.setMatrixAt(i, m4.compose(p.set(s.x, s.y, s.z), q, sc.set(s.w, 1, s.len)));
  });
  blobs.renderOrder = 1; strips.renderOrder = 1;
  blobs.name = 'DRIVE_AO_BLOBS'; strips.name = 'DRIVE_AO_STRIPS';
  world.add(blobs, strips);

  world.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  world.updateMatrixWorld(true);

  let tris = 0;
  world.traverse(o => { if (o.isMesh) { const g = o.geometry; const n = (g.index ? g.index.count : g.attributes.position.count) / 3; tris += o.isInstancedMesh ? n * o.count : n; } });
  tris += 32 * 16 * 2;
  let draws = 0;
  world.traverse(o => { if (o.isMesh) draws += Array.isArray(o.material) ? o.material.length : 1; });

  /* 텍스처 파일: 받으면 자리 표시를 바꾸고(같은 셰이더) 유휴 시간에 하나씩 GPU 로 올린다 */
  const idle = () => new Promise(r => (window.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 800 }) : setTimeout(r, 60)));
  const loaded = Promise.all(files.map(f => f.ready.then(real => {
    if (!real) return null;
    for (const m of mats) for (const slot of ['map', 'normalMap', 'roughnessMap']) if (m[slot] === f.tex) m[slot] = real;
    f.real = real;
    return real;
  }))).then(async list => {
    for (const t of list) { if (!t) continue; await idle(); try { S.renderer.initTexture(t); } catch { /* 첫 렌더가 올린다 */ } }
    S.requestRender();
    return list.filter(Boolean).length;
  });

  /* ---------- 상태 ---------- */
  const state = { dist: 0, haze: 0 };
  function apply() {
    const { dist, haze } = state;
    if (haze < 0.5) {
      const k = smooth(haze / 0.5);
      env.visible = true;
      S.envUniforms.uHaze.value = k;
      env.position.set(envBase.pos.x, envBase.pos.y, envBase.pos.z + dist);
      env.rotation.y = envBase.yaw - THREE.MathUtils.degToRad(DRIVE.turnDeg) * k;
      world.visible = false;
      sky.visible = false;
      fog.near = OFF.near; fog.far = OFF.far;
    } else {
      const k = easeOut((haze - 0.5) / 0.5);
      env.visible = false;
      world.visible = true;
      sky.visible = true;
      skyMat.uniforms.uHaze.value = 1 - k;
      fog.near = THREE.MathUtils.lerp(DRIVE.hazeNear, DRIVE.fogNear, k);
      fog.far = THREE.MathUtils.lerp(DRIVE.hazeNear + 0.4, DRIVE.fogFar, k * k);
    }
    world.position.z = dist;
    S.requestRender();
  }

  const api = {
    world, sky, tris, draws, buildings: buildingCount, DRIVE, loaded,
    textureFiles: files.map(f => f.file),
    get state() { return { ...state }; },
    /* dist: 이동 거리(m), haze: 0..1 전환 */
    set(dist, haze) { state.dist = dist; state.haze = haze; apply(); },
    arrive() { api.set(DRIVE.distance, 1); },
    reset() {
      state.dist = 0; state.haze = 0;
      S.envUniforms.uHaze.value = 0;
      env.visible = true;
      env.position.copy(envBase.pos);
      env.rotation.y = envBase.yaw;
      world.visible = false;
      sky.visible = false;
      world.position.z = 0;
      fog.near = OFF.near; fog.far = OFF.far;
      S.requestRender();
    },
    /* 숨겨 둔 세계의 셰이더를 미리 컴파일한다(보이는 것만 훑으므로 잠깐 켰다 끈다. 그리지 않음) */
    compile() {
      const was = [world.visible, sky.visible];
      world.visible = true; sky.visible = true;
      let job = null;
      try { job = S.renderer.compileAsync ? S.renderer.compileAsync(S.scene, S.camera) : S.renderer.compile(S.scene, S.camera); } catch { /* noop */ }
      world.visible = was[0]; sky.visible = was[1];
      return Promise.resolve(job).catch(() => {});
    },
  };
  return api;
}
