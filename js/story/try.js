/* 하루 이야기 '직접 해 보기': 수동 모드 폰(ui-bridge mode 'manual', device phone) 하나를 대화상자에 띄운다
 *
 * - 현재 UI의 실제 흐름으로 A-023 전달 기록(C4), 사진(C5: 카메라 / 파일), 업무 종료(C10)를 직접 해 본다
 * - 기록은 현재 UI 저장 방식 그대로 방문자 브라우저의 localStorage next-postload-v4, IndexedDB next-postload-photos-v1 에만
 * - 준비 단계(104동 정차까지 맞추기)와 '시연값으로 채우기'는 직접 기록으로 세지 않는다(따로 표기)
 * - 닫기·섹션 이탈·페이지 이탈 때 카메라 트랙을 모두 멈춘다
 * - 닫으면 수동 폰 iframe 도 해제한다(기록은 브라우저 저장소에 남아 다시 열면 이어진다). 열고 닫을 때 onOpen/onClose 로 알린다
 * - 폰 외형은 정면 목업(phone-front)이 manifest 에 있으면 그것을, 없으면 phone-34 를 쓴다(devices.js MOCKUP_IDS.try)
 * - 직접 기록이 새로 생기면(사진 저장, 전달 기록, 보류, 업무 종료) 안내 문구를 그 결과로 바꾼다(앞 단계 안내가 남지 않게)
 * - 폰(iframe)에 초점이 있을 때 Esc: 폰 안의 시트가 열려 있으면 그 시트만 닫히고, 닫힌 상태에서 한 번 더 누르면 대화상자를 닫는다
 */

import { Slot, MOCKUP_IDS, pickMockup } from './devices.js';
import { PhotoBridge } from './photo.js';

export const STORE_KEY = 'next-postload-v4';
export const PHOTO_DB = 'next-postload-photos-v1';
const ARCHIVE_PREFIX = 'next-postload-archive-';
const FILL_KEY = 'next-story-filled-v1';
const PREP_KEY = 'next-story-prepared-v1';
const SHIPMENT = { 'A-023': '104동 1203호', 'A-024': '104동 1203호', 'B-110': '104동 804호', 'C-051': '105동 706호' };

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function lsGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function lsSet(key, value) { try { localStorage.setItem(key, value); } catch { /* noop */ } }
function lsRemove(key) { try { localStorage.removeItem(key); } catch { /* noop */ } }
function readJson(key, fallback) { try { const v = JSON.parse(lsGet(key)); return v ?? fallback; } catch { return fallback; } }

/* 방문자 직접 기록 요약(대화상자를 열지 않아도 localStorage 에서 읽는다) */
export function readUserRecords() {
  const state = readJson(STORE_KEY, null);
  const filled = new Set(readJson(FILL_KEY, []));
  const out = { items: [], closed: false, filled: [...filled], any: false, state };
  if (!state || !state.items) return out;
  for (const [id, item] of Object.entries(state.items)) {
    // '시연값으로 채우기'가 만든 증빙(key story-fill-*)과 전달 결과는 직접 기록으로 세지 않는다
    const byFill = filled.has(id);
    const parts = [];
    if (item.proof?.kind === 'photo') parts.push('사진 저장됨');
    else if (item.proof?.kind === 'demo' && !String(item.proof.key || '').startsWith('story-fill-')) parts.push('시연 증빙 사용');
    if (!byFill && item.result === 'delivered') parts.push('전달 기록 저장됨');
    else if (!byFill && item.result === 'undelivered') parts.push('미전달 기록');
    if (item.result === 'pending' && item.deferred) parts.push('나중에 배송(보류)' + (item.reason ? ' · ' + item.reason : ''));
    if (parts.length) out.items.push({ id, label: `${id} · ${SHIPMENT[id] || ''}`, parts });
  }
  out.closed = state.day?.stage === 'closed';
  out.any = out.items.length > 0 || out.closed;
  return out;
}

export function userRecordLine() {
  const r = readUserRecords();
  if (!r.any) return '';
  const bits = r.items.map(i => `${i.id} ${i.parts.join('·')}`);
  if (r.closed) bits.push('업무 종료');
  return bits.join(' / ');
}

function deleteDb(name, timeout = 4000) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => finish('deleted');
      req.onerror = () => finish('error');
      req.onblocked = () => setTimeout(() => finish('blocked'), timeout);
    } catch { finish('error'); }
    setTimeout(() => finish('timeout'), timeout + 500);
  });
}

/* 직접 기록이 새로 생긴 것을 한 문장으로(가장 나중 단계 하나). 지운 경우는 clear() 가 따로 알린다 */
function changeNote(before, after) {
  if (after.closed && !before.closed) return '업무 종료를 직접 기록했습니다. 이 브라우저에만 남습니다';
  const had = new Map(before.items.map(i => [i.id, new Set(i.parts)]));
  let note = '';
  for (const item of after.items) {
    const old = had.get(item.id) || new Set();
    const added = item.parts.filter(p => !old.has(p));
    if (added.includes('전달 기록 저장됨')) return `${item.id} 전달 기록을 저장했습니다. 이 브라우저에만 남습니다`;
    if (added.includes('사진 저장됨')) note = `${item.id} 사진을 저장했습니다. 전달 결과는 "전달 저장 · 다음 배송"으로 따로 기록합니다`;
    else if (added.includes('미전달 기록')) note = `${item.id} 미전달 결과를 기록했습니다`;
    else if (!note && added.some(p => p.startsWith('나중에 배송'))) note = `${item.id} 건을 나중에 배송(보류)으로 남겼습니다`;
  }
  return note;
}

const TASKS = {
  deliver: {
    title: 'A-023 전달 기록',
    steps: [
      '폰은 이야기와 같은 104동 정차 상태입니다. 1203호 배송 상세에서 시작합니다',
      '사진을 저장하거나, "사진 저장 방법 → 사진 없이 전달만 기록"을 고릅니다',
      '"전달 저장 · 다음 배송"을 누르면 전달 기록이 저장됩니다',
    ],
  },
  photo: {
    title: 'A-023 사진 기록',
    steps: [
      '카메라로 찍기: 현재 UI의 촬영 시트가 열립니다. 촬영 버튼을 누르면 셔터음 뒤 확인 화면이 나옵니다',
      '파일에서 고르기: 기기에 있는 사진을 고릅니다. 촬영이 아니므로 셔터음·플래시가 없습니다',
      '확인 화면에서 "이 사진 저장"을 눌러야 저장됩니다. 사진 저장은 전달 기록이 아닙니다',
    ],
  },
  finish: {
    title: '업무 종료 누르기',
    steps: [
      '남은 배송·보류·사진 미완료가 있으면 현재 UI는 종료 버튼 대신 안내를 보여 줍니다',
      '남은 일을 직접 처리하거나, 아래 버튼으로 시연값으로 채울 수 있습니다(직접 기록으로 세지 않음)',
      '복귀 확인 뒤 나오는 "작업 종료"는 직접 누릅니다',
    ],
  },
};

export class TryPanel {
  constructor(root, { mockups, onChange, onOpen, onClose } = {}) {
    this.root = root;
    this.dialog = root.querySelector('[data-story-try]');
    this.slotEl = this.dialog.querySelector('[data-slot="try"]');
    this.phoneBox = this.dialog.querySelector('[data-try-phone]');
    this.taskEl = this.dialog.querySelector('[data-try-task]');
    this.msgEl = this.dialog.querySelector('[data-try-msg]');
    this.recordsEl = this.dialog.querySelector('[data-try-records]');
    this.fileInput = this.dialog.querySelector('[data-try-file]');
    this.clearBox = this.dialog.querySelector('[data-try-clear-box]');
    this.flashEl = this.dialog.querySelector('[data-try-flash]');
    this.onChange = onChange || (() => {});
    this.onOpen = onOpen || (() => {});
    this.onClose = onClose || (() => {});
    this.task = 'deliver';
    this.slot = null;
    this.mockups = mockups;
    this.poll = null;
    this.lastSig = '';
    this.photo = new PhotoBridge(() => this.slot?.handle, {
      flash: this.flashEl,
      onMessage: (text, kind) => this.message(text, kind),
      onState: () => this.refresh(),
      onCameraError: () => this.focusFile(),
    });
    this.bind();
  }

  bind() {
    this.dialog.querySelector('[data-try-close]').addEventListener('click', () => this.close());
    this.dialog.addEventListener('close', () => this.afterClose());
    this.dialog.addEventListener('cancel', () => this.photo.stopCamera('cancel'));
    this.dialog.addEventListener('click', e => { if (e.target === this.dialog) this.close(); });
    this.dialog.querySelectorAll('[data-try-tab]').forEach(b => b.addEventListener('click', () => this.setTask(b.dataset.tryTab, true)));
    this.dialog.querySelector('[data-try-clear]').addEventListener('click', () => this.askClear());
    this.fileInput.addEventListener('change', async () => {
      const file = this.fileInput.files && this.fileInput.files[0];
      this.fileInput.value = '';
      if (!file) return;
      if (this.readyJob) await this.readyJob;
      if (await this.readyForPhoto()) await this.photo.useFile(file);
      this.refresh();
    });
    this.taskEl.addEventListener('click', e => {
      const b = e.target.closest('[data-try-do]');
      if (!b) return;
      this.run(b.dataset.tryDo);
    });
    window.addEventListener('pagehide', () => this.photo.stopCamera('pagehide'));
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.photo.stopCamera('hidden'); });
    new ResizeObserver(() => this.layout()).observe(this.phoneBox);
  }

  get isOpen() { return this.dialog.open; }

  message(text, kind = 'info') {
    this.msgEl.textContent = text || '';
    this.msgEl.dataset.kind = kind;
  }

  focusFile() {
    const b = this.taskEl.querySelector('[data-try-do="file"]');
    if (b) { b.classList.add('is-suggested'); b.focus({ preventScroll: true }); }
  }

  layout() {
    if (!this.slot) return;
    const box = this.phoneBox.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const pad = 16;
    const e = this.slot.ext;
    const fw = 1 + e.l + e.r;
    const fh = e.t + 1 / this.slot.aspect + e.b;
    let w = Math.min((box.width - pad * 2) / fw, (box.height - pad * 2) / fh, 390);
    w = Math.max(160, w);
    this.slot.setWidth(w);
    // 하우징까지 포함한 외곽이 가운데 오게
    this.slotEl.style.transform = `translate(${((e.l - e.r) / 2) * w}px, ${((e.t - e.b) / 2) * w}px)`;
    this.slot.relayoutMockup();
  }

  async open(task = 'deliver') {
    if (!this.dialog.open) {
      this.dialog.showModal();
      document.documentElement.classList.add('story-try-open');
      try { this.onOpen(); } catch (err) { console.warn(err); }
    }
    this.message('');
    this.setTask(task, false);
    if (!this.slot) {
      const mockup = pickMockup(this.mockups, MOCKUP_IDS.try);
      this.slot = new Slot(this.slotEl, 'phone', { mode: 'manual', mockup });
    }
    this.layout();
    this.slotEl.classList.add('is-loading');
    this.readyJob = (async () => {
      try {
        const handle = await this.slot.start();
        if (!handle.win.__storyManual) await handle.inject({ href: 'showing/story-manual.js' });
        this.photo.attach();
        // iframe 안의 Esc 는 바깥 dialog 의 cancel 로 가지 않으므로 story-manual.js 가 알려 준다
        if (handle.win.__storyManual) handle.win.__storyManual.hooks.onEscape = () => this.close();
        this.slotEl.classList.remove('is-loading');
        await this.ensurePrepared(task);
        if (task === 'photo') this.focusFirst();
        return true;
      } catch (err) {
        this.slotEl.classList.remove('is-loading');
        if (err?.name === 'AbortError' || !this.dialog.open) return false;   // 불러오는 중에 닫음
        this.message('직접 해 보기 화면을 불러오지 못했습니다. 이야기는 스크롤로 계속 볼 수 있습니다', 'warn');
        console.warn('[story] 직접 해 보기 실패', err);
        return false;
      }
    })();
    await this.readyJob;
    if (!this.dialog.open) return;   // 불러오는 동안 닫혔으면 감시를 시작하지 않는다
    this.refresh();
    clearInterval(this.poll);
    this.poll = setInterval(() => this.refresh(), 600);
  }

  focusFirst() {
    const b = this.taskEl.querySelector('[data-try-do]');
    b?.focus({ preventScroll: true });
  }

  close() {
    if (this.dialog.open) this.dialog.close();
    else this.afterClose();
  }

  afterClose() {
    const stopped = this.photo.stopCamera('dialog-close');
    if (stopped) console.info('[story] 카메라 트랙 정지', stopped);
    clearInterval(this.poll);
    this.poll = null;
    document.documentElement.classList.remove('story-try-open');
    // 수동 폰 iframe 해제(기록은 localStorage·IndexedDB 에 남는다)
    this.slot?.release();
    this.slotEl.classList.remove('is-loading');
    this.onChange();
    try { this.onClose(); } catch (err) { console.warn(err); }
  }

  /* 섹션을 벗어나면 story.js 가 부른다 */
  suspend() {
    this.photo.stopCamera('leave');
    if (this.dialog.open) this.close();
  }

  setTask(task, prepare) {
    if (!TASKS[task]) task = 'deliver';
    this.task = task;
    this.dialog.querySelectorAll('[data-try-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tryTab === task)));
    const t = TASKS[task];
    let actions = '';
    if (task === 'photo') {
      actions = `<div class="story-try-actions">
        <button type="button" class="btn btn--primary" data-try-do="camera">카메라로 찍기</button>
        <button type="button" class="btn" data-try-do="file">파일에서 고르기</button>
      </div>`;
    } else if (task === 'finish') {
      actions = `<p class="story-try-summary" data-try-summary></p>
      <div class="story-try-actions">
        <button type="button" class="btn" data-try-do="fill">남은 배송을 시연값으로 채우기(보류 제외)</button>
        <button type="button" class="btn btn--ghost" data-try-do="fill-all">보류까지 시연값으로 채우기</button>
      </div>`;
    } else {
      actions = `<div class="story-try-actions">
        <button type="button" class="btn" data-try-do="show-a023">A-023 상세로 맞추기</button>
      </div>`;
    }
    this.taskEl.innerHTML = `<h4>${t.title}</h4><ol class="story-try-steps">${t.steps.map(s => `<li>${s}</li>`).join('')}</ol>${actions}`;
    if (prepare && this.slot?.handle) this.ensurePrepared(task).then(() => this.refresh());
    this.refresh();
  }

  async run(what) {
    if (what === 'camera') {
      if (await this.readyForPhoto()) await this.photo.openCamera();
    } else if (what === 'file') {
      this.fileInput.click();
    } else if (what === 'show-a023') {
      await this.ensurePrepared('deliver', true);
    } else if (what === 'fill' || what === 'fill-all') {
      this.fill(what === 'fill-all');
    }
    this.refresh();
  }

  /* A-023 사진을 넣을 수 있는 화면(배송 상세)인지 맞추고 확인한다 */
  async readyForPhoto() {
    await this.ensurePrepared('photo');
    const h = this.slot?.handle;
    const s = this.state();
    if (!h || !s?.day) return false;
    const a = s.items['A-023'];
    if (s.day.stage !== 'delivery') {
      this.message('이미 남은 기록·복귀 단계까지 진행해 A-023 사진을 새로 넣을 수 없습니다. "직접 기록 지우기"로 처음부터 할 수 있습니다', 'warn');
      return false;
    }
    if (a.proof) {
      this.message('A-023 사진은 이미 저장했습니다. 다시 해 보려면 "직접 기록 지우기"를 누르세요', 'info');
      return false;
    }
    if (a.result === 'undelivered') {
      this.message('A-023은 미전달로 기록되어 사진을 받지 않습니다', 'info');
      return false;
    }
    if (s.selected !== 'A-023' || !h.doc.querySelector('#phone [data-action="camera"]')) {
      await this.ensurePrepared('deliver', true);
    }
    return true;
  }

  state() {
    try { return this.slot?.handle?.win?.NextApp?.getState() || null; } catch { return null; }
  }

  wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  /* 이야기와 같은 지점(104동 정차, A-023 상세)으로 맞춘다. 이미 진행한 기록은 건드리지 않는다 */
  async ensurePrepared(task, force = false) {
    const h = this.slot?.handle;
    if (!h) return;
    let s = this.state();
    if (!s?.day) return;
    if (task === 'deliver' || task === 'photo') {
      if (s.day.stage === 'boarding' || s.day.stage === 'planning') {
        if (s.day.stage === 'boarding') h.dispatch('dayPlan');
        h.dispatch('dayChoose', { routeId: 'time' });
        h.dispatch('dayStart');
        h.dispatch('drive');
        h.dispatch('park');
        lsSet(PREP_KEY, '1');
        this.message('이야기와 같은 104동 정차 상태로 맞췄습니다. 이 준비는 직접 기록으로 세지 않습니다', 'info');
        await this.wait(120);
        s = this.state();
      }
      if (s.vehicle !== 'parked' && s.day.stage === 'delivery') { h.dispatch('park'); await this.wait(80); s = this.state(); }
      if (s.day.stage !== 'delivery') {
        if (force || task !== 'finish') this.message('이미 남은 기록·복귀 단계까지 진행했습니다. 처음부터 하려면 "직접 기록 지우기"를 누르세요', 'info');
        return;
      }
      const a = s.items['A-023'];
      const onDetail = !!h.doc.querySelector('#phone .p-address, #phone [data-action="camera"], #phone [data-action="resultAndNext"]');
      if (force || !onDetail) {
        if (a.result === 'pending' || force) {
          h.click('#phone [data-mobile-tab="delivery"]');
          await this.wait(150);
          if (!h.click('#phone [data-action="open"][data-id="A-023"]')) h.click('#phone [data-action="open"]');
          await this.wait(150);
        }
      }
    } else if (task === 'finish') {
      if (s.day.stage === 'boarding' || s.day.stage === 'planning') {
        this.message('아직 배송을 시작하지 않았습니다. 남은 배송을 시연값으로 채우면 종료 직전까지 갑니다', 'info');
        return;
      }
      if (s.day.stage === 'delivery') {
        // 배송 목록 아래 "남은 업무 확인"을 직접 누르면 현재 UI가 남은 일을 보여 주고 종료를 막는다
        h.click('#phone [data-mobile-tab="delivery"]');
        await this.wait(150);
        if (!h.doc.querySelector('#phone [data-action="openReview"]')) h.click('#phone [data-action="list"]');
        await this.wait(150);
        this.message('폰 아래쪽 "남은 업무 확인"을 누르면, 남은 배송이 있을 때 현재 UI가 종료 버튼 대신 안내를 보여 줍니다', 'info');
        return;
      }
      h.click('#phone [data-mobile-tab="today"]');
      await this.wait(150);
      h.click('#phone [data-mobile-workflow]');
      await this.wait(150);
    }
  }

  /* 남은 배송을 시연값으로 채우고 복귀 정차까지. 작업 종료 버튼은 방문자가 직접 누른다 */
  async fill(includeDeferred) {
    const h = this.slot?.handle;
    if (!h) return;
    let s = this.state();
    if (!s?.day) return;
    if (s.day.stage === 'closed') { this.message('이미 업무를 종료했습니다', 'info'); return; }
    if (s.day.stage === 'boarding' || s.day.stage === 'planning') {
      await this.ensurePrepared('deliver');
      s = this.state();
    }
    const win = h.win;
    const order = (win.NextDay?.orderedIds?.(s)) || Object.keys(s.items);
    const parcels = win.NextDay?.parcels || {};
    const filled = new Set(readJson(FILL_KEY, []));
    let count = 0;
    let skipped = 0;
    if (s.vehicle !== 'parked') h.dispatch('park');
    for (const id of order) {
      s = this.state();
      const item = s.items[id];
      const needsPhoto = parcels[id]?.photoRequired && !item.proof && item.result !== 'undelivered';
      if (item.result !== 'pending' && !needsPhoto) continue;
      if (item.deferred && !includeDeferred) { skipped++; continue; }
      // 남은 업무 화면(phase review)이거나 보류 건이면 현재 UI의 '배송 다시 열기'와 같은 resume 으로 되돌린다
      if (item.deferred || s.phase !== 'work') h.dispatch('resume', { id });
      else h.dispatch('select', { id });
      if (needsPhoto) h.dispatch('proof', { id, key: 'story-fill-' + id, kind: 'demo' });
      if (this.state().items[id].result === 'pending') h.dispatch('result', { id, value: 'delivered' });
      const after = this.state().items[id];
      if (after.result !== 'pending' && (!parcels[id]?.photoRequired || after.proof)) {
        filled.add(id);
        count++;
      }
    }
    lsSet(FILL_KEY, JSON.stringify([...filled]));
    s = this.state();
    if (s.day.stage === 'delivery' || s.phase === 'work') h.dispatch('openReview');
    h.dispatch('dayReturn');
    h.dispatch('dayReturnDrive');
    h.dispatch('dayReturnPark');
    await this.wait(120);
    h.click('#phone [data-mobile-tab="today"]');
    await this.wait(150);
    h.click('#phone [data-mobile-workflow]');
    await this.wait(150);
    s = this.state();
    const summary = win.NextDay?.summary?.(s);
    if (summary?.canFinish) {
      this.message(`${count}건을 시연값으로 채우고 복귀 정차까지 맞췄습니다. 폰의 "작업 종료"를 직접 누르세요`, 'info');
    } else {
      this.message(`${count}건을 시연값으로 채웠습니다. ${skipped ? '보류 ' + skipped + '건이 남아 현재 UI가 종료를 막습니다' : (summary?.reason || '')}`.trim(), 'warn');
    }
  }

  askClear() {
    this.clearBox.innerHTML = `<p>직접 기록과 사진을 이 브라우저에서 지웁니다</p>
      <button type="button" class="btn btn--sm btn--primary" data-try-clear-yes>지우기</button>
      <button type="button" class="btn btn--sm" data-try-clear-no>취소</button>`;
    this.clearBox.querySelector('[data-try-clear-yes]').addEventListener('click', () => this.clear());
    this.clearBox.querySelector('[data-try-clear-no]').addEventListener('click', () => this.resetClearBox());
  }

  resetClearBox() {
    this.clearBox.innerHTML = '<button type="button" class="btn btn--sm" data-try-clear>직접 기록 지우기</button>';
    this.clearBox.querySelector('[data-try-clear]').addEventListener('click', () => this.askClear());
  }

  /* 직접 기록 지우기: 카메라 정지 → 수동 폰 해제(저장소 연결 닫기) → localStorage·IndexedDB 정리 → 다시 열기 */
  async clear() {
    this.photo.stopCamera('clear');
    const wasOpen = this.dialog.open;
    this.slot?.release();
    await this.wait(250);
    lsRemove(STORE_KEY);
    lsRemove(FILL_KEY);
    lsRemove(PREP_KEY);
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(ARCHIVE_PREFIX)) keys.push(k);
      }
      keys.forEach(lsRemove);
    } catch { /* noop */ }
    const result = await deleteDb(PHOTO_DB);
    this.resetClearBox();
    this.message(result === 'deleted' ? '직접 기록과 사진을 지웠습니다' : '기록은 지웠습니다. 사진 저장소는 다른 창이 쓰고 있어 창을 닫은 뒤 지워집니다', result === 'deleted' ? 'info' : 'warn');
    this.onChange();
    if (wasOpen) {
      const msg = this.msgEl.textContent;
      await this.open(this.task);
      this.message(msg, 'info');
    } else {
      this.refresh();
    }
    return result;
  }

  refresh() {
    const r = readUserRecords();
    const s = this.state() || r.state;
    const lines = [];
    for (const item of r.items) lines.push(`<li><span class="story-tag story-tag--user">직접 기록</span><span><b>${esc(item.label)}</b> ${esc(item.parts.join(' · '))}</span></li>`);
    if (r.closed) lines.push('<li><span class="story-tag story-tag--user">직접 기록</span><span><b>업무 종료</b> 직접 눌렀습니다</span></li>');
    if (r.filled.length) lines.push(`<li><span class="story-tag story-tag--demo">시연</span><span>시연값으로 채운 배송 ${r.filled.length}건(${esc(r.filled.join(', '))})</span></li>`);
    if (!lines.length) lines.push('<li class="is-empty">아직 직접 기록이 없습니다. 건너뛰어도 이야기는 시연 화면으로 이어집니다</li>');
    const html = lines.join('');
    if (html !== this.recordsHtml) { this.recordsEl.innerHTML = html; this.recordsHtml = html; }
    const sum = this.taskEl.querySelector('[data-try-summary]');
    if (sum && s?.day && this.slot?.handle?.win?.NextDay?.summary) {
      try {
        const q = this.slot.handle.win.NextDay.summary(s);
        sum.textContent = s.day.stage === 'closed' ? '업무를 종료한 상태입니다'
          : `남은 배송 ${q.pending}건 · 보류 ${q.deferred}건 · 사진 미완료 ${q.missingProof}건${q.canFinish ? ' · 지금 종료할 수 있습니다' : ''}`;
      } catch { /* noop */ }
    }
    const sig = JSON.stringify([r.items, r.closed, r.filled]);
    if (sig !== this.lastSig) {
      const before = this.lastRecords;
      this.lastSig = sig;
      this.lastRecords = r;
      if (before && this.dialog.open) {
        const note = changeNote(before, r);
        if (note) this.message(note, 'info');
      }
      this.onChange();
    }
  }
}
