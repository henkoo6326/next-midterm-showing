/* Parent integration: load CSS/JS, include render() in the center, call open('phone') for phone
 * or open() to infer the focused button's device
 * from its AI button (or use data-next-ai-open). Parent owns the global prototype note outside all devices.
 * Read-only answers; only an explicit confirmation dispatches route changes. */
(() => {
  'use strict';
  if (window.NextDeliveryAssistant) return;
  let recognition=null, voiceStatus='마이크를 눌러 말씀하세요', listening=false;
  const mic = window.NextIcons.icon('mic','filled',{decorative:true});
  const prompts = ['남은 배송 순서 추천해줘', '진입 못 하는 배송지는 뒤로 미뤄줘', '배터리와 복귀 상태 확인해줘', '아직 전송 안 된 사진 보여줘'];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let opened = false, messages = [], choices = [], selected = null, offeredState = '', draft = '', trigger = null, timer = null, busy = false, mountTarget = 'center', pendingDefer = null;
  const state = () => { try { return window.NextApp?.getState?.() || null; } catch { return null; } };
  const parked = s => s?.vehicle === 'parked';
  const fingerprint = s => JSON.stringify(s);
  const engine = () => window.NextDay || window.NextPostload;
  const stopName = id => engine()?.stops?.find(s => s.id === id)?.shortName || engine()?.stops?.find(s => s.id === id)?.name || String(id);
  function icon(){return window.NextIcons.icon('mic','filled',{decorative:true})}
  function routes(s) {
    if (!s?.day?.assignmentsReady || !['boarding','planning','delivery','review'].includes(s.day.stage)) return [];
    try { return (window.NextDay?.routes?.(s) || []).slice(0, 2); } catch { return []; }
  }
  function clearChoices() { choices = []; selected = null; pendingDefer = null; offeredState = ''; }
  function stopWatch() { if (timer !== null) window.clearInterval(timer); timer = null; }
  function safeState() {
    const s = state();
    if (!parked(s)) { stopVoice(); opened = false; draft = ''; clearChoices(); stopWatch(); }
    return s;
  }
  function render(target = 'center') {
    const s = safeState(), disabled = !parked(s);
    if ((selected || pendingDefer) && fingerprint(s) !== offeredState && !busy) clearChoices();
    return `<div class="nda-host" data-next-ai-host data-nda-target="${target === 'phone' ? 'phone' : 'center'}" ${opened && mountTarget === target ? '' : 'hidden'}><section class="nda-panel" role="dialog" aria-labelledby="nda-title-${target === 'phone' ? 'phone' : 'center'}"><header class="nda-header"><span class="nda-brand">${icon()}<strong id="nda-title-${target === 'phone' ? 'phone' : 'center'}">배송 도우미</strong></span><button type="button" data-nda-action="close" aria-label="배송 도우미 닫기">${window.NextIcons.icon('close','filled',{decorative:true})}</button></header><div class="nda-body"><p class="nda-welcome">어떤 배송 업무를 도와드릴까요?</p><div class="nda-chips" aria-label="질문 예시">${target === 'center' ? `<p class="nda-voice-example">“남은 배송 순서 추천해줘”</p><p class="nda-voice-example">“배터리 상태 알려줘”</p>` : prompts.map((p,i) => `<button type="button" data-nda-action="prompt" data-nda-prompt="${i}" ${disabled ? 'disabled' : ''}>${p}</button>`).join('')}</div><div class="nda-messages" role="log" aria-live="polite" aria-relevant="additions text">${messages.map(m => `<div class="nda-message nda-${m.role}"><span class="nda-sr">${m.role === 'user' ? '나' : '배송 도우미'}: </span><p>${esc(m.text)}</p></div>`).join('')}</div>${choices.length ? `<div class="nda-choices" aria-label="방문 순서 선택">${choices.map(r => `<button type="button" data-nda-action="choose" data-nda-route="${esc(r.id)}" aria-pressed="${selected === r.id}" ${disabled || busy ? 'disabled' : ''}><span>${esc(r.stops.map(stopName).join(' → '))}</span><small>${selected === r.id ? '선택됨' : '이 순서 선택'}</small></button>`).join('')}</div>` : ''}${pendingDefer ? `<div class="nda-confirm"><p>${esc(pendingDefer.label)}</p><button type="button" data-nda-action="deferConfirm" ${disabled || busy ? 'disabled' : ''}>현재 배송 보류</button><button type="button" data-nda-action="cancel">취소</button></div>` : ''}${selected ? `<div class="nda-confirm"><p>선택한 방문 순서로 배송 경로를 변경할까요?</p><button type="button" data-nda-action="confirm" ${disabled || busy ? 'disabled' : ''}>이 순서로 적용</button><button type="button" data-nda-action="cancel">취소</button></div>` : ''}</div>${target === 'center' ? `<div class="nda-voice-controls"><p role="status">${esc(voiceStatus)}</p><button type="button" class="nda-mic" data-nda-action="voice" aria-label="${listening?'음성 입력 중지':'음성 입력 시작'}" aria-pressed="${listening}">${mic}</button><span>말씀하신 내용을 확인한 뒤 적용합니다.</span></div>` : `<form class="nda-form"><label class="nda-sr" for="nda-input-${target === 'phone' ? 'phone' : 'center'}">배송 도우미에게 질문</label><input id="nda-input-${target === 'phone' ? 'phone' : 'center'}" name="question" type="text" maxlength="240" autocomplete="off" placeholder="배송 업무를 물어보세요" value="${esc(draft)}" ${disabled || busy ? 'disabled' : ''}><button type="submit" aria-label="질문 보내기" ${disabled || busy ? 'disabled' : ''}>보내기</button></form>`}</section></div>`;
  }
  function paint(focusInput = false) {
    const container = document.querySelector('#' + mountTarget);
    document.querySelectorAll('[data-next-ai-host]').forEach(host => host.remove());
    if (!opened || !container) return;
    const mount = document.createElement('div');
    mount.innerHTML = render(mountTarget);
    container.appendChild(mount.firstElementChild);
    if (focusInput && opened) container.querySelector('.nda-form input')?.focus({preventScroll:true});
    const body = container.querySelector('.nda-body');
    if (body) body.scrollTop = body.scrollHeight;
  }
  function open(target) {
    if (!parked(safeState())) { paint(); return false; }
    trigger = document.activeElement;
    mountTarget = target === 'phone' || (!target && trigger?.closest?.('#phone')) ? 'phone' : 'center';
    if (!document.querySelector('#' + mountTarget)) return false;
    voiceStatus='마이크를 눌러 말씀하세요'; opened = true; paint(true);
    if (timer === null) timer = window.setInterval(() => {
      if (!parked(state())) close(false);
    }, 250);
    return true;
  }
  function close(restoreFocus = true) {
    stopVoice(); window.speechSynthesis?.cancel();
    opened = false; draft = ''; clearChoices(); stopWatch(); paint();
    if (restoreFocus && trigger?.isConnected) trigger.focus({preventScroll:true});
  }
  function stopVoice(){ const r=recognition; recognition=null; listening=false; if(r){r.onend=r.onerror=r.onresult=null;try{r.abort()}catch{}} }
  function speak(text){if(mountTarget!=='center'||!window.speechSynthesis||!window.SpeechSynthesisUtterance)return;window.speechSynthesis.cancel();const u=new window.SpeechSynthesisUtterance(text);u.lang='ko-KR';u.rate=1.05;window.speechSynthesis.speak(u)}
  function voiceCommand(text){
    if(!opened||!parked(state()))return;
    if(/^(취소|취소해|취소해줘)[.! ]*$/.test(text)){clearChoices();paint();speak('취소했습니다.');return;}
    if(/^(적용|적용해|적용해줘|확인|네|보류해줘)[.! ]*$/.test(text)){
      if(pendingDefer){confirmDefer();speak(messages.at(-1)?.text||'');return;}
      if(selected){confirm();speak(messages.at(-1)?.text||'');return;}
    }
    const index=/첫|1번|일 번/.test(text)?0:/두 번째|두번째|2번|이 번/.test(text)?1:-1;
    if(index>=0&&choices[index]&&fingerprint(state())===offeredState){selected=choices[index].id;paint();speak('선택했습니다. 적용하려면 적용해줘라고 말씀하세요.');return;}
    answer(text);
  }
  function startVoice(){
    if(!opened||!parked(state()))return;
    if(listening){stopVoice();voiceStatus='음성 입력을 중지했습니다';paint();return;}
    const R=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!R){voiceStatus='이 브라우저는 음성 인식을 지원하지 않습니다';paint();return;}
    window.speechSynthesis?.cancel();const r=new R();recognition=r;r.lang='ko-KR';r.continuous=false;r.interimResults=true;
    voiceStatus='마이크 연결 중';paint();
    r.onstart=()=>{if(recognition!==r)return;listening=true;voiceStatus='듣고 있습니다';paint()};
    r.onresult=e=>{if(recognition!==r||!opened||!parked(state()))return;let text='';let final=false;for(let i=e.resultIndex;i<e.results.length;i++){text+=e.results[i][0].transcript;final=final||e.results[i].isFinal}voiceStatus=text||'듣고 있습니다';paint();if(final){stopVoice();voiceStatus='인식 완료';voiceCommand(text.trim())}};
    r.onerror=e=>{if(recognition!==r)return;const errors={'not-allowed':'마이크 권한을 허용해 주세요','service-not-allowed':'음성 인식 서비스를 사용할 수 없습니다','audio-capture':'마이크를 찾을 수 없습니다','no-speech':'음성이 들리지 않았습니다. 다시 말씀해 주세요','network':'연결을 확인한 뒤 다시 시도해 주세요','language-not-supported':'한국어 음성 인식을 사용할 수 없습니다'};voiceStatus=errors[e.error]||'음성 인식을 다시 시작해 주세요';stopVoice();paint()};
    r.onend=()=>{if(recognition!==r)return;recognition=null;listening=false;if(voiceStatus==='듣고 있습니다'||voiceStatus==='마이크 연결 중')voiceStatus='다시 말씀해 주세요';paint()};
    try{r.start()}catch{stopVoice();voiceStatus='음성 입력을 시작하지 못했습니다';paint()}
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stopVoice();window.speechSynthesis?.cancel();voiceStatus='마이크를 눌러 말씀하세요';paint()}});
  window.addEventListener('pagehide',()=>stopVoice());
  function answer(text) {
    const s = safeState();
    if (!opened || !parked(s) || busy) { paint(); return; }
    text = String(text).trim().slice(0,240);
    if (!text) return;
    draft = ''; clearChoices(); messages.push({role:'user',text});
    const entries = s.day?.assignmentsReady === false ? [] : Object.entries(s.items || {});
    let response;
    if (/사진|전송|증빙/.test(text)) {
      const records = entries.filter(([,i]) => i.proof && i.transmission !== 'received');
      const status = {queued:'전송 대기',sending:'전송 중',error:'전송 실패',unknown:'수신 확인 중',unsubmitted:'미제출'};
      response = records.length ? `수신 확인이 없는 저장 증빙 ${records.length}건이 있어요.\n` + records.map(([id,i]) => {
        const p = engine()?.parcels?.[id];
        return `${p ? `${stopName(p.stop)} ${p.unit}호 · ` : ''}${p?.waybill || id} · ${i.proof.kind === 'demo' ? '시연 증빙' : '사진'} · ${status[i.transmission] || '전송 상태 미확인'}`;
      }).join('\n') + '\n사진 원본은 휴대폰의 기록에서 확인하세요.' : '현재 구간에 수신 확인을 기다리는 저장 증빙이 없어요.';
    } else if (/충전|배터리|복귀/.test(text)) {
      let v; try { v = window.NextVehicle?.getState?.(); } catch { v = null; }
      const soc = Number.isFinite(v?.soc) && v.soc >= 0 && v.soc <= 100 ? `${v.soc}%` : '미확인';
      const range = Number.isFinite(v?.rangeKm) && v.rangeKm >= 0 ? `${v.rangeKm}km` : '미확인';
      response = `배터리 ${soc} · 주행 가능 ${range}.\n${s.day?.returnRequired === true ? '거점 복귀 필요' : s.day?.returnRequired === false ? '거점 복귀 선택' : '복귀 설정 미확인'}. 충전 필요 여부는 에너지 예측 정보가 없어 판단할 수 없어요.`;
    } else if (/순서|경로|추천|진입|미뤄|미루|보류/.test(text)) {
      const blocked = entries.filter(([,i]) => i.result === 'pending' && i.deferred);
      const pending = entries.filter(([,i]) => i.result === 'pending');
      choices = routes(s); offeredState = fingerprint(s);
      const deferIntent = /진입|미뤄|미루|보류/.test(text);
      if (deferIntent) {
        const id = s.selected, item = s.items?.[id], parcel = engine()?.parcels?.[id];
        choices = [];
        if (s.phase === 'work' && s.day?.stage === 'delivery' && item?.result === 'pending' && !item.deferred && item.correction?.status !== 'pending' && parcel) {
          pendingDefer = {id, label:`현재 ${parcel.unit}호 · 운송장 ${parcel.waybill || id} 보류`};
          response = '현재 배송을 진입 불가로 보류할까요?';
        } else response = `보류된 배송 ${blocked.length}건입니다. 배송 중인 미처리 건을 선택하면 보류할 수 있어요.`;
      } else response = `남은 배송 ${pending.length}건입니다. ${choices.length ? choices.map((r,i)=>`${i+1}번, ${r.stops.map(stopName).join(' 다음 ')}.`).join(' ') + ' 첫 번째 또는 두 번째라고 말씀하세요.' : '적용할 방문 순서가 없습니다.'}`;
    } else response = '남은 배송 순서, 진입이 어려운 배송, 복귀 전 충전 확인, 전송 대기 사진을 도와드릴 수 있어요. 다시 요청해 주세요.';
    messages.push({role:'assistant',text:response}); messages = messages.slice(-12); paint(true); speak(response);
  }
  function confirm() {
    let s = safeState();
    if (!opened || !parked(s) || busy || !selected) { paint(); return; }
    if (fingerprint(s) !== offeredState || !routes(s).some(r => r.id === selected)) {
      clearChoices(); messages.push({role:'assistant',text:'배송 상태가 바뀌었어요. 남은 배송 순서를 다시 물어봐 주세요.'}); paint(); return;
    }
    const routeId = selected; busy = true;
    let message;
    try {
      const dispatch = window.NextApp?.dispatch;
      if (typeof dispatch !== 'function') {
        window.dispatchEvent(new CustomEvent('next-ai-route', {detail:{routeId}}));
        message = '선택한 순서를 전달했어요. 경로 적용 결과는 차량 화면에서 확인해 주세요.';
      } else {
        if (s.day.stage !== 'planning' && dispatch('dayPlan') !== true) throw new Error('plan');
        s = state();
        if (!parked(s) || s.day?.stage !== 'planning') throw new Error('state');
        if (s.day.candidateId !== routeId && dispatch('dayChoose',{routeId}) !== true) throw new Error('choose');
        s = state();
        if (!parked(s) || s.day?.candidateId !== routeId || dispatch('dayStart') !== true) throw new Error('start');
        s = state();
        if (s.day?.routeId !== routeId || s.day?.stage !== 'delivery') throw new Error('result');
        message = '선택한 방문 순서를 적용했어요. 차량 목적지를 확인해 주세요.';
      }
    } catch { message = '경로 적용을 완료하지 못했어요. 저장 상태와 남은 업무를 확인한 뒤 다시 시도해 주세요.'; }
    finally { busy = false; clearChoices(); messages.push({role:'assistant',text:message}); paint(); }
  }
  function confirmDefer() {
    const s = safeState(), request = pendingDefer;
    if (!opened || !parked(s) || busy || !request) { paint(); return; }
    if (fingerprint(s) !== offeredState || s.selected !== request.id || s.phase !== 'work' || s.day?.stage !== 'delivery' || s.items?.[request.id]?.result !== 'pending' || s.items[request.id].deferred || s.items[request.id].correction?.status === 'pending') {
      clearChoices(); messages.push({role:'assistant',text:'배송 상태가 바뀌었어요. 다시 요청해 주세요.'}); paint(); return;
    }
    busy = true;
    let ok = false;
    try { ok = window.NextApp?.dispatch?.('defer',{id:request.id,reason:'진입 불가'}) === true && state()?.items?.[request.id]?.deferred === true; } catch {}
    busy = false; clearChoices();
    messages.push({role:'assistant',text:ok ? '현재 배송을 진입 불가로 보류했어요.' : '보류하지 못했어요. 저장 상태를 확인해 주세요.'}); paint();
  }
  document.addEventListener('click', event => {
    const b = event.target.closest?.('[data-next-ai-open], [data-nda-action]');
    if (!b || b.disabled) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (b.hasAttribute('data-next-ai-open')) { open(b.closest('#phone') ? 'phone' : 'center'); return; }
    if (!b.closest('[data-next-ai-host]')) return;
    if (b.dataset.ndaAction === 'close') { close(); return; }
    if (!parked(safeState())) { paint(); return; }
    switch (b.dataset.ndaAction) {
      case 'voice': startVoice(); break;
      case 'prompt': if (prompts[b.dataset.ndaPrompt]) answer(prompts[b.dataset.ndaPrompt]); break;
      case 'choose':
        if (fingerprint(state()) !== offeredState) { clearChoices(); messages.push({role:'assistant',text:'배송 상태가 바뀌었어요. 순서를 다시 요청해 주세요.'}); }
        else if (choices.some(r => r.id === b.dataset.ndaRoute)) selected = b.dataset.ndaRoute;
        paint(); document.querySelector('[data-nda-action="confirm"]')?.focus({preventScroll:true}); break;
      case 'cancel': clearChoices(); paint(true); break;
      case 'deferConfirm': confirmDefer(); break;
      case 'confirm': confirm(); break;
    }
  }, true);
  document.addEventListener('input', e => { if (e.target.matches?.('.nda-form input')) draft = e.target.value; });
  document.addEventListener('submit', e => {
    if (!e.target.matches?.('.nda-form')) return;
    e.preventDefault(); e.stopImmediatePropagation(); answer(e.target.elements.question.value);
  }, true);
  document.addEventListener('keydown', e => {
    if (!opened || e.key !== 'Escape') return;
    e.preventDefault(); e.stopImmediatePropagation(); close();
  }, true);
  window.NextDeliveryAssistant = Object.freeze({render,open,close,icon});
})();
