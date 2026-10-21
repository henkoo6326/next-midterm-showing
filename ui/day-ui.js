/* Selected workday excerpt views. Routes, vehicle signals and receipts remain explicit simulations. */
(()=>{'use strict';
const stages={boarding:'선택 구간',planning:'경로 선택',delivery:'배송 중',review:'남은 업무',returning:'복귀',closed:'구간 종료'};
function render(kind,c){
 const s=c.state,d=s.day;if(!d||!c.ready)return null;
 const stage=d.stage,q=c.daySummary,routes=c.dayRoutes||[],selected=routes.find(r=>r.id===d.candidateId)||routes[0],committed=routes.find(r=>r.id===d.routeId),b=c.btn,e=c.esc;
 const parked=s.vehicle==='parked',returning=stage==='returning',closed=stage==='closed',start=['boarding','planning'].includes(stage);
 const theme=typeof document!=='undefined'&&document.body.dataset.night==='true'?'dark':'light';
 const stopName=id=>c.stops.find(stop=>stop.id===id)?.name||id+'동';
 const needsWork=id=>{const i=s.items[id];return i.result==='pending'||(i.result==='delivered'&&c.parcels[id].photoRequired&&!i.proof)||i.handoff==='pending'||i.correction?.status==='pending'};
 const rows=()=>c.ids.filter(needsWork).map(id=>{const p=c.parcels[id],i=s.items[id];return b('open',`<strong>${e(stopName(p.stop))} ${p.unit}호</strong><span>${e(p.request)}</span><small>운송장 ${e(p.waybill)}</small><em>${i.result==='pending'?(i.deferred?'보류 · '+e(i.reason||'다시 배송'):'배송 대기'):i.result==='undelivered'?'미전달 · '+e(i.reason):'전달 기록 저장됨'}</em>${i.result==='delivered'&&p.photoRequired&&!i.proof?'<small class="day-warning">사진 미완료</small>':''}${i.handoff==='pending'?'<small class="day-warning">인계 확인 대기</small>':''}${i.correction?.status==='pending'?'<small class="day-warning">정정 확인 대기</small>':''}${i.result!=='pending'?'<small>'+({queued:'전송 대기',received:'수신 확인',error:'전송 실패',sending:'전송 중',unknown:'수신 확인 중'}[i.transmission]||'미제출')+'</small>':''}<span class="day-row-action">${i.result==='pending'?'배송 다시 열기':i.result==='delivered'&&p.photoRequired&&!i.proof?'사진 보완':i.handoff==='pending'?'인계 확인':'정정 상태 확인'} →</span>`,'day-shipment',`data-id="${id}"`)}).join('');
 const metrics=()=>`<div class="day-metrics"><div><b>${q.delivered}</b><span>전달 기록</span></div><div><b>${q.pending}</b><span>남은 배송</span></div><div><b>${q.unreceived}</b><span>전송 대기·실패</span></div></div>`;
 const undelivered=c.ids.filter(id=>s.items[id].result==='undelivered').length;
 const issues=()=>`${undelivered?`<p class="day-note">미전달 기록 ${undelivered}건</p>`:''}${q.deferred?`<p class="day-warning">보류 배송 ${q.deferred}건</p>`:''}${q.missingProof?`<p class="day-warning">사진 미완료 ${q.missingProof}건</p>`:''}${q.handoff?`<p class="day-warning">인계 확인 대기 ${q.handoff}건</p>`:''}${q.corrections?`<p class="day-warning">정정 확인 대기 ${q.corrections}건</p>`:''}`;
 const network=()=>`<p class="day-note">${s.online?'기기에 저장됨':'오프라인 · 기기에 저장됨'}</p>`;
 const routeOrder=r=>(r?.stops||[]).map((id,i)=>`<span><i>${i+1}</i>${e(c.stops.find(st=>st.id===id)?.shortName||stopName(id))}</span>`).join('<em>→</em>');
 const planCards=()=>routes.map((r,index)=>{
  const hasEstimate=r.stops.length>1&&[r.driveMinutes,r.serviceMinutes,r.distanceKm].every(v=>Number.isFinite(v)&&v>=0);
  return b('dayChoose',`<span class="day-route-name">경로 ${index+1}<i>${r.id===selected?.id?'선택':'보기'}</i></span><div class="day-route-order">${routeOrder(r)}</div>${hasEstimate?`<span class="day-route-numbers">약 ${r.driveMinutes+r.serviceMinutes}분 · ${r.distanceKm} km</span>`:''}`,'day-route '+(r.id===selected?.id?'selected':''),`data-route="${r.id}" aria-pressed="${r.id===selected?.id}"`);
 }).join('');
 const finalActions=()=>{
  if(closed)return b('dayRecords','이 구간 기록 보기','secondary');
  if(q.pending)return b('list','배송 목록','primary');
  if(returning&&!d.returned)return '<p class="day-note">도착 확인 대기</p>';
  if(stage==='review'&&!d.returned&&q.canReturn)return b('dayReturn','출발 지점으로 복귀','primary')+(q.canFinishWithoutReturn?b('dayFinishWithoutReturn','복귀 없이 종료','secondary'):'');
  if(q.canFinish)return b('dayFinish','작업 종료');
  return `<p class="day-note">${q.missingProof?'사진 '+q.missingProof+'건을 먼저 저장하세요.':'남은 업무를 처리한 뒤 종료할 수 있습니다.'}</p>`;
 };
 if(kind==='cluster'){
  if(stage==='delivery')return null;
  const moving=s.vehicle==='moving',unknown=s.vehicle==='unknown';const n=c.returnNavigation||{distance:'—',turn:null,label:'복귀 안내'};
  const destination=start?'출발 전':returning?'복귀 장소 · 출발 지점':closed?'구간 종료':'배송 기록 정리';
  return `<div class="a-cluster"><header><span>${destination}</span><time>09:41</time></header><main><div class="a-c-speed"><strong>${unknown?'—':moving?'24':'0'}</strong><span>km/h</span><b>${unknown?'—':moving?'D':'P'}</b></div><div class="a-c-nav"><span>${unknown?'차량 연결':moving?'다음 안내':'차량 상태'}</span><div>${moving?c.icon(n.turn==='straight'?'straight':n.turn?'turn':'alert',n.turn==='left'?'turn-left':''):`<b class="a-c-park">${unknown?'—':'P'}</b>`}<h2>${unknown?'확인 필요':moving?n.distance:'정차'}${moving?'<small>m</small>':''}</h2></div><p>${unknown?'차량 상태 미확인':moving?n.label+' · 출발 지점':start?'경로는 센터에서 확인':returning?(d.returned?'복귀 장소 도착':'복귀 안내 준비'):closed?'안전하게 하차하세요':'남은 기록은 폰에서 확인'}</p></div></main><footer><span>${c.icon('battery')}<b>${unknown?'—':'78'}</b>%</span><div class="a-c-charge"><i style="width:${unknown?0:78}%"></i></div><span>주행 가능 <b>${unknown?'—':'214'}</b> km</span><span>${unknown?'—':'22'}°C</span></footer></div>`;
 }
 if(stage==='delivery')return null;
 if(kind==='phone'){
  let body='',actions='',title=stages[stage];
  if(!parked){body=`<div class="phone-lock"><span class="lock-icon">${s.vehicle==='moving'?c.icon('vehicle'):c.icon('alert')}</span><strong>${s.vehicle==='unknown'?'차량 상태 미확인':returning?'복귀 중':'주행 중'}</strong><p>정차 후 작업을 이어가세요.</p></div>`}
  else if(stage==='boarding'){
   body=d.assignmentsReady?`<p class="eyebrow">선택 구간</p><h2 class="day-phone-title">선택 구간 배송</h2><div class="day-phone-count">${c.ids.length}<small>건</small></div><p class="helper">${c.stops.length}개 구역</p>${c.stops.map(st=>`<div class="day-assignment"><b>${e(st.name)}</b>${c.ids.filter(id=>c.parcels[id].stop===st.id).map(id=>`<p><strong>${c.parcels[id].unit}호</strong><span>${e(c.parcels[id].request)}</span><small>${e(c.parcels[id].waybill)}</small></p>`).join('')}</div>`).join('')}${network()}`:'<div class="day-empty"><h2>배정 내역 없음</h2><p>배정 목록을 불러온 뒤 경로를 선택하세요.</p></div>';
   actions=d.assignmentsReady?b('dayPlan','AI 배송 도우미'):b('dayLoad','배정 다시 불러오기');
  }else if(stage==='planning'){
   body=`<p class="eyebrow">방문 순서</p><h2 class="day-phone-title">출발 순서 확인</h2>${planCards()}${b('dayCancelPlan','이전 화면','text-action')}`;actions=b('dayStart',!routes.length?'남은 업무 보기':d.previousStage!=='boarding'?'선택한 경로 적용':'이 경로로 시작');
  }else{
   title=closed?'이 구간 기록':returning?'복귀':'남은 업무';
   body=`<p class="eyebrow">${closed?'구간 종료':returning?'복귀 장소 · 출발 지점':'배송 기록 확인'}</p><h2 class="day-phone-title">${closed?'이 구간 작업을 종료했습니다.':returning?(d.returned?'복귀했습니다.':'복귀 안내'):q.pending?'남은 배송 '+q.pending+'건':(q.missingProof||q.handoff||q.corrections?'남은 기록을 확인하세요.':'배정된 배송을 처리했습니다.')}</h2>${closed?'<p class="helper">수고하셨습니다.</p>':''}${metrics()}${issues()}${closed?'':rows()}${network()}${q.unreceived?b('dayRetry','전송 다시 시도','secondary',s.online?'':'disabled'):''}${closed?'':b('dayRecords','전체 배송 기록','text-action')}`;
   actions=finalActions();
  }
  return `<div class="p-status"><span>9:41</span><span>${s.online?'연결됨':'오프라인'} ▰</span></div><div class="p-top"><span>${title}</span></div><div class="p-error" role="alert" hidden></div><div class="p-body day-phone-body" tabindex="0">${body}</div><div class="p-actions">${actions}</div><div class="home-bar"></div>`;
 }
 if(kind==='center'){
  const locked=!parked;let panel='',footer='',map='';
  const activeRoute=stage==='planning'?selected:committed||selected;
  map=c.map({theme,mode:'overview',target:returning?s.destination:(activeRoute?.stops?.[0]||s.destination),itinerary:start?activeRoute?.stops:undefined,returning:returning,returnFrom:s.destination,hideRoute:closed||stage==='review'});
  if(locked){panel=`<p class="day-kicker">${s.vehicle==='unknown'?'차량 연결':'복귀 안내'}</p><h2>${s.vehicle==='unknown'?'차량 상태 미확인':'출발 지점으로'}</h2><p>${s.vehicle==='unknown'?'정차 상태를 확인하면 작업을 이어갑니다.':'다음 회전은 클러스터에서 확인하세요.'}</p>`;footer='<span>주행 중 작업 입력 잠금</span>'}
  else if(stage==='boarding'){
   panel=d.assignmentsReady?`<p class="day-kicker">선택 구간 배송 계획</p><h2>선택 구간 배송</h2><div class="day-hero-count">${c.ids.length}<small>건</small><span>${c.stops.length}개 구역</span></div><div class="day-building-list">${c.stops.map(st=>`<div><b>${e(st.name)}</b><span>${c.ids.filter(id=>c.parcels[id].stop===st.id).length}건</span></div>`).join('')}</div><img class="day-parcel" src="assets/parcel-styles/05-lowpoly.png" alt="로우폴리 상자, 포장 유형 예시">`:'<p class="day-kicker">선택 구간 배송 계획</p><h2>배정 내역 없음</h2><p>배정 자료를 불러오면 배송 구역과 경로를 확인할 수 있습니다.</p>';
   footer=`<span>${s.online?'배정 목록':'오프라인 · 저장된 배정 목록'}</span>${d.assignmentsReady?b('dayPlan','AI 배송 도우미'):b('dayLoad','배정 다시 불러오기')}`;
  }else if(stage==='planning'){
   panel=`<p class="day-kicker">방문 순서</p><h2>${routes.length>1?'어느 구역부터<br>시작할까요?':'남은 배송을<br>확인하세요.'}</h2><p class="day-note">${q.pending}건의 남은 배송 · ${routes.length>1?"두 방문 순서 비교":"방문 순서 확인"}</p><div class="day-route-cards">${planCards()}</div>`;
   footer=`${b('dayCancelPlan','취소','secondary')}${b('dayStart',!routes.length?'남은 업무 보기':d.previousStage!=='boarding'?'선택한 경로 적용':'이 경로로 시작')}`;
  }else{
   panel=`<p class="day-kicker">${closed?'이 구간 기록':returning?'복귀 장소 · 출발 지점':'남은 업무 확인'}</p><h2>${closed?'이 구간 작업을<br>마쳤습니다.':returning?(d.returned?'복귀했습니다.':'출발 지점으로<br>복귀합니다.'):q.pending?'남은 배송<br>'+q.pending+'건':(q.missingProof||q.handoff||q.corrections?'남은 기록을<br>확인하세요.':'배정된 배송을<br>처리했습니다.')}</h2>${closed?'<p class="day-farewell">수고하셨습니다.</p>':''}${metrics()}${issues()}${network()}`;
   footer=`<span>${q.unreceived?'전송 대기·실패 '+q.unreceived+'건 · 기기에 저장됨':'배송 상세 기록은 폰에서 확인'}</span>${finalActions()}`;
  }
  return `<div class="nx-a day-center day-${stage}"><header class="a-top"><b class="a-wordmark">NEXT<span>↗</span></b><span class="a-service">${e(c.stops.map(st=>st.shortName||st.area||st.name).join(" · "))}</span><span class="a-top-status">${stages[stage]}</span><span class="a-link">${s.online?'연결됨':'오프라인'}</span><time>09:41</time></header><div class="c-body day-main" tabindex="-1"><div class="day-map">${map}<a class="nx-map-credit" href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a></div><aside class="day-panel">${panel}</aside>${start&&d.assignmentsReady?`<div class="day-map-order"><span>방문 순서</span><div>${routeOrder(activeRoute)}</div></div>`:''}${returning?'<div class="day-map-order"><span>복귀 장소</span><strong>출발 지점</strong></div>':''}</div><footer class="day-bottom">${footer}<b class="day-gear">${s.vehicle==='unknown'?'—':s.vehicle==='moving'?'D':'P'}</b></footer></div>`;
 }
 return null;
}
window.NextDayUI={render,stages};
})();
