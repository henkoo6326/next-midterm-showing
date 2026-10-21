/* D4 자산 출처·라이선스: assets/credits.json 을 표로 그린다
 * 형식(다른 담당도 항목을 더할 수 있게 단순하게): [{ group, name, author, source_url, license, note }]
 * 같은 group 은 처음 나온 순서대로 묶는다. 값은 모두 textContent 로 넣는다
 *
 * 불러오기
 * - 근거·출처 장이 화면 가까이 올 때 한 번 불러온다(첫 화면의 iframe·3D 요청과 겹치지 않게).
 *   로컬 python http.server 는 동시 연결 대기열이 작아 첫 화면 요청이 몰리면 연결이 끊겨
 *   fetch 가 'Failed to fetch'(TypeError)로 끝날 수 있었다. 그래서 늦게 부르고, 네트워크 오류는 두 번 더 시도한다
 * - 페이지를 떠나는 중(pagehide) 끊긴 요청은 오류로 기록하지 않는다
 * - 끝내 실패하면 안내 문구와 '다시 불러오기' 버튼을 보인다
 *
 * 소리 상태
 * - '소리' 그룹은 오디오 담당 스크립트(scripts/audio/credits_audio.py)가 다시 쓴다.
 *   파일 유무는 assets/audio/manifest.json 의 available 로 판단해 비고 칸 앞에 상태 칩으로 보인다
 *   (안내 음성: 생성 예정·파일 없음 / 원본 음성: 사용자 제공 파일 대기). manifest 를 못 읽으면 칩을 생략한다 */

import { asset } from './data.js';

let leaving = false;
addEventListener('pagehide', () => { leaving = true; });

const wait = ms => new Promise(r => setTimeout(r, ms));

async function fetchJSON(path, { tries = 3 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(asset(path), { cache: 'no-cache' });
      if (!res.ok) throw Object.assign(new Error(`${path} ${res.status}`), { http: res.status });
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (leaving || err.http === 404) break;          // 떠나는 중이거나 파일이 없으면 다시 시도하지 않는다
      if (i < tries - 1) await wait(400 * (i + 1) ** 2);
    }
  }
  throw lastErr;
}

/* '소리' 항목의 현재 상태(파일 유무)를 manifest 로 계산한다 */
function soundStatus(it, man) {
  if (!man || it.group !== '소리') return null;
  const has = k => !!(man[k] && man[k].available);
  const url = String(it.source_url || '');
  if (/elevenlabs\.io/.test(url)) {
    return ['voice-v1', 'voice-v2', 'voice-v3'].every(has)
      ? '생성 파일 사용'
      : '생성 예정 · 파일 없음(자막만)';
  }
  if (/o-nMYZaeAnc/.test(url)) {
    const a = has('source-0418'), b = has('source-0434');
    if (a && b) return '사용자 제공 파일 사용';
    if (!a && !b) return '사용자 제공 파일 대기(자막만)';
    return `사용자 제공 파일 대기 · ${a ? '4:34–4:37' : '4:18–4:20'}`;
  }
  return null;
}

function draw(host, items, man) {
  const groups = new Map();
  for (const it of items) {
    if (!it || !it.name) continue;
    const g = String(it.group || '기타');
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(it);
  }
  const table = document.createElement('table');
  table.className = 'tbl tbl--credits';
  const thead = table.createTHead().insertRow();
  for (const h of ['분류', '자산', '만든 사람·출처', '라이선스', '비고']) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = h;
    thead.append(th);
  }
  const tbody = table.createTBody();
  for (const [group, list] of groups) {
    list.forEach((it, i) => {
      const tr = tbody.insertRow();
      const tdG = tr.insertCell();
      if (i === 0) { tdG.textContent = group; tdG.className = 'credit-group'; }
      tr.insertCell().textContent = it.name;
      const tdA = tr.insertCell();
      tdA.textContent = it.author || '';
      if (it.source_url && /^https?:\/\//.test(it.source_url)) {
        const a = document.createElement('a');
        a.href = it.source_url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = '출처';
        tdA.append(document.createTextNode(' '), a);
      }
      tr.insertCell().textContent = it.license || '';
      const tdN = tr.insertCell();
      const status = soundStatus(it, man);
      if (status) {
        const chip = document.createElement('span');
        chip.className = 'evi credit-status';
        chip.textContent = status;
        tdN.append(chip, document.createElement('br'));
      }
      tdN.append(document.createTextNode(it.note || ''));
    });
  }
  host.innerHTML = '';
  host.append(table);
}

function failed(host, err) {
  host.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'cap';
  p.textContent = '자산 목록(assets/credits.json)을 불러오지 못했습니다 ';
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn--sm credit-retry';
  b.textContent = '다시 불러오기';
  b.addEventListener('click', () => load(host));
  p.append(b);
  host.append(p);
  if (!leaving) console.warn('[front] credits', err && err.message ? err.message : err);
}

async function load(host) {
  host.dataset.credits = 'loading';
  let items;
  try {
    items = await fetchJSON('assets/credits.json');
    if (!Array.isArray(items)) throw new Error('credits.json 이 배열이 아님');
  } catch (err) {
    host.dataset.credits = 'failed';
    failed(host, err);
    return;
  }
  let man = null;
  try { man = await fetchJSON('assets/audio/manifest.json', { tries: 2 }); } catch { /* 칩만 생략 */ }
  draw(host, items, man);
  host.dataset.credits = 'ready';
}

/* 화면 가까이 오면 한 번 불러온다. IntersectionObserver 가 없으면 바로 */
export function renderCredits(host) {
  if (!('IntersectionObserver' in window)) return load(host);
  return new Promise(resolve => {
    const io = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return;
      io.disconnect();
      resolve(load(host));
    }, { rootMargin: '200% 0px 200% 0px' });
    io.observe(host);
  });
}
