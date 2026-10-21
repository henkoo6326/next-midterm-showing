/* NEXT post-loading prototype. Local records are real; vehicle/map/server responses are demonstrations. */
(()=>{'use strict';
const E=(document.body.dataset.app==='delivery'&&window.NextDay)||window.NextPostload,$=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const DIRECTION=/^[a-e]$/.test(document.body.dataset.direction||'')?document.body.dataset.direction:'a';
const MAIN=document.body.dataset.app==='delivery';
const AUTOPLAY=MAIN&&typeof URLSearchParams!=='undefined'&&typeof location!=='undefined'&&new URLSearchParams(location.search).get('autoplay')==='1';
const COMPARE=MAIN&&typeof URLSearchParams!=='undefined'&&typeof location!=='undefined'&&new URLSearchParams(location.search).get('preview');
const PREVIEW=['drive','park','plan','boarding'].includes(COMPARE)?COMPARE:null;
const KEY=AUTOPLAY?'next-autoplay-readonly':PREVIEW?'next-design-preview-v1-'+PREVIEW:MAIN?'next-postload-v4':'next-directions-v1-'+DIRECTION,DB=PREVIEW?'next-design-preview-photos-v1':MAIN?'next-postload-photos-v1':'next-directions-photos-v1';
const NIGHT_KEY=MAIN?'next-night':'next-directions-night-'+DIRECTION;
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const btn=(action,text,cls='primary',extra='')=>`<button class="${cls}" data-action="${action}" ${extra}>${text}</button>`;
const ids=Object.keys(E.parcels),par=id=>E.parcels[id],stop=id=>E.stops.find(x=>x.id===id);
const shipmentLabel=id=>par(id)?'운송장 '+par(id).waybill:String(id??'');
const publicText=text=>String(text??'').replace(/\b[A-Z]-\d{3}\b/g,id=>par(id)?shipmentLabel(id):id);
const publicMarkup=html=>String(html).replaceAll('성수 리버파크',esc(stop(state.vehicle==='moving'?state.destination:par(state.selected).stop)?.area||'배송 구역')).replace(/(^|>)([^<]+)(?=<|$)/g,(_,edge,text)=>edge+publicText(text));
const siblingIds=id=>ids.filter(other=>par(other).stop===par(id).stop&&par(other).unit===par(id).unit);

let state=E.create(),rawSeen=null,recoveryRaw=null,fieldError='',ui='list',filter='pending',centerStop='104',modalStream=null,photoTarget=null,photoBusy=false,photoEpoch=0,mediaEpoch=0,stagedPhoto=null,stagedUrl=null,failSave=false,failPhoto=false,ready=false,renderVersion=0,urls=new Map();
try{rawSeen=AUTOPLAY?null:localStorage.getItem(KEY);if(rawSeen){const restored=E.restore(rawSeen);if(restored)state=restored;else recoveryRaw=rawSeen}if(localStorage.getItem(NIGHT_KEY)==='true')document.body.dataset.night='true'}catch{recoveryRaw='storage unavailable'}
if(PREVIEW&&!rawSeen){if(PREVIEW!=='boarding')state=E.reduce(state,{type:'dayPlan'});if(['drive','park'].includes(PREVIEW))state=E.reduce(state,{type:'dayStart'});if(['drive','park'].includes(PREVIEW))state=E.reduce(state,{type:'drive'});if(PREVIEW==='park')state=E.reduce(state,{type:'park'});}
centerStop=par(state.preview||state.selected).stop;if(state.phase==='work')ui='detail';
let centerFollowedParcel=state.selected;
// Live lock is independent of durable parcel records. Stored parked snapshots
// cannot release it; only an explicit parked signal that persists may do so.
let vehicleLock=null,vehiclePersistenceBlocked=false;
const vehicleSaveError='차량 상태를 저장하지 못했습니다. 화면 잠금은 적용했습니다. 물품 기록은 보존하며, 정차 복구가 저장될 때까지 기록 변경을 차단합니다.';
const withVehicleLock=s=>vehicleLock?{...s,vehicle:vehicleLock}:s;
let renderedPhoneKey=null,renderedCenterKey=null,advanceReadyAt=0;
function guardAdvance(){
 advanceReadyAt=Date.now()+700;
 // Unlock only result/defer controls; never rerender on timer completion.
 setTimeout(()=>{if(Date.now()>=advanceReadyAt)$$('#phone [data-action]').filter(el=>['resultAndNext','defer','result'].includes(el.dataset.action)).forEach(el=>{el.disabled=state.items[el.dataset.id]?.correction?.status==='pending'})},700);
}
const phoneKey=()=>[ready,state.vehicle,state.phase,ui,ui==='detail'?state.selected:filter].join(':');
function renderPhone(){
 const key=phoneKey(),same=key===renderedPhoneKey,body=$('#phone .p-body'),active=document.activeElement;
 const hadFocus=$('#phone').contains(active),focusData=hadFocus&&active?.dataset.action?JSON.stringify(active.dataset):null;
 const scroll=same&&body?body.scrollTop:0;
 const mobileContext=variantContext('phone');
 const legacyPhoneHTML=phone();
 const mobilePhoneHTML=window.NextMobile?window.NextMobile.render(mobileContext,legacyPhoneHTML):legacyPhoneHTML;
 $('#phone').innerHTML=publicMarkup(mobilePhoneHTML);
 window.NEXT_VARIANTS?.[DIRECTION]?.phone?.(mobileContext);
 window.NextMobile?.decorate(mobileContext);
 renderedPhoneKey=key;
 const nextBody=$('#phone .p-body');
 if(hadFocus){const control=same&&focusData?$$('#phone [data-action]').find(el=>!el.disabled&&JSON.stringify(el.dataset)===focusData):null;(control||nextBody)?.focus({preventScroll:true})}
 if(nextBody)nextBody.scrollTop=scroll;
}
function renderCenter(){
 if(state.selected!==centerFollowedParcel){if(!state.preview)centerStop=par(state.selected).stop;centerFollowedParcel=state.selected}
 const key=[ready,state.vehicle,state.phase,state.preview||state.selected,centerStop].join(':'),same=key===renderedCenterKey;
 const active=document.activeElement,hadFocus=$('#center').contains(active),focusData=hadFocus&&active?.dataset.action?JSON.stringify(active.dataset):null;
 const regions=['.c-primary','.c-side','.c-review > div:last-child'];
 const scroll=regions.map(selector=>same?($('#center '+selector)?.scrollTop||0):0);
 $('#center').innerHTML=publicMarkup(variantRender('center',center));renderedCenterKey=key;if(state.vehicle!=='parked')$$('#center a').forEach(a=>{a.removeAttribute('href');a.setAttribute('aria-disabled','true');a.setAttribute('tabindex','-1')});
 if(hadFocus){const control=same&&focusData?$$('#center [data-action]').find(el=>!el.disabled&&JSON.stringify(el.dataset)===focusData):null;(control||$('#center .c-body'))?.focus({preventScroll:true})}
 regions.forEach((selector,index)=>{const el=$('#center '+selector);if(el)el.scrollTop=scroll[index]});
}
function savedResultShortcut(){
 const entry=state.history.slice().reverse().find(h=>['resultAndNext','defer'].includes(h.type)&&par(h.id));
 if(!entry)return '';
 if(entry.type==='defer')return state.items[entry.id].deferred?`<div class="undo-strip"><span>직전 보류 · ${par(entry.id).unit}호<br>${esc(shipmentLabel(entry.id))}</span>${btn('resumeDeferred','다시 배송','text-action',`data-id="${entry.id}"`)}</div>`:'';
 if(state.items[entry.id].result!=='delivered')return '';
 const id=entry.id,pending=state.items[id].correction?.status==='pending';
 return `<div class="undo-strip"><span>직전 저장 · ${par(id).unit}호<br>${esc(shipmentLabel(id))}</span>${btn('correctSaved',pending?'정정 요청 중':'결과 정정','text-action',`data-id="${id}" ${pending?'disabled':''}`)}</div>`;
}
const nextWorkLabel=()=>ids.some(id=>id!==state.selected&&state.items[id].result==='pending'&&!state.items[id].deferred)?'전달 저장 · 다음 배송':'전달 저장 · 마지막 검토';
const resultText=i=>i.result==='delivered'?'전달 기록 저장됨':i.result==='undelivered'?'미전달 기록 저장됨':i.deferred?'나중에 배송':'배송 대기';
const txText=i=>({unsubmitted:'미제출',queued:state.online?'전송 대기':'오프라인 · 전송 대기',sending:'전송 중 · 시연',unknown:'수신 확인 중 · 시연',received:'배송사 수신 · 시연',error:'전송 실패 · 시연'})[i.transmission];
const phaseText=()=>state.day?(window.NextDayUI?.stages[state.day.stage]||'배송 작업'):state.phase==='assignment'?'상차 후 배정 확인':state.phase==='review'?'마지막 검토':state.phase==='saved'?'저장한 기록':state.vehicle==='moving'?'주행 안내':state.vehicle==='unknown'?'차량 상태 미확인':'배송 작업';
function say(text){$('#announcement').textContent=publicText(text);$('#announcement').classList.add('show');clearTimeout(say.timer);say.timer=setTimeout(()=>$('#announcement').classList.remove('show'),3500)}
const photoToken=id=>({id,revision:state.items[id].revision,correction:JSON.stringify(state.items[id].correction),epoch:photoEpoch});
const tokenValid=t=>t&&t.id===state.selected&&t.revision===state.items[t.id].revision&&t.correction===JSON.stringify(state.items[t.id].correction)&&t.epoch===photoEpoch&&state.vehicle==='parked'&&state.phase==='work';
function modalFeedback(text){text=publicText(text);if(!$('#modal').open)return false;const error=$('#modal .modal-error');if(!error)return false;error.hidden=false;error.setAttribute('role','alert');error.textContent=text;return true}
function feedback(text){if(!modalFeedback(text))say(text)}
function storageError(text){modalFeedback(text);fieldError=text;text=publicText(text);const local=$('#phone .p-error');if(local){local.hidden=false;local.textContent=text}$('#storage-error').hidden=false;$('#storage-error').textContent=text}
function persist(next){if(recoveryRaw){storageError('기존 기록을 읽을 수 없습니다. 원본을 보존했습니다. 시연 제어에서 원본을 내려받은 뒤 새 시연을 시작하세요.');return false}
try{const latest=localStorage.getItem(KEY);if(latest!==rawSeen){const restored=latest&&E.restore(latest);if(restored){photoEpoch++;state=withVehicleLock(restored);rawSeen=latest;closeModal();render();say('다른 창의 최신 기록을 불러왔습니다. 변경 내용을 확인한 뒤 다시 선택하세요.')}else storageError('다른 창의 기록을 확인하지 못했습니다. 이번 변경은 저장하지 않았습니다.');return false}if(failSave){failSave=false;throw Error('simulated storage failure')}const raw=JSON.stringify(next);localStorage.setItem(KEY,raw);rawSeen=raw;fieldError='';$('#storage-error').hidden=true;return true}catch{storageError('기록 저장 실패. 이전 기록은 유지됩니다. 같은 작업을 다시 시도하세요.');return false}}
function dispatch(type,extra={}){
 if(AUTOPLAY)return false;
 const next=E.reduce(state,{type,...extra});
 const unsafeSignal=(type==='vehicle'&&['moving','unknown'].includes(extra.value)&&next.vehicle===extra.value)||(['drive','dayReturnDrive'].includes(type)&&next.vehicle==='moving');
 const parkedSignal=(type==='park'||type==='dayReturnPark'||(type==='vehicle'&&extra.value==='parked'))&&next.vehicle==='parked';
 if(!ready&&type!=='proofMissing'&&!unsafeSignal&&!(parkedSignal&&vehicleLock))return false;
 if(vehiclePersistenceBlocked&&!unsafeSignal&&!parkedSignal&&type!=='proofMissing'){storageError(vehicleSaveError);return false}
 if(JSON.stringify(next)===JSON.stringify(state)&&!unsafeSignal)return false;
 if(unsafeSignal){
  vehicleLock=next.vehicle;state=withVehicleLock(state);
  photoEpoch++;closeModal();render();
 }
 if(!persist(next)){
  if(unsafeSignal||(parkedSignal&&vehicleLock)){
   vehiclePersistenceBlocked=true;state=withVehicleLock(state);closeModal();render();storageError(vehicleSaveError);
  }
  return false;
 }
 if(parkedSignal){vehicleLock=null;vehiclePersistenceBlocked=false}
 else if(unsafeSignal)vehiclePersistenceBlocked=false;
 // Invalidate work across a vehicle/parcel/phase boundary, including an eventual
 // return to the same parked parcel. Current-state checks alone miss that race.
 const contextChanged=state.vehicle!==next.vehicle||state.selected!==next.selected||state.phase!==next.phase||state.day?.stage!==next.day?.stage;
 state=withVehicleLock(next);if(contextChanged){photoEpoch++;closeModal()}render();return true;
}
function fit(){$$('.screen-window').forEach(el=>{const w=+el.dataset.width,h=+el.dataset.height;el.style.height=el.clientWidth*h/w+'px';el.firstElementChild.style.transform=`scale(${el.clientWidth/w})`});window.NextMap?.decorate?.()}
function row(id,action='open'){const p=par(id),i=state.items[id];return `<button class="delivery-row ${i.result!=='pending'?'done':''}" data-action="${action}" data-id="${id}"><span><strong>${p.unit}호</strong><small>${esc(shipmentLabel(id))}</small><span class="row-request">${esc(p.request)}</span></span><span class="row-tail ${i.deferred?'warning-text':''}">${resultText(i)}${i.result!=='pending'?'<br>'+txText(i):i.reason?'<br>'+esc(i.reason):''}</span><span class="arrow">›</span></button>`}
function groups(list){return E.stops.map(st=>{const group=list.filter(id=>par(id).stop===st.id);return group.length?`<div class="group-heading"><b>${st.name}</b><span>${group.length}개</span></div>${group.map(id=>row(id)).join('')}`:''}).join('')}
function statusLine(i){return `<div class="status-line ${i.result!=='pending'?'ok':''}"><span class="status-mark">${i.result!=='pending'?'✓':'○'}</span>${resultText(i)}</div>${i.result!=='pending'?`<div class="status-line ${i.transmission==='received'?'ok':i.transmission==='error'?'error':'warn'}"><span class="status-mark">${i.transmission==='received'?'✓':'↥'}</span>${txText(i)}</div>`:''}`}
function reviewItems({readOnly=false}={}){return E.review(state).map(r=>{const summary=`<strong>${par(r.id).stop}동 ${par(r.id).unit}호 · ${esc(shipmentLabel(r.id))}</strong><span class="issues">${r.issues.map(esc).join(' · ')}</span>`;return `<div class="review-item${readOnly?' review-summary':''}">${readOnly?summary:btn('open',summary,'',`data-id="${r.id}"`)}</div>`}).join('')}
function hmiIcon(name,cls=''){if(window.NextIcons){if(['turn','straight'].includes(name)&&window.NextNotifications)return window.NextNotifications.arrow(name==='straight'?'straight':cls.includes('left')?'left':'right','hmi-icon');return window.NextIcons.icon(({entry:'entrance',link:'network'})[name]||name,'filled',{decorative:true});}const paths={straight:'<path d="M18 32V4M7 15 18 4 29 15"/>',turn:'<path d="M7 31V15a5 5 0 0 1 5-5h18M22 2l8 8-8 8"/>',entry:'<path d="M15 29h15V5H15v7M3 18h20m-6-6 6 6-6 6"/>',route:'<path d="M9 30V11a5 5 0 0 1 5-5h13M22 1l5 5-5 5"/><circle cx="9" cy="30" r="3"/>',battery:'<rect x="3" y="10" width="27" height="16" rx="2"/><path d="M33 15v6M8 14h16v8H8Z"/>',camera:'<path d="M3 11h8l3-5h9l3 5h7v20H3Z"/><circle cx="18" cy="21" r="6"/>',alert:'<path d="m18 3 16 28H2Z"/><path d="M18 12v8m0 5v1"/>',check:'<path d="m7 18 7 7L29 9"/>',pin:'<path d="M28 13c0 8-10 18-10 18S8 21 8 13a10 10 0 0 1 20 0Z"/><circle cx="18" cy="13" r="3"/>',link:'<path d="m15 12 5-5a7 7 0 0 1 10 10l-5 5M21 24l-5 5A7 7 0 0 1 6 19l5-5m1 10 12-12"/>'};return `<svg class="hmi-icon ${cls}" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.pin}</svg>`}
function siteMap(target=state.destination,moving=false){return window.NextMap?.render?.({theme:document.body.dataset.night==='true'?'dark':'light',target,mode:moving?'drive':'overview',unknown:state.vehicle==='unknown'})||'<div class="nx-map-error">지도를 불러오지 못했습니다.</div>'}
function mapView(){const nav=window.NextMap?.navigation?.(state.destination)||{distance:'—',turn:null,label:'지도 확인 필요'};return `<div class="map driving-map"><div class="driving-map-canvas">${siteMap(state.destination,true)}</div><div class="map-hud"><span class="nav-kicker">다음 안내</span>${hmiIcon(nav.turn?nav.turn==='straight'?'straight':'turn':'alert',nav.turn==='left'?'turn-left':'')}<strong>${nav.distance}<small>m</small></strong><p>${nav.label} · ${state.destination}동</p></div><div class="map-destination"><span class="nav-kicker">목적지</span><strong>성수 리버파크 ${state.destination}동</strong></div><span class="nx-map-credit">© OpenStreetMap contributors</span></div>`}

function center(){if(!ready)return '<div class="center-hero"><div><h2>저장 기록 확인 중</h2><p>기록과 사진이 확인되면 작업을 열 수 있습니다.</p></div></div>';const s=state,c=E.counts(s),moving=s.vehicle==='moving',unknown=s.vehicle==='unknown',chosen=s.preview||s.selected,p=par(chosen),i=s.items[chosen];let body='';
if(moving)body=mapView();else if(['review','saved'].includes(s.phase)){body=`<div class="c-review"><div><p class="eyebrow">마지막 검토</p><h2>${s.phase==='saved'?'기록 저장됨':'확인 필요'}</h2><div class="big-number">${E.review(s).length}<small style="font-size:32px;letter-spacing:0">개</small></div><p class="helper">전달 기록 ${c.delivered} / ${ids.length}개<br>배송사 마감과 별개입니다.<br>수정은 폰에서</p></div><div style="overflow:auto">${reviewItems({readOnly:true})||'<h2>목록 검토 완료</h2><p class="helper">수신·인계는 시연 응답입니다.</p>'}</div></div>`}
else{body=`<div class="c-plan"><div class="c-side"><div class="site-overview"><div class="site-caption"><strong>${p.stop}동 위치</strong><span>가상 단지</span></div>${siteMap(p.stop)}<div class="site-legend"><span class="vehicle-line">차량 경로</span><span class="walk-line">보행 연결 예시</span><small>정차 위치 예시 · 주차 가능 여부 미확인</small></div></div><div class="c-deliveries"><div class="c-list-heading"><div class="switcher">${E.stops.map(st=>btn('centerStop',st.name,centerStop===st.id?'active':'',`data-stop="${st.id}"`)).join('')}</div><span>물품 미리보기</span></div><div class="c-list">${ids.filter(id=>par(id).stop===centerStop).map(id=>`<button class="c-item ${chosen===id?'active':''}" data-action="preview" data-id="${id}"><strong>${par(id).unit}<small>호</small></strong><span class="c-item-id">${id}</span><span class="status ${s.items[id].deferred?'warn':''}">${resultText(s.items[id])}</span><span class="row-chevron">›</span></button>`).join('')}</div></div></div><div class="c-primary"><div class="c-context"><span class="context-label">${s.preview?'센터 미리보기':'폰의 현재 배송'}</span>${s.preview?btn('clearPreview','폰 작업 보기','text-action'):hmiIcon('link')}</div><div class="c-address"><p class="eyebrow">${p.stop}<span>동</span></p><h2>${p.unit}<small>호</small></h2><p class="p-id">${p.id}</p><figure class="c-parcel"><img src="${p.asset}" alt="로우폴리 포장 유형 예시"><figcaption>포장 유형 예시</figcaption></figure></div><div class="c-request"><span class="detail-label">전달 요청</span><p class="request">${esc(p.request)}</p></div><div class="entry">${hmiIcon('entry')}<div><span class="detail-label">입구</span><strong>${stop(p.stop).entrance||'등록된 정보 없음'}</strong><small>${p.stop==='104'?'시연용 건물 안내 · 2026.10.18':'현장 안내와 고객 요청을 확인하세요.'}</small></div></div><div class="c-record"><p class="waybill">운송장 ${esc(p.waybill)}</p>${statusLine(i)}</div>${unknown?'<p class="readonly-note">차량 상태 미확인 · 미리보기만 가능</p>':centerStop!==s.destination?btn('destination',centerStop+'동으로 목적지 변경','secondary',`data-stop="${centerStop}" data-source="center" ${s.phase==='assignment'?'disabled':''}`):''}${s.notice?`<p class="notice">${esc(s.notice)}</p>`:''}</div></div>`}
return `<header class="c-top"><span class="gear-pill">${moving?'D':unknown?'—':'P'}</span><strong>성수 리버파크</strong><span class="c-mode">${moving?'주행 안내':unknown?'차량 상태 미확인':'정차'}</span><div class="right"><span class="connection-mark ${s.online?'':'is-offline'}"></span><span>${s.online?'연결됨':'오프라인'}</span><span class="c-time">09:41</span></div></header><div class="c-body" tabindex="-1">${body}</div><footer class="c-bottom"><span>${hmiIcon('pin')}목적지 ${s.destination}동</span><span class="c-preview-note">${moving?'주행 중 배송 입력 잠금':s.preview?'센터 미리보기 · 폰 작업 유지':'배송 기록은 폰에서'}</span><strong>NEXT ↗</strong></footer>`}
function cluster(){if(!ready)return '<div class="cluster-loading"><strong>—</strong><p>차량·배송 기록 확인 중</p></div>';const nav=window.NextMap?.navigation?.(state.destination)||{distance:'—',turn:null,label:'지도 확인 필요'};const moving=state.vehicle==='moving',unknown=state.vehicle==='unknown',gear=unknown?'—':moving?'D':'P';return `<div class="cl-top"><span class="cl-location">성수 리버파크 <b>${state.destination}동</b></span><span>09:41</span></div><div class="cl-main"><div class="cl-speed"><strong>${unknown?'—':moving?'24':'0'}</strong><small>km/h</small><div class="cl-gear" aria-label="현재 기어 ${gear}">${['P','R','N','D'].map(g=>`<span class="${g===gear?'selected':''}">${g}</span>`).join('')}</div></div><div class="cl-direction"><span class="cl-nav-label">${unknown?'차량 연결':moving?'다음 안내':'차량 상태'}</span><div class="cl-turn-content">${unknown?'<span class="cl-park-symbol">—</span>':moving?hmiIcon(nav.turn?nav.turn==='straight'?'straight':'turn':'alert',nav.turn==='left'?'turn-left':''):'<span class="cl-park-symbol">P</span>'}<div><h2>${unknown?'확인 필요':moving?nav.distance:'정차'}${moving?'<small>m</small>':''}</h2><p>${unknown?'차량 상태 미확인':moving?nav.label+' · '+state.destination+'동':'다음 목적지 '+state.destination+'동'}</p></div></div></div></div><div class="cl-bottom"><span class="cl-battery">${hmiIcon('battery')}<b>${unknown?'—':'78'}<small>%</small></b></span><span class="battery-bar ${unknown?'is-unknown':''}"></span><span>주행 가능 <b>${unknown?'—':'214'}</b> km</span><span class="right">${unknown?'—':'22'}°C</span></div>`}
function phone(){const dayView=window.NextDayUI?.render('phone',variantContext('phone'));if(dayView!=null)return dayView;const s=state,p=par(s.selected),i=s.items[s.selected],c=E.counts(s);let body='',actions='',top='성수 리버파크';
if(!ready){body='<div class="phone-lock"><strong>저장 기록 확인 중</strong><p>사진과 배송 기록을 불러옵니다.</p></div>'}
else if(s.vehicle!=='parked'){body=`<div class="phone-lock"><span class="lock-icon">${s.vehicle==='moving'?hmiIcon('vehicle'):hmiIcon('alert')}</span><strong>${s.vehicle==='moving'?'주행 중':'차량 상태 미확인'}</strong><p>${s.vehicle==='moving'?s.destination+'동 방향<br>정차 후 배송을 기록하세요.':'시연 제어에서 차량 연결을 복구하세요.'}</p></div>`}
else if(s.phase==='assignment'){body=`<p class="eyebrow">상차 후 · 시연 배정</p><h2 class="list-title">오늘 배송할 물품</h2><div class="big-number">4<small style="font-size:24px;letter-spacing:0">개</small></div><p class="helper">배정 자료 기준입니다.<br>확인할 배송지와 요청을 살펴보세요.</p><div class="group-heading"><b>104동</b><span>3개</span></div><p class="helper">1203호 2개 · 804호 1개</p><div class="group-heading"><b>105동</b><span>1개</span></div><p class="helper">706호 1개</p><p class="small-note">주소 확인 필요 0개 · 자료 v1<br>집하·회수 배정 없음 · 테스트 데이터</p>`;actions=btn('start','배송 목록 열기')}
else if(['review','saved'].includes(s.phase)){top='마지막 검토';body=`<p class="eyebrow">${s.phase==='saved'?'기록 저장됨':'오늘의 배송 기록'}</p><h2 class="list-title">${E.review(s).length?'확인 필요':'목록 검토 완료'}</h2><div class="review-count">${E.review(s).length}<small>개</small></div><p class="helper">전달 기록 ${c.delivered} / ${ids.length}개<br>남은 배송·사진·전송 상태를 확인하세요.</p>${reviewItems()||'<div class="empty">모든 배정의 결과가 정리됐습니다.<br>수신·인계는 시연으로 확인했습니다.</div>'}<p class="small-note">배송사 마감은 접수하지 않았습니다.<br>집하·회수·반품 인계는 별도 업무입니다.</p>${btn('records','전체 기록 보기','text-action')}`;actions=s.phase==='saved'?btn('resume','배송 작업 재개'):btn('exit','기록 저장 후 종료')+btn('list','배송 목록으로','secondary')}
else if(ui==='list'){top='배송 목록';const list=ids.filter(id=>filter==='all'||(filter==='deferred'?s.items[id].deferred:s.items[id].result==='pending'&&!s.items[id].deferred));body=`<p class="eyebrow">남은 배송</p><h2 class="list-title">${c.pending}개</h2><div class="p-tabs">${[['pending','배송 대기'],['deferred','나중에 '+c.deferred],['all','전체 기록']].map(([v,t])=>btn('filter',t,filter===v?'active':'',`data-filter="${v}"`)).join('')}</div>${groups(list)||'<div class="empty">이 목록에 남은 물품이 없습니다.</div>'}<p class="small-note">같은 호수의 배송도 운송장과 요청을 따로 표시합니다.</p>`;actions=btn('openReview','마지막 검토')}
else{top=p.stop+'동 · 현재 배송';body=`<section class="p-address"><p class="eyebrow">성수 리버파크 <b>${p.stop}동</b></p><h2>${p.unit}<small>호</small></h2><div class="request-panel"><p class="label">전달 요청</p><strong>${esc(p.request)}</strong>${s.day?'':btn('requestInfo','요청 상세','text-action')}</div></section><div class="p-shipment"><div><span class="label">운송장</span><strong>${esc(p.waybill)}</strong><span class="p-sibling-note">${siblingIds(p.id).length>1?'같은 호수 '+siblingIds(p.id).length+'건 · 이 배송의 요청과 기록':'이 호수 배송 1건'}</span></div><figure><img src="${esc(p.asset)}" alt="포장 유형 예시"><figcaption>포장 유형 예시</figcaption></figure></div>${s.day&&p.stop!==s.destination?`<div class="day-transit"><p>차량 목적지 ${s.destination}동 · 다음 배송 ${p.stop}동</p>${btn('dayNavigate',p.stop+'동 안내 시작','primary',`data-stop="${p.stop}"`)}</div>`:''}${savedResultShortcut()}<div class="inline-actions">${btn('entry',hmiIcon('entry')+'입구 안내','text-action')}${btn('exception',hmiIcon('alert')+'배송 문제','text-action')}${s.day&&p.request.includes('연락')?btn('dayContact','고객 연락','text-action'):''}</div>${i.deferred?`<div class="attention">보류 · ${esc(i.reason||'사유 없음')}</div>`:''}${statusLine(i)}${i.result==='undelivered'?`<p class="small-note">미전달 사유 · ${esc(i.reason)}</p>`:p.photoRequired?`<p class="section-label ${i.proof?'proof-saved':''}">${i.proof?(i.proof.kind==='demo'?'시연 증빙 저장됨':'사진 저장됨'):'배송 사진 필요'}</p>`:'<p class="small-note">이 배정은 사진을 요구하지 않습니다.</p>'}${i.proof?`<div class="proof-preview" data-proof-key="${esc(i.proof.key)}">${i.proof.kind==='demo'?'<strong>시연용 증빙</strong><span>실제 배송 사진이 아닙니다.</span>':'<span>저장 사진 확인 중</span>'}</div>`:!s.day&&p.photoRequired&&i.result!=='undelivered'?'<p class="warning-text">배송 사진을 저장하세요.</p>':''}${i.proof?`<div class="proof-actions">${btn('camera',i.proof?'다시 촬영':'사진 촬영','',i.correction?.status==='pending'?'disabled':'')}${btn('photo','파일 선택','',i.correction?.status==='pending'?'disabled':'')}</div>`:''}${i.correction?.status==='pending'?'<div class="attention">'+(i.correction.replacementProof?'사진 교체 요청 대기 · 현재 사진은 원본입니다.':'정정 요청 대기 · 원기록 유지')+'</div>':i.correction?.status==='rejected'?'<div class="attention">정정 거절 · 원기록 유지</div>':i.correction?.status==='accepted'?'<p class="small-note">정정 승인 · 변경 이력 보존</p>':''}${i.handoff==='pending'?'<div class="attention">미전달 물품 · 인계 확인 대기</div>'+(s.day?btn('dayHandoff','인계 상태 확인','secondary',`data-id="${p.id}"`):''):i.handoff==='done'?'<p class="small-note">인계 접수 · 시연</p>':''}${i.result!=='pending'?btn('correct',i.correction?.status==='pending'?'정정 요청 중':'배송 결과 정정','text-action',`data-id="${p.id}" ${i.correction?.status==='pending'?'disabled':''}`):''}${btn('itemHistory','이 물품의 기록','text-action')}`;
const locked=i.correction?.status==='pending',attrs=`data-id="${p.id}" ${locked?'disabled':''}`,transitionAttrs=attrs+(Date.now()<advanceReadyAt?' disabled':'');
if(s.day&&p.photoRequired&&!i.proof&&i.result!=='undelivered'){actions=btn('camera','배송 사진 촬영','primary',attrs)+`<div class="inline-actions">${btn('dayMore','사진 저장 방법','secondary',attrs)}${i.result==='pending'?btn('defer','나중에 배송','secondary',transitionAttrs):btn('next','사진 미루고 다음','secondary')}</div>`}
else if(p.photoRequired&&!i.proof&&i.result!=='undelivered'){
 actions=btn('camera','배송 사진 촬영','primary',attrs)+`<div class="inline-actions">${btn('photo','사진 파일 선택','secondary',attrs)}${i.result==='pending'?btn('result','사진 없이 전달만 기록','secondary',transitionAttrs):btn('next','사진 미루고 다음','secondary')}</div>`;
 if(i.result==='pending')actions+=btn('defer','나중에 배송','secondary',transitionAttrs);
}else actions=i.result==='pending'?btn('resultAndNext',nextWorkLabel(),'primary',`data-id="${p.id}" ${locked||Date.now()<advanceReadyAt?'disabled':''}`)+btn('defer','나중에 배송','secondary',transitionAttrs):btn('next','다음 배송')+btn('openReview','마지막 검토','secondary')}
if(ready&&s.vehicle==='parked'&&(s.phase==='review'||(s.phase==='work'&&ui==='list')))body+=savedResultShortcut();
return `<div class="p-status"><span>9:41</span><span>${s.online?'연결됨':'오프라인'} ▰</span></div><div class="p-top"><span>${top}</span>${s.phase==='work'&&s.vehicle==='parked'?btn('list','목록','text-action'):''}</div><div class="p-error" role="alert" ${fieldError?'':'hidden'}>${esc(fieldError)}</div><div class="p-body" tabindex="0">${body}</div><div class="p-actions">${actions}</div><div class="home-bar"></div>`}

function demoRouteFrom(){return state.day?(state.day.stage==='planning'?state.day.lastStop:state.day.mapOrigin)??null:'depot';}
function variantContext(kind){
 const chosen=state.preview||state.selected;
 const navigation=window.NextMap?.navigation?.(state.destination,{from:demoRouteFrom()})||{available:false,distance:'—',turn:null,label:'지도 확인 필요'};
 return {dayRoutes:E.routes?.(state),daySummary:E.summary?.(state),returnNavigation:window.NextMap?.navigation?.(state.destination,{returning:true}),state,parcel:par(chosen),item:state.items[chosen],parcels:E.parcels,stops:E.stops,ids,centerStop,ready,navigation,moving:state.vehicle==='moving',unknown:state.vehicle==='unknown',esc,btn,
 icon:(name,cls)=>hmiIcon(navigation.available===false&&['turn','straight'].includes(name)?'alert':name,cls),
 mapControls:()=>window.NextMap?.controls?.()||'',
 map:options=>window.NextMap?.render?.({...options,from:demoRouteFrom(),parkedTarget:state.phase==='work'&&state.vehicle==='parked'&&!options.itinerary&&!options.returning,zoom:kind==='center'&&state.vehicle==='parked'?window.NextMap.zoom:1,moving:state.vehicle==='moving',unknown:state.vehicle==='unknown'})||'<div class="nx-map-error" role="status"><strong>지도를 불러오지 못했습니다.</strong><span>배송 주소와 요청은 확인할 수 있습니다.</span></div>',
 statusLine,resultText,txText,reviewItems,counts:E.counts(state),defaultCenter:center,defaultCluster:cluster};
}
function variantRender(kind,fallback){const dayView=window.NextDayUI?.render(kind,variantContext(kind));if(dayView!=null)return dayView;const fn=window.NEXT_VARIANTS?.[DIRECTION]?.[kind];return fn?fn(variantContext(kind)):fallback();}

function render(){renderVersion++;renderCenter();renderPhone();$('#cluster').innerHTML=variantRender('cluster',cluster);$$('#cluster a').forEach(a=>{a.removeAttribute('href');a.setAttribute('tabindex','-1')});$('#center-stage').textContent=phaseText();$('#phone-stage').textContent=phaseText();$('#total-count').textContent=E.counts(state).delivered+' / '+ids.length;$('#arrive-demo').textContent=state.vehicle==='moving'?'정차 시연':'주행 시연';$('#arrive-demo').disabled=(state.phase!=='work'&&state.day?.stage!=='returning')||state.vehicle==='unknown';if(state.day?.stage==='returning')$('#arrive-demo').textContent=state.vehicle==='moving'?'복귀 도착 · 정차 시연':'복귀 주행 시연';$('#network-demo').textContent=state.online?'오프라인 시연':'온라인 복귀';$('#network-demo').setAttribute('aria-pressed',String(!state.online));$('#night-demo').setAttribute('aria-pressed',String(document.body.dataset.night==='true'));$('#history').innerHTML=state.history.slice().reverse().map(x=>`<li>${x.at?esc(new Date(x.at).toLocaleTimeString('ko-KR',{hour12:false})):''} · ${x.id?esc(shipmentLabel(x.id))+' · ':''}${esc(publicText(x.text||x.type))}</li>`).join('')||'<li>배정 목록을 열면 기록을 시작합니다.</li>';$('#persistence-label').textContent='배송 결과·사진은 이 브라우저에 저장됩니다. 다른 기기와의 실제 동기화는 없습니다.';if(state.day&&$('#day-steps')){const keys=['boarding','planning','delivery','review','returning','closed'],n=keys.indexOf(state.day.stage);$('#day-steps').innerHTML=keys.map((key,index)=>`<li class="${index===n?'active':index<n?'done':''}"><i>${index+1}</i>${window.NextDayUI.stages[key]}</li>`).join('')}fit();hydrateProof();if(recoveryRaw)storageError('기존 기록을 읽을 수 없습니다. 원본은 보존했습니다. 시연 제어에서 내려받은 뒤 새 시연을 시작하세요.');if(vehiclePersistenceBlocked)storageError(vehicleSaveError)}
let dbPromise;function db(){if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('photos');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('사진 저장소를 열 수 없음'))}).catch(e=>{dbPromise=null;throw e});return dbPromise}
async function dbPut(key,blob){const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction('photos','readwrite');tx.objectStore('photos').put(blob,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}
async function dbGet(key){const d=await db();return new Promise((resolve,reject)=>{const r=d.transaction('photos').objectStore('photos').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function hydrateProof(){const rev=renderVersion;for(const el of $$('[data-proof-key]')){const key=el.dataset.proofKey;const item=Object.values(state.items).find(x=>x.proof?.key===key);if(item?.proof.kind!=='photo')continue;try{let url=urls.get(key);if(!url){const blob=await dbGet(key);if(!blob)throw Error('missing');url=URL.createObjectURL(blob);urls.set(key,url)}if(rev===renderVersion)el.innerHTML=`<img src="${url}" alt="저장한 배송 사진">`}catch{if(rev===renderVersion)el.innerHTML='<strong>사진을 불러올 수 없습니다</strong><span>파일을 다시 선택하세요.</span>'}}}
async function auditPhotos(){for(const id of ids){const proof=state.items[id].proof;if(proof?.kind==='photo'){try{const blob=await dbGet(proof.key);if(!blob&&state.items[id].proof?.key===proof.key){if(!dispatch('proofMissing',{id})){storageError(id+' 사진 유실을 기록하지 못했습니다. 저장 공간 확인 후 새로고침하세요. 검토를 중단했습니다.');return false}storageError(id+' 사진 파일을 찾지 못했습니다. 마지막 검토에 사진 미완료로 남겼습니다.')}}catch{storageError('사진 저장소를 확인하지 못했습니다. 기록은 보존했습니다. 새로고침으로 다시 확인하세요.');return false}}}return true}
async function savePhoto(blob,id,token=photoToken(id)){if(photoBusy||!id||!tokenValid(token))return;photoBusy=true;try{if(!blob||!['image/jpeg','image/png','image/webp'].includes(blob.type)||blob.size>8*1024*1024)throw Error('8MB 이하의 JPEG, PNG, WebP 파일을 선택하세요.');const bitmap=await createImageBitmap(blob);bitmap.close();if(!tokenValid(token))return;if(failPhoto){failPhoto=false;throw Error('사진 저장 실패 시연. 다시 촬영하거나 파일을 선택하세요.')}const key=crypto.randomUUID();await dbPut(key,blob);if(!tokenValid(token)){say('작업 기록이 바뀌었습니다. 이전 사진은 연결하지 않았습니다.');return}if(dispatch('proof',{id,key,kind:'photo'}))say(state.items[id].correction?.status==='pending'?id+' 사진 교체 요청 저장 · 원본 유지':id+' 사진 저장됨 · 전송 대기')}catch(e){storageError(e.message||'사진을 저장하지 못했습니다.')}finally{photoBusy=false}}
function closeModal(){delete $('#modal').dataset.cameraSheet;mediaEpoch++;if(stagedUrl){URL.revokeObjectURL(stagedUrl);stagedUrl=null}stagedPhoto=null;if(modalStream){modalStream.getTracks().forEach(t=>t.stop());modalStream=null}if($('#modal').open)$('#modal').close();$('#modal-content').innerHTML=''}
function positionCameraSheet(){
 const dialog=$('#modal');if(!dialog.open||!dialog.dataset.cameraSheet)return;
 const rect=$('#phone').getBoundingClientRect(),scale=rect.width/390;if(!scale)return;
 const height=Math.min(505,rect.height/scale*.68);/* Figma 29:80 시트 높이 505 */
 dialog.style.setProperty('--camera-left',rect.left+'px');
 dialog.style.setProperty('--camera-top',(rect.bottom-height*scale)+'px');
 dialog.style.setProperty('--camera-scale',String(scale));
 dialog.style.setProperty('--camera-height',height+'px');
}
function modal(html,camera=false){closeModal();if(camera)$('#modal').dataset.cameraSheet='true';$('#modal-content').innerHTML=publicMarkup(html)+(html.includes('class="modal-error"')?'':'<div class="modal-error" role="alert"></div>');$('#modal').showModal();if(camera)positionCameraSheet()}
/* Figma 29:80 카메라 시트: 네 상태(waiting·live·error·preview)가 같은 구조를 쓴다.
   주소·요청 머리글 없이 사진·영상이 시트 전체를 채우고, 아래 조작 줄은 항상 [뒤로 54 SVG] [가운데 주 동작] [••• 추가 옵션].
   가운데: 대기=셔터(비활성) · 실시간=셔터 · 오류=사진 파일 선택 · 미리보기=이 사진 저장. 동·호수는 접근성 이름으로만 남긴다 */
function cameraSheet(id,mode,message=''){
 const p=par(id),preview=mode==='preview',live=mode==='live',error=mode==='error';
 const media=live?'<video autoplay playsinline muted aria-label="실시간 배송 사진 카메라"></video>':preview?'<img id="photo-preview" alt="저장 전 사진 미리보기">':`<div class="camera-sheet-status" role="status"><strong>${error?'카메라를 열 수 없습니다':'카메라 연결 중'}</strong><p>${String(message||'브라우저의 카메라 권한을 확인하세요.').split(/(?<=\.)\s+/).map(x=>`<span>${esc(x)}</span>`).join(' ')}</p></div>`;/* 문장 단위로 줄을 나눠 '사진 / 파일을' 같은 어색한 줄바꿈을 막는다 */
 const main=preview?btn('confirmPhoto','이 사진 저장','camera-sheet-save'):error?btn('photo','사진 파일 선택','camera-sheet-save camera-sheet-file'):btn('capture','<span class="camera-shutter-disc"></span><span class="camera-sr-only">사진 촬영</span>','camera-sheet-shutter',live?'aria-label="사진 촬영"':'disabled aria-label="카메라 연결 대기"');
 const more=(preview||error?btn('camera','다시 촬영','secondary'):'')+(error?'':btn('photo','사진 파일 선택','secondary'));
 return `<section class="camera-sheet" data-camera-state="${mode}" aria-label="${esc(p.stop)}동 ${esc(p.unit)}호 배송 사진"><div class="camera-sheet-view">${media}<div class="camera-sheet-controls">${btn('discardPhoto','<img src="development/icons/figma-camera-back.svg" width="54" height="54" alt="">','camera-sheet-back','aria-label="사진 취소하고 배송으로 돌아가기"')}${main}<details class="camera-sheet-more"><summary aria-label="사진 옵션 더보기">•••</summary><div>${more}<p>사진 저장은 배송 완료가 아닙니다.</p></div></details></div></div></section>`;
}
/* 브라우저 영문 원문 대신 한국어 안내. 모든 문장은 파일 선택 대안을 함께 알린다 */
function cameraErrorMessage(e){
 const n=e?.name||'';
 if(n==='NotAllowedError'||n==='SecurityError'||n==='PermissionDeniedError')return '카메라 권한이 거부됐습니다. 사진 파일을 선택하거나 브라우저 권한을 변경하세요.';
 if(n==='NotFoundError'||n==='OverconstrainedError'||n==='DevicesNotFoundError')return '이 기기에서 카메라를 찾지 못했습니다. 사진 파일을 선택하세요.';
 if(n==='NotReadableError'||n==='TrackStartError')return '다른 앱이 카메라를 쓰고 있습니다. 사진 파일을 선택하세요.';
 if(n==='CameraUnsupported')return '이 환경에서는 카메라를 쓸 수 없습니다. 사진 파일을 선택하세요.';
 return '카메라를 열지 못했습니다. 사진 파일을 선택하세요.';
}
async function openCamera(){
 const id=state.selected,token=photoToken(id);if(!tokenValid(token))return;
 closeModal();const sheet=!!window.NextMobile?.enabled();if(sheet)modal(cameraSheet(id,'waiting'),true);const request=mediaEpoch;
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw Object.assign(Error('camera unsupported'),{name:'CameraUnsupported'});
  const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
  if(request!==mediaEpoch||!tokenValid(token)){stream.getTracks().forEach(t=>t.stop());return}
  modal(sheet?cameraSheet(id,'live'):`<h2>${par(id).unit}호 · ${id}</h2><p>물품을 전달한 위치가 보이도록 촬영하세요.</p><video autoplay playsinline muted></video>${btn('capture','사진 촬영')}`,sheet);
  modalStream=stream;photoTarget=token;$('#modal video').srcObject=stream;
  /* 기기 쪽에서 트랙이 끊기면(분리·다른 앱 점유) 멈춘 화면 대신 오류 상태로 바꾼다. stop()으로 끈 트랙은 ended 이벤트를 내지 않는다 */
  stream.getVideoTracks().forEach(t=>t.addEventListener('ended',()=>{if(modalStream!==stream)return;modalStream=null;stream.getTracks().forEach(x=>x.stop());const message='카메라 연결이 끊겼습니다. 다시 촬영하거나 사진 파일을 선택하세요.';if(sheet&&$('#modal').dataset.cameraSheet){modal(cameraSheet(id,'error',message),true);say(message)}else{closeModal();storageError(message)}},{once:true}));
 }catch(e){if(request===mediaEpoch&&tokenValid(token)){const message=cameraErrorMessage(e);if(sheet){modal(cameraSheet(id,'error',message),true);say(message)}else storageError(message)}}
}
async function capture(){
 const v=$('#modal video'),token=photoTarget,id=token?.id;if(!modalStream||!tokenValid(token))return;
 if(!v?.videoWidth){say('카메라 영상을 기다려주세요.');return}
 const request=++mediaEpoch,c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);
 const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',.9));
 if(request!==mediaEpoch||!tokenValid(token))return;
 closeModal();await previewPhoto(blob,id,token);
}
async function previewPhoto(blob,id,token=photoToken(id)){
 if(!tokenValid(token))return;const request=++mediaEpoch;
 if(!blob||!['image/jpeg','image/png','image/webp'].includes(blob.type)||blob.size>8*1024*1024){storageError('8MB 이하의 JPEG, PNG, WebP 파일을 선택하세요.');return}
 try{const bitmap=await createImageBitmap(blob);bitmap.close()}catch{if(request===mediaEpoch&&tokenValid(token))storageError('사진 파일을 읽지 못했습니다. 다른 파일을 선택하세요.');return}
 if(request!==mediaEpoch||!tokenValid(token))return;
 const sheet=!!window.NextMobile?.enabled();
 modal(sheet?cameraSheet(id,'preview'):`<h2>${par(id).unit}호 · ${id}</h2><p>사진을 확인한 뒤 저장하세요. 전달 결과는 따로 기록합니다.</p><img id="photo-preview" alt="저장 전 사진 미리보기" style="width:100%;max-height:340px;object-fit:contain">${btn('confirmPhoto','이 사진 저장')}${btn('discardPhoto','사진 취소','secondary')}`,sheet);
 stagedPhoto={blob,id,token};stagedUrl=URL.createObjectURL(blob);$('#photo-preview').src=stagedUrl;
}
function download(data,name){const url=URL.createObjectURL(new Blob([data],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000)}
function exportRecord(){download(JSON.stringify({notice:'로컬 시연 기록. 사진 파일은 포함되지 않습니다. 복구용 전체 백업이 아닙니다. 배송사 수신/차량/지도는 시연입니다.',...state},null,2),'NEXT-postload-record.json')}
function reasonForm(mode){const id=state.selected;modal(`<h2>${id} · ${mode==='undelivered'?'미전달 기록':'나중에 배송'}</h2><p>${mode==='undelivered'?'시연 규칙: 미전달 사유가 필요합니다. 실제 물품 인계는 별도입니다.':'사유는 선택 사항입니다. 보류해도 배송 실패나 반송으로 처리하지 않습니다.'}</p><form class="modal-form"><label for="reason">사유 ${mode==='undelivered'?'(필수)':'(선택)'}</label><select id="reason"><option value="">선택하지 않음</option><option>물품을 찾지 못함</option><option>건물 진입 불가</option><option>수취 조건 불일치</option><option>주소 확인 필요</option></select><div class="modal-error" role="alert"></div>${btn(mode==='undelivered'?'saveUndelivered':'saveDefer',mode==='undelivered'?'미전달 기록 저장':'보류하고 다음 배송','primary',`data-id="${id}"`)}</form>`)}
function demoTools(){modal(`<h2>시연 제어</h2><p>실제 배송사·차량 연결이 없습니다. 아래 응답과 장애는 테스트용입니다. 현재 물품: ${state.selected}</p><div class="demo-grid">${[...(state.day?[['dayEmpty','배정 내역 없음 시연']]:[]),['demoProof','현재 물품에 시연 증빙'],['syncSuccess','수신 성공 시연'],['syncFailure','전송 실패 시연'],['syncUnknown','수신 불명 시연'],['syncSending','전송 중 시연'],['cameraFailure','카메라 거부 시연'],['photoFailure','다음 사진 저장 실패'],['saveFailure','다음 기록 저장 실패'],['vehicleUnknown','차량 상태 불명'],['vehicleParked','정차 연결 복구'],['acceptCorrection','현재 정정 승인'],['rejectCorrection','현재 정정 거절'],['handoffDemo','현재 물품 인계 확인'],['exportRecovery','보존 원본 내려받기']].map(([a,t])=>btn(a,t,'secondary')).join('')}</div><p class="small-note">시연 증빙은 실제 사진이 아닙니다. 수신·인계·정정 승인은 실제 운영 처리가 아닙니다.</p>`)}
async function action(type,b){const id=b.dataset.id||state.selected;if(!ready&&!['reset','exportRecovery'].includes(type))return;
// Demo controls remain usable to restore the simulated connection. Courier
// interactions, including stale modal controls, require confirmed parking.
if(state.vehicle!=='parked'&&['list','open','filter','destination','start','next','openReview','exit','resume','resultAndNext','correctSaved','result','entry','requestInfo','deferReason','defer','saveDefer','resumeDeferred','exception','undelivered','saveUndelivered','photo','camera','capture','confirmPhoto','correct','saveCorrection','itemHistory','records'].includes(type))return;
if(state.day&&type.startsWith('day')){
 if(state.vehicle!=='parked')return;
 if(photoBusy||modalStream||stagedPhoto){feedback('사진을 저장하거나 취소한 뒤 작업을 바꾸세요.');return}
 if(type==='dayPlan'||type==='dayReplan'||type==='dayCancelPlan'||type==='dayStart'||type==='dayReturn'||type==='dayFinish'||type==='dayFinishWithoutReturn'){
  const changed=dispatch(type);if(type==='dayStart'&&changed){ui='detail';centerStop=state.destination;render()}
  if(!changed)feedback(fieldError||state.notice||'남은 배송·사진·인계와 차량 상태를 확인하세요.');return;
 }
 if(type==='dayChoose'){dispatch(type,{routeId:b.dataset.route});return}
 if(type==='dayLoad'){if(!state.online){feedback('오프라인입니다. 연결 후 배정을 불러오세요.');return}dispatch('dayAssignments',{available:true});return}
 if(type==='dayEmpty'){closeModal();if(!dispatch('dayAssignments',{available:false}))say('시작 화면에서 배정 없음 상태를 시연할 수 있습니다.');return}
 if(type==='dayReturnToggle'){dispatch('dayReturnRequired',{value:!state.day.returnRequired});return}
 if(type==='dayNavigate'){await action('destination',{dataset:{stop:b.dataset.stop,source:'phone'}});return}
 if(type==='dayRecords'){modal(`<h2>오늘 배송 기록</h2>${ids.map(id=>{const p=par(id),i=state.items[id];return `<div class="modal-record"><strong>${p.stop}동 ${p.unit}호</strong><p>${esc(shipmentLabel(id))}</p><p>${esc(resultText(i))} · ${esc(txText(i))}</p></div>`}).join('')}<p>기록은 기기에 저장되어 있습니다. 배송사 마감은 별도입니다.</p>`);return}
 if(type==='dayRetry'){
  if(!state.online){feedback('오프라인 · 기록은 기기에 보관됩니다. 연결 후 다시 시도하세요.');return}
  modal(`<h2>전송 다시 시도</h2><p>실제 배송사 서버는 연결되지 않았습니다. 아래에서 시연 응답을 선택하세요. 사진 미완료·정정 대기는 전송하지 않습니다.</p>${btn('daySyncSuccess','수신 성공 시연')}${btn('daySyncFailure','전송 실패 시연','secondary')}`);return;
 }
 if(type==='daySyncSuccess'||type==='daySyncFailure'){closeModal();dispatch('sync',{outcome:type==='daySyncSuccess'?'success':'failure'});return}
 if(type==='dayMore'){modal(`<h2>${par(id).unit}호 · 사진 저장</h2>${btn('photo','사진 파일 선택','secondary')}${btn('demoProof','시연 증빙 사용','secondary')}<p class="small-note">시연 증빙은 실제 사진이 아닙니다.</p>${state.items[id].result==='pending'?btn('result','사진 없이 전달만 기록','secondary',`data-id="${id}"`):btn('next','사진 미루고 다음','secondary')}`);return}
 if(type==='dayContact'){modal('<h2>연락처가 없습니다</h2><p>이 시연 배정에는 연락처가 포함되지 않았습니다. 실제 전화·문자 기능은 연결하지 않았습니다.</p>');return}
 if(type==='dayHandoff'){modal(`<h2>물품 인계 확인</h2><p>실제 인계 접수는 연결되지 않았습니다. 인계 완료 응답을 시연할 수 있습니다.</p>${btn('handoffDemo','인계 접수 시연','primary',`data-id="${id}"`)}`);return}
}
if(type==='list'){ui='list';if(state.phase!=='work')dispatch('resume');else render();return}
if(type==='open'){ui='detail';if(state.phase!=='work')dispatch('resume',{id});else dispatch('select',{id});render();closeModal();return}
if(type==='filter'){filter=b.dataset.filter;render();return}
if(type==='centerStop'){centerStop=b.dataset.stop;render();return}
if(type==='clearPreview'){centerStop=par(state.selected).stop;dispatch(type);return}
if(type==='preview'){dispatch(type,{id});return}
if(type==='destination'){
 const target=b.dataset.stop;
 if(target===state.destination){feedback('이미 차량 목적지로 설정된 동입니다.');return}
 if(photoBusy||modalStream||stagedPhoto){feedback('사진 처리 중 · 목적지 변경 미반영');return}
 const changed=dispatch(type,{stop:target,source:b.dataset.source||'phone'});
 // A persisted rejection notice is also a state change, but not a changed destination.
 if(changed&&state.destination===target&&!state.notice){if($('#modal').open)closeModal()}
 else feedback(fieldError||state.notice||'목적지 변경 미반영. 현재 상태를 확인한 뒤 다시 시도하세요.');
 return;
}
if(type==='start'){ui='list';dispatch(type);return}
if(type==='next'){ui='detail';dispatch(type);return}
if(['openReview','exit','resume'].includes(type)){if(type==='resume')ui='list';dispatch(type);return}
if(type==='resultAndNext'){
 if(!b.dataset.id||Date.now()<advanceReadyAt)return;
 if(photoBusy||modalStream||stagedPhoto){say('사진 저장을 마친 뒤 전달 결과를 저장하세요.');return}
 if(dispatch('resultAndNext',{id,value:'delivered'})){
  guardAdvance();ui='detail';render();
  say(`${par(id).stop}동 ${par(id).unit}호 · ${id} 전달 기록 저장됨. ${state.phase==='review'?'마지막 검토를 확인하세요.':'다음 배송의 주소와 요청을 확인하세요.'}`);
 }
 return;
}
if(type==='correctSaved'){
 if(state.vehicle!=='parked'||!['work','review'].includes(state.phase)||state.items[id]?.result!=='delivered'||state.items[id].correction?.status==='pending')return;
 if((state.phase!=='work'||state.selected!==id)&&!dispatch(state.phase==='work'?'select':'resume',{id}))return;
 ui='detail';render();await action('correct',{dataset:{id}});return;
}
if(type==='result'){if(Date.now()<advanceReadyAt)return;if(dispatch('result',{id,value:'delivered'})){if(state.day)closeModal();say(id+' 전달 기록 저장'+(!state.items[id].proof&&par(id).photoRequired?' · 사진은 아직 필요합니다.':''))}return}
if(type==='entry'){const st=stop(par(id).stop);modal(`<h2>${st.name} 입구 안내</h2>${st.id===state.destination?'<p>현재 차량 목적지 · '+st.name+'</p>':btn('destination',st.name+' 차량 목적지로 설정','secondary',`data-stop="${st.id}" data-source="phone"`)}<p>${esc(st.entrance||'등록된 입구 정보 없음')}</p><p>${st.id==='104'?'서쪽 공동현관 · 시연용 건물 안내, 2026.10.18. 실제 출입 정보가 아닙니다.':'현장 안내와 고객 요청을 확인하세요. 입구 위치를 추정하지 않습니다.'}</p>${state.items[id].result==='pending'?btn('defer','진입 불가 · 나중에 배송','secondary',`data-id="${id}" data-reason="건물 진입 불가" ${state.items[id].correction?.status==='pending'?'disabled':''}`):''}<p>이동·현관 통과를 완료 버튼으로 기록하지 않습니다.</p>`);return}
if(type==='requestInfo'){const p=par(id);modal(`<h2>${p.stop}동 ${p.unit}호</h2><p>${p.id} 요청 원문</p><p><strong>${esc(p.request)}</strong></p><p>등록: ${esc(p.requestAt)}<br>출처: 가상 배정 v1 · 실제 고객 요청 아님</p>`);return}
if(type==='deferReason'){if(id===state.selected)reasonForm('defer');return}
if(type==='defer'||type==='saveDefer'){
 if(!b.dataset.id||id!==state.selected||Date.now()<advanceReadyAt)return;
 if(photoBusy||modalStream||stagedPhoto){say('사진 처리를 마치거나 취소한 뒤 보류하세요.');return}
 const reason=type==='saveDefer'?$('#reason').value:(b.dataset.reason||'');
 if(dispatch('defer',{id,reason})){guardAdvance();ui='detail';closeModal();render();say(id+' 보류 · 다시 배송할 목록에 남겼습니다.')}
 return;
}
if(type==='resumeDeferred'){
 if(!b.dataset.id||!state.items[id]?.deferred||state.vehicle!=='parked'||!['work','review'].includes(state.phase))return;
 if(photoBusy||modalStream||stagedPhoto){say('사진 처리를 마치거나 취소한 뒤 다른 물품을 여세요.');return}
 if(dispatch('resume',{id})){ui='detail';closeModal();render();say(id+' 보류 해제 · 배송을 다시 시작합니다.')}
 return;
}
if(type==='exception'&&state.items[id].result!=='pending'){modal(`<h2>${id} 결과 확인</h2><p>이미 결과가 저장된 물품입니다. 잘못 기록했다면 정정을 요청하세요.</p>${btn('correct','배송 결과 정정','primary',state.items[id].correction?.status==='pending'?'disabled':'')}`);return}
if(type==='exception'){modal(`<h2>${id} 배송 문제</h2><p>다른 배송을 먼저 할 수 있습니다. 공식 미전달 기록은 별도입니다.</p>${btn('deferReason','사유와 함께 보류','secondary',`data-id="${id}"`)}${btn('undelivered','미전달 결과 기록','secondary')}`);return}
if(type==='undelivered'){reasonForm('undelivered');return}
if(type==='saveUndelivered'){const reason=$('#reason').value;if(!reason){$('.modal-error').textContent='미전달 사유를 선택하세요.';return}if(dispatch('result',{id,value:'undelivered',reason})){closeModal();say(id+' 미전달 기록 저장 · 인계 대기')}return}
if(type==='photo'){if($('#modal').dataset.cameraSheet)closeModal();photoTarget=photoToken(state.selected);$('#photo-input').click();return}
if(type==='camera'){await openCamera();return}
if(type==='capture'){await capture();return}
if(type==='confirmPhoto'){const pending=stagedPhoto;if(!pending)return;closeModal();await savePhoto(pending.blob,pending.id,pending.token);return}
if(type==='discardPhoto'){closeModal();return}
if(type==='correct'){modal(`<h2>${par(id).stop}동 ${par(id).unit}호 · ${id} 결과 정정</h2><p>잘못 저장한 결과를 되돌리려면 ‘배송 대기로 되돌리기’를 선택하고 사유를 적으세요. 승인 전에는 기존 결과가 유지됩니다. 이 시안의 승인은 시연 제어에서 확인합니다.</p><form class="modal-form"><label for="correct-result">변경할 결과</label><select id="correct-result"><option value="pending">배송 대기로 되돌리기</option><option value="undelivered">미전달</option><option value="delivered">전달</option></select><label for="correct-reason">정정 사유</label><textarea id="correct-reason" maxlength="200"></textarea><div class="modal-error" role="alert"></div>${btn('saveCorrection','정정 요청 저장','primary',`data-id="${id}"`)}</form>`);return}
if(type==='saveCorrection'){const reason=$('#correct-reason').value.trim();if(!reason){$('.modal-error').textContent='정정 사유를 입력하세요.';return}if(dispatch('correct',{id,result:$('#correct-result').value,reason})){closeModal();say('정정 요청 저장 · 원기록 유지')}return}
if(type==='itemHistory'){modal(`<h2>${id} 기록</h2>${state.items[id].history.map(x=>`<div class="modal-record">${esc(x.at||'')}<br>${esc(publicText(x.text||x.type))}</div>`).join('')||'<p>저장된 이력이 없습니다.</p>'}`);return}
if(type==='records'){modal(`<h2>전체 배송 기록</h2>${groups(ids)}`);return}
if(type==='demoProof'){closeModal();if(dispatch('proof',{id,key:'demo-'+crypto.randomUUID(),kind:'demo'}))say(id+' 시연 증빙 저장 · 실제 사진 아님');else say('정차한 작업 화면에서 시연 증빙을 저장하세요.');return}
if(type.startsWith('sync')){const outcome={syncSuccess:'success',syncFailure:'failure',syncUnknown:'unknown',syncSending:'sending'}[type];if(outcome){closeModal();const changed=dispatch('sync',{outcome});say(changed?'수신 응답 시연 반영 · 실제 전송 없음':'변경할 기록이 없습니다. 필수 사진·정정·연결을 확인하세요.');return}}
if(type==='cameraFailure'){closeModal();storageError('카메라 권한 거부 시연. 현재 대상은 유지됩니다. 파일 선택을 이용하세요.');return}
if(type==='photoFailure'){failPhoto=true;closeModal();say('다음 사진 저장에서 실패를 시연합니다.');return}
if(type==='saveFailure'){failSave=true;closeModal();say('다음 기록 저장에서 실패를 시연합니다.');return}
if(type==='vehicleUnknown'||type==='vehicleParked'){closeModal();dispatch('vehicle',{value:type==='vehicleUnknown'?'unknown':'parked'});return}
if(type==='acceptCorrection'||type==='rejectCorrection'){
 const candidate=state.items[id].correction?.replacementProof,context=state,revision=state.revision,token=photoToken(id),request=mediaEpoch;
 // Bind delayed photo validation to this exact request and context. A vehicle
 // roundtrip, storage update or dismissed dialog must never replay an approval.
 const current=()=>state===context&&state.revision===revision&&photoEpoch===token.epoch&&mediaEpoch===request&&state.items[id].revision===token.revision&&JSON.stringify(state.items[id].correction)===token.correction;
 const stale=()=>{say('정정 요청 또는 작업 상태가 바뀌어 이전 승인 작업을 반영하지 않았습니다.');return false};
 if(type==='acceptCorrection'&&candidate?.kind==='photo'){
  try{
   const photo=await dbGet(candidate.key);
   if(!current())return stale();
   if(!photo){closeModal();storageError('교체 사진을 찾지 못했습니다. 정정을 거절한 뒤 사진을 다시 선택하세요.');return false}
  }catch{
   if(!current())return stale();
   closeModal();storageError('교체 사진 저장소를 확인하지 못했습니다. 승인을 반영하지 않았습니다.');return false;
  }
 }
 closeModal();const changed=dispatch('resolveCorrection',{id,accept:type==='acceptCorrection'});
 if(!changed)say('온라인 연결과 현재 물품의 정정 대기 상태를 확인하세요.');
 return changed;
}
if(type==='handoffDemo'){closeModal();if(!dispatch('handoff',{id}))say('온라인 연결과 현재 물품의 미전달 기록을 확인하세요.');return}
if(type==='exportRecovery'){download(recoveryRaw||localStorage.getItem('next-delivery-v3')||rawSeen||'{}','NEXT-preserved-record.json');return}
if(type==='reset'&&vehicleLock){storageError('차량 잠금 중입니다. 정차 상태 복구 후 새 시연을 시작하세요.');return}
if(type==='reset'){try{photoEpoch++;if(rawSeen)localStorage.setItem((MAIN?'next-postload-archive-':'next-directions-archive-'+DIRECTION+'-')+Date.now(),rawSeen);const next=E.create();const raw=JSON.stringify(next);localStorage.setItem(KEY,raw);state=next;rawSeen=raw;recoveryRaw=null;fieldError='';ui='list';filter='pending';centerStop='104';failPhoto=failSave=false;ready=true;closeModal();$('#storage-error').hidden=true;render()}catch{storageError('새 시연을 저장하지 못했습니다. 기존 기록을 유지합니다.')}return}
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b||b.disabled)return;e.preventDefault();action(b.dataset.action,b).catch(err=>{console.error(err);storageError('요청을 처리하지 못했습니다. 기록을 확인하고 다시 시도하세요.')})});
document.addEventListener('click',e=>{const b=e.target.closest('[data-map-zoom]');if(!b||b.disabled||state.vehicle!=='parked')return;const mode=b.dataset.mapZoom;window.NextMap?.setZoom(mode==='reset'?1:window.NextMap.zoom+(mode==='in'?.4:-.4));render();const same=document.querySelector('[data-map-zoom="'+mode+'"]');(same?.disabled?document.querySelector('[data-map-zoom="reset"]'):same)?.focus({preventScroll:true})});
$('#photo-input').addEventListener('change',async e=>{if(e.target.files[0])await previewPhoto(e.target.files[0],photoTarget.id,photoTarget);e.target.value=''});
$('#modal-close').onclick=closeModal;$('#modal').addEventListener('cancel',e=>{e.preventDefault();closeModal()});
$('#arrive-demo').onclick=()=>{closeModal();dispatch(state.day?.stage==='returning'?(state.vehicle==='moving'?'dayReturnPark':'dayReturnDrive'):(state.vehicle==='moving'?'park':'drive'))};$('#network-demo').onclick=()=>dispatch('network',{online:!state.online});$('#night-demo').onclick=()=>{document.body.dataset.night=String(document.body.dataset.night!=='true');try{localStorage.setItem(NIGHT_KEY,document.body.dataset.night)}catch{}render()};$('#scenario-tools').onclick=demoTools;
$('#reset-demo').onclick=()=>modal(`<h2>새 시연을 시작할까요?</h2><p>현재 기록의 JSON을 브라우저 보관 키에 남깁니다. 사진 원본도 유지합니다. 이전 v3 시안의 저장 기록은 변경하지 않습니다.</p>${btn('reset','새 시연 시작')}`);
$('#export-record').onclick=exportRecord;$$('.view-tabs [data-view]').forEach(b=>b.onclick=()=>{$('#workspace').dataset.view=b.dataset.view;$$('.view-tabs button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));fit()});
window.addEventListener('resize',positionCameraSheet);window.addEventListener('scroll',positionCameraSheet,true);
window.addEventListener('resize',fit);new ResizeObserver(fit).observe($('#workspace'));window.addEventListener('offline',()=>dispatch('network',{online:false}));window.addEventListener('online',()=>dispatch('network',{online:true}));window.addEventListener('storage',e=>{if(e.key!==KEY)return;const restored=e.newValue&&E.restore(e.newValue);if(restored){photoEpoch++;state=withVehicleLock(restored);rawSeen=e.newValue;closeModal();render();say('다른 창의 최신 기록을 반영했습니다.')}else{recoveryRaw=e.newValue||'removed';storageError('저장 기록이 바뀌었거나 삭제됐습니다. 현재 화면의 기록은 보존합니다. 다시 쓰지 않습니다.')}});
const params=new URLSearchParams(location.search);if(['phone','center','cluster'].includes(params.get('view'))){$('#workspace').dataset.view=params.get('view');$$('.view-tabs button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===params.get('view'))))}
window.NextApp={setDemoState:AUTOPLAY?raw=>{const next=E.restore(JSON.stringify(raw));if(!next)return false;state=next;ready=true;vehicleLock=null;centerStop=par(state.selected).stop;ui='detail';render();return true}:undefined,direction:DIRECTION,getState:()=>JSON.parse(JSON.stringify(state)),getStorageKey:()=>KEY,dispatch,render,isReady:()=>ready||photoAuditDone};
/* isReady: 저장된 사진 확인(auditPhotos)이 끝났는가. 끝나기 전에는 dispatch·action 이 무시되므로 바깥(ui-bridge)은 이 값을 기다린 뒤 화면을 연다.
   확인이 실패해 잠금으로 끝난 경우도 '끝남'으로 알려 잠금 안내를 그대로 보이게 한다 */
var photoAuditDone=false;
render();auditPhotos().then(ok=>{ready=ok;photoAuditDone=true;render()},()=>{photoAuditDone=true;render()});document.fonts.ready.then(fit);
})();
