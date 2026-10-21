/* 04 세 캔버스 와이어: 클러스터 800×400 · 센터 1280×720 · 폰 390×844 를 같은 축척으로 바닥선에 맞춰 놓는다
 * 영역은 실제 캡처에서 잰 기기 px(data.js WIRE). "실제 화면 겹치기"를 켜면 캡처가 아래에 깔린다 */

import { WIRE, DEVICE_SIZE, cap } from './data.js';

const NS = 'http://www.w3.org/2000/svg';
const GAP = 80;
const TOP = 64;      // 캔버스 이름 줄
const BOTTOM = 8;

function el(name, attrs = {}, text) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text !== undefined) n.textContent = text;
  return n;
}

export function buildWire() {
  const order = ['cluster', 'center', 'phone'];
  const names = { cluster: '클러스터 800×400', center: '센터페시아 1280×720', phone: '모바일 390×844' };
  const H = Math.max(...order.map(d => DEVICE_SIZE[d].h));
  const W = order.reduce((a, d) => a + DEVICE_SIZE[d].w, 0) + GAP * (order.length - 1);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H + TOP + BOTTOM}`, class: 'wire', role: 'img',
    'aria-label': '세 기기 캔버스를 같은 축척으로 놓고 화면 영역을 선으로 표시한 그림' });
  let x = 0;
  for (const d of order) {
    const { w, h } = DEVICE_SIZE[d];
    const y = TOP + H - h;
    const g = el('g', { transform: `translate(${x} ${y})`, class: `wire-dev wire-${d}` });
    g.append(el('text', { x: 0, y: -22, class: 'wire-name' }, names[d]));
    g.append(el('image', { href: cap(WIRE[d].img), x: 0, y: 0, width: w, height: h, class: 'wire-ui', preserveAspectRatio: 'none' }));
    g.append(el('rect', { x: 0, y: 0, width: w, height: h, rx: d === 'phone' ? 40 : 8, class: 'wire-canvas' }));
    if (WIRE[d].route) {
      g.append(el('polyline', { points: WIRE[d].route.map(p => p.join(',')).join(' '), class: 'wire-route' }));
    }
    for (const r of WIRE[d].regions) {
      const cls = ['wire-reg', r.big && 'is-big', r.accent && 'is-accent', r.ghost && 'is-ghost'].filter(Boolean).join(' ');
      g.append(el('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: 6, class: cls }));
      if (!r.ghost && r.label.length * 24 > r.w - 20 && r.h > r.w) {
        // 좁고 긴 영역: 이름을 왼쪽 바깥에 오른쪽 정렬
        g.append(el('text', { x: r.x - 12, y: r.y + 34, 'text-anchor': 'end', class: 'wire-label' }, r.label));
      } else if (!r.ghost) {
        const ty = r.h >= 60 ? r.y + 34 : r.y + r.h / 2 + 9;
        g.append(el('text', { x: r.x + 12, y: ty, class: 'wire-label' + (r.big ? ' is-big' : '') }, r.label));
      } else {
        g.append(el('text', { x: r.x + 340, y: r.y + 300, class: 'wire-label is-ghost' }, r.label));
      }
    }
    if (WIRE[d].marker) {
      const m = WIRE[d].marker;
      g.append(el('circle', { cx: m.x, cy: m.y, r: 22, class: 'wire-marker' }));
      g.append(el('text', { x: m.x + 36, y: m.y + 9, class: 'wire-label is-accent-text' }, m.label));
    }
    svg.append(g);
    x += w + GAP;
  }
  return svg;
}
