/* Optional mobile IA shell. No engine writes during rendering or navigation. */
(()=>{'use strict';
const tabs=[['today','오늘','today'],['delivery','배송','parcel'],['records','기록','records'],['more','더보기','more']];
const initialScreen=new URLSearchParams(window.location?.search||'').get('mobileScreen');
const ui={tab:initialScreen==='delivery'||initialScreen==='shipment'?'delivery':'today',depth:initialScreen==='vehicle'?'vehicle':initialScreen==='shipment'?'shipment':'root',filter:'pending',record:null};
let context=null,bound=false,intent=null;
const enabled=()=>new URLSearchParams(window.location?.search||'').get('mobile')==='app';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(key,label,extra='',cls='m-button')=>`<button type="button" class="${cls}" data-mobile-${key} ${extra}>${label}</button>`;
const action=(c,type,label,extra='',cls='m-button')=>c.btn(type,label,cls,extra);
const beforeStart=c=>['boarding','planning'].includes(c.state.day?.stage);
const available=c=>c.state.day?.assignmentsReady!==false;
const entries=c=>available(c)?c.ids.filter(id=>c.parcels[id]&&c.state.items[id]):[];
const modalOpen=()=>!!document.querySelector('#modal')?.open;
const locked=c=>!c.ready||c.state.vehicle!=='parked';
const result=i=>i.result==='delivered'?'전달 기록 저장됨':i.result==='undelivered'?'미전달 기록 저장됨':i.deferred?'보류':'배송 대기';
const transmission=(c,i)=>({unsubmitted:'미제출',queued:c.state.online?'전송 대기':'오프라인 · 전송 대기',sending:'전송 중 · 시연',unknown:'수신 확인 중 · 시연',received:'배송사 수신 · 시연',error:'전송 실패 · 시연'})[i.transmission]||'전송 상태 미확인';
function status(c,id){const p=c.parcels[id],i=c.state.items[id];return `<span class="m-result">${result(i)}</span><span class="m-transmission">${transmission(c,i)}</span>${i.result==='delivered'&&p.photoRequired&&!i.proof?'<span class="m-warning">사진 미완료</span>':''}${i.correction?.status==='pending'?'<span class="m-warning">정정 요청 중 · 원기록 유지</span>':''}${i.handoff==='pending'?'<span class="m-warning">인계 확인 대기</span>':''}`;}
function icon(c,name){
 if(typeof window.NextIcons?.icon==='function')return window.NextIcons.icon(name,'filled',{size:24,decorative:true});
 return c.icon(({today:'route',parcel:'pin',records:'check',more:'link',vehicle:'link'})[name]||name);
}
function vehicleState(){
 const fallback={soc:78,rangeKm:214,charging:'disconnected',source:'demo',connected:false};
 let value;try{value=window.NextVehicle?.getState?.();}catch{value=null;}
 const v=value&&typeof value==='object'?value:fallback,demo=v.source==='demo';
 return {demo,soc:demo&&Number.isFinite(v.soc)&&v.soc>=0&&v.soc<=100?v.soc:null,
 rangeKm:demo&&Number.isFinite(v.rangeKm)&&v.rangeKm>=0?v.rangeKm:null,
 charging:demo?({disconnected:'충전기 미연결',charging:'충전 중',complete:'충전 종료'})[v.charging]||'충전 상태 미확인':'충전 상태 미확인',
 connection:v.connected===true?'연결 신호 있음 · 실제 상태 미확인':'실제 차량 미연결'};
}
function vehicleCard(c){const v=vehicleState();return button('vehicle',`<span class="m-vehicle-card-head">${icon(c,'vehicle')}<strong>차량 상태</strong><span class="m-vehicle-chevron" aria-hidden="true">›</span></span><span class="m-vehicle-card-values"><b>${v.soc??'—'}<small>%</small></b><span>주행 가능 <strong>${v.rangeKm??'—'} km</strong></span></span>`,'aria-label="차량 상태 상세 · 시연 데이터"','m-vehicle-card');}
function vehicle(c){const v=vehicleState();return `<section class="m-vehicle-detail">${button('back','‹ 오늘','','m-back')}<div class="m-vehicle-hero"><p>배터리 잔량</p><div class="m-battery-value">${v.soc??'—'}<small>%</small></div><div class="m-battery-track" role="img" aria-label="배터리 ${v.soc??'미확인'} 퍼센트 · 시연"><span style="width:${v.soc??0}%"></span></div><img class="m-vehicle-image" src="development/generated/cargo-van.png" alt="NEXT 배송 밴 컨셉 이미지 · 실제 등록 차량 아님"></div><dl class="m-vehicle-facts"><div><dt>주행 가능 거리</dt><dd>${v.rangeKm??'—'}<small> km</small></dd></div><div><dt>운행 상태</dt><dd>${c.state.vehicle==='parked'?'정차':c.state.vehicle==='moving'?'주행':'상태 미확인'}</dd></div><div><dt>충전 상태</dt><dd>${esc(v.charging)}</dd></div></dl></section>`;}
function nav(c){return `<nav class="m-nav" aria-label="모바일 기본 메뉴">${tabs.map(([key,label,iconName])=>button(`tab="${key}"`,`${icon(c,iconName)}<span>${label}</span>`,`aria-current="${ui.tab===key?'page':'false'}"`,'m-nav-item')).join('')}</nav>`;}
function row(c,id,record=false){const p=c.parcels[id];const text=`<span class="m-row-main"><strong>${esc(p.unit)}<small>호</small></strong><span>${esc(p.request)}</span><small>운송장 ${esc(p.waybill)}</small>${status(c,id)}</span><span aria-hidden="true">›</span>`;return record?button(`record="${esc(id)}"`,text,'','m-row'):action(c,'open',text,`data-id="${esc(id)}" data-mobile-open ${beforeStart(c)?'disabled':''}`,'m-row');}
function groups(c,list,record=false){return c.stops.map(st=>{const group=list.filter(id=>c.parcels[id].stop===st.id);return group.length?`<section class="m-group"><h3>${esc(st.area||st.name)} <small>${group.length}건</small></h3>${group.map(id=>row(c,id,record)).join('')}</section>`:''}).join('')||'<p class="m-empty">이 목록에 해당하는 배송이 없습니다.</p>';}
function today(c){const s=c.state,list=entries(c),p=c.parcels[s.selected],working=s.phase==='work',finished=['review','returning','closed'].includes(s.day?.stage),pending=list.filter(id=>s.items[id].result==='pending').length;
return `<section class="m-current"><img class="m-parcel-asset" src="assets/parcel-styles/05-lowpoly.png" alt="" aria-hidden="true"><p>${working?'진행 중인 배송':'선택 구간 배정'}</p><h2>${working&&p?esc(p.stop)+'동 '+esc(p.unit)+'호':list.length+'건의 배송'}</h2><p>${working&&p?esc(p.request):`${c.stops.filter(st=>list.some(id=>c.parcels[id].stop===st.id)).length}개 구역 · 남은 배송 ${pending}건`}</p>${working&&p?action(c,'open','현재 배송 이어가기',`data-id="${esc(s.selected)}" data-mobile-open`,'m-primary'):finished?button('workflow',s.day.stage==='closed'?'이 구간 업무 확인':'남은 업무·복귀 확인','','m-primary'):available(c)?action(c,'dayPlan','AI 배송 도우미', 'data-mobile-plan','m-primary'):action(c,'dayLoad','배정 다시 불러오기','','m-primary')}</section>${vehicleCard(c)}<div class="m-feature-row">${button('tab="delivery"',icon(c,'parcel')+'배송 목록')}${button('tab="records"',icon(c,'records')+'저장 기록')}</div><h2 class="m-section-title">배정 구역</h2>${c.stops.map(st=>{const count=list.filter(id=>c.parcels[id].stop===st.id).length;return count?`<div class="m-area"><span><strong>${esc(st.area||st.name)}</strong><small>${esc(st.name)}</small></span><b>${count}건</b></div>`:''}).join('')||'<p class="m-empty">불러온 배정이 없습니다.</p>'}${['review','returning','closed'].includes(s.day?.stage)?button('workflow','남은 업무·복귀 확인'):working?action(c,'dayPlan','AI 배송 도우미','data-mobile-plan','m-button'):''}`;}
function deliveries(c){const list=entries(c).filter(id=>ui.filter==='all'||(ui.filter==='deferred'?c.state.items[id].deferred:c.state.items[id].result==='pending'&&!c.state.items[id].deferred));return `${beforeStart(c)?'<p class="m-note">경로를 확인하고 시작한 뒤 배송 상세를 열 수 있습니다.</p>'+(c.state.day.stage==='planning'?button('workflow','선택 중인 경로 확인'):action(c,'dayPlan','AI 배송 도우미','data-mobile-plan')):''}<div class="m-filters" aria-label="배송 필터">${[['pending','남은 배송'],['deferred','보류'],['all','전체']].map(([key,label])=>button(`filter="${key}"`,label,`aria-pressed="${ui.filter===key}"`)).join('')}</div>${groups(c,list)}<p class="m-note">같은 호수도 운송장과 요청을 각각 확인하세요.</p>${beforeStart(c)?'':action(c,'openReview','남은 업무 확인','data-mobile-workflow')}`;}
function records(c){if(ui.depth==='record'&&c.parcels[ui.record]){const id=ui.record,p=c.parcels[id],i=c.state.items[id];return `${button('back','‹ 기록 목록')}<h2>${esc(p.stop)}동 ${esc(p.unit)}호</h2><p>${esc(p.request)}</p><p class="m-note">운송장 ${esc(p.waybill)}</p><div class="m-record-status">${status(c,id)}${i.reason?`<p>사유 · ${esc(i.reason)}</p>`:''}<p>${i.proof?(i.proof.kind==='demo'?'시연 증빙 저장됨 · 실제 사진 아님':'사진 저장됨'):'저장된 사진 없음'}</p></div>${action(c,'itemHistory','이 물품의 상세 이력',`data-id="${esc(id)}"`)}${action(c,'open','배송 상세 열기',`data-id="${esc(id)}" data-mobile-open ${beforeStart(c)?'disabled':''}`)}<p class="m-note">기기 저장과 배송사 수신은 별도 상태입니다.</p>`;}return `<p class="m-note">저장 결과와 전송 상태를 따로 확인하세요.</p>${groups(c,entries(c),true)}${action(c,'dayRecords','전체 기록 보기')}${action(c,'dayRetry','전송 다시 시도 · 시연',c.state.online?'':'disabled')}`;}
function more(c){return `<section class="m-settings"><h2>연결과 시연 설정</h2><div class="m-area"><span><strong>차량 상태</strong><small>실제 등록 차량 정보는 연결되지 않았습니다.</small></span><b>정차 시연</b></div><div class="m-area"><span><strong>데이터 연결</strong><small>브라우저 내 전송 상태 시연</small></span><b>${c.state.online?'온라인':'오프라인'}</b></div>${button('network',c.state.online?'오프라인으로 시연':'온라인으로 시연',`aria-pressed="${!c.state.online}"`)}${c.state.day?action(c,'dayReturnToggle',`거점 복귀 ${c.state.day.returnRequired?'필요':'선택'} · 시연`,`aria-pressed="${c.state.day.returnRequired}"`):''}<h3>알림</h3><p>OS 알림 권한과 차량 연결 알림은 이 화면에서 설정하지 않습니다.</p><h3>데이터 보관</h3><p>사진과 배송 기록은 이 브라우저에 보관됩니다. 실제 배송사·차량 서버는 연결되지 않았습니다.</p></section>`;}
function render(c,legacyPhoneHTML){if(!enabled())return legacyPhoneHTML;context=c;
 if(locked(c))return legacyPhoneHTML;
 if(intent){if(intent==='open'&&c.state.phase==='work'){ui.depth='shipment';ui.tab='delivery';}else if(intent==='plan'&&c.state.day?.stage==='planning')ui.depth='workflow';else if(intent==='workflow')ui.depth='workflow';else if(intent==='start'&&c.state.phase==='work'&&c.state.day?.stage==='delivery'){ui.depth='shipment';ui.tab='delivery';}intent=null;}
 const legacy=ui.depth==='shipment'||ui.depth==='workflow';
 // Planning/review content remains the adapter's own view, including its guarded actions.
 const content=legacy?`<div class="m-depth-bar">${button('back','‹ '+(ui.tab==='delivery'?'배송 목록':'오늘'))}<span>${ui.depth==='shipment'?'배송 상세':'업무 확인'}</span></div><div class="m-legacy">${legacyPhoneHTML}</div>`:`<div class="m-status"><span>9:41</span><span>${c.state.online?'온라인':'오프라인'}</span></div><div class="m-header"><span>NEXT</span><h1>${ui.depth==='vehicle'?'차량 상태':tabs.find(t=>t[0]===ui.tab)[1]}</h1>${ui.depth==='vehicle'?'':'<small>정차</small>'}</div>${legacyPhoneHTML.match(/<div class="p-error"[^>]*>[\s\S]*?<\/div>/)?.[0]||'<div class="p-error" role="alert" hidden></div>'}<div class="m-content" role="main" tabindex="-1">${ui.depth==='vehicle'?vehicle(c):({today,delivery:deliveries,records,more})[ui.tab](c)}</div>`;
 return `<section class="m-app" data-mobile-app data-mobile-depth="${legacy?'2':['record','vehicle'].includes(ui.depth)?'2':'1'}" data-mobile-root="${ui.tab}">${content}${nav(c)}</section>`;
}
function handleClick(event){if(!enabled()||!context)return;const b=event.target.closest('button');if(!b||b.disabled||!b.closest('#phone'))return;
 const mobile=Object.keys(b.dataset).some(k=>k.startsWith('mobile'));
 if(!mobile&&!['open','list','dayPlan','dayReplan','dayStart','openReview'].includes(b.dataset.action))return;
 if(locked(context)||modalOpen()){event.preventDefault();event.stopImmediatePropagation();return;}
 const d=b.dataset;
 if(d.mobileVehicle!==undefined||d.mobileTab||d.mobileFilter||d.mobileBack!==undefined||d.mobileRecord||d.mobileNetwork!==undefined||d.mobileWorkflow!==undefined&&!d.action||d.action==='list'){
  event.preventDefault();event.stopImmediatePropagation();
  if(d.mobileVehicle!==undefined){ui.tab='today';ui.depth='vehicle';}
  else if(d.mobileTab){if(!tabs.some(t=>t[0]===d.mobileTab))return;ui.tab=d.mobileTab;ui.depth='root';}
  else if(d.mobileFilter){if(!['pending','deferred','all'].includes(d.mobileFilter))return;ui.filter=d.mobileFilter;}
  else if(d.mobileRecord){if(!context.state.items[d.mobileRecord])return;ui.record=d.mobileRecord;ui.depth='record';}
  else if(d.mobileNetwork!==undefined){window.NextApp?.dispatch('network',{online:!context.state.online});return;}
  else if(d.mobileWorkflow!==undefined)ui.depth='workflow';
  else{ui.depth='root';if(d.action==='list')ui.tab='delivery';}
  window.NextApp?.render();return;
 }
 // Observe intent before the adapter's bubbling listener. Do not dispatch its UI action names.
 intent=d.action==='open'?'open':['dayPlan','dayReplan'].includes(d.action)?'plan':d.action==='dayStart'?'start':d.action==='openReview'?'workflow':null;
}
function decorate(c){if(!enabled())return;context=c;if(!bound){document.addEventListener('click',handleClick,true);bound=true;}}
window.NextMobile={render,decorate,enabled};
})();
