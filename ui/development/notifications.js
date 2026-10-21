/* Native DOM/SVG navigation studies derived from the inspected vehicle-9a109
 * reference. All values are explicitly simulated outside the notification card.
 * No vehicle, navigation, battery, OS notification or delivery state is read. */
(function(root,factory){
 'use strict';
 const common=typeof module==='object'&&module.exports;
 const api=factory(common?require('./icons/icons.js'):root.NextIcons);
 if(common)module.exports=api;else root.NextNotifications=api;
})(typeof window!=='undefined'?window:globalThis,function(Icons){
 'use strict';
 const titles=Object.freeze({turn:'다음 회전',nextturn:'이어지는 회전',lane:'차로 안내',arrival:'목적지 도착',reroute:'경로 재탐색',lowbattery:'배터리 부족',chargewaypoint:'충전 경유',chargecomplete:'충전 완료'});
 const types=Object.freeze(Object.keys(titles));
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const text=(d,key,fallback)=>esc(d[key]??fallback);
 function glyph(name){if(!Icons)throw Error('Load icons/icons.js before notifications.js');return Icons.icon(name,'filled',{decorative:true});}
 function arrow(direction='right',className=''){
  const straight=direction==='straight',left=direction==='left';
  const shape=direction==='uturn'?'M8 44V19a15 15 0 0 1 30 0v7h8L34 41 22 26h8v-7a7 7 0 0 0-14 0v25Z':straight?'M22 44Q20 44 20 42V19H13Q11 19 12.3 17.5L23 4Q24 2.7 25 4L35.7 17.5Q37 19 35 19H28V42Q28 44 26 44Z':'M10 44Q8 44 8 42V29C8 18.5 16.5 10 27 10H30V4Q30 2 31.5 3.3L44 13Q45.3 14 44 15L31.5 24.7Q30 26 30 24V18H27C20.9 18 16 22.9 16 29V42Q16 44 14 44Z';
  return `<svg class="nn-arrow ${className}" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path fill="currentColor" d="${shape}"${left?' transform="translate(48 0) scale(-1 1)"':''}/></svg>`;
 }
 function render(type,data={}){
  if(!types.includes(type))throw new RangeError('Unknown NEXT notification: '+type);
  if(!data||typeof data!=='object'||Array.isArray(data))throw new TypeError('Notification data must be an object');
  const clone=data.variant==='clone',variant=clone?'clone':'next';
  const critical=type==='lowbattery'&&data.severity==='critical';
  const severity=critical?'critical':type==='lowbattery'?'warning':'normal';
  const direction=['left','right','straight','uturn'].includes(data.direction)?data.direction:(type==='lane'?'left':'right');
  const road=text(data,'road',clone?'ул. 2-я Крылатская':'서울숲2길');
  const distance=text(data,'distance',clone?'515':'300'),unit=text(data,'unit','m');
  const metric=(value,u)=>`<strong class="nn-metric">${value}<small>${u}</small></strong>`;
  const trip=`<footer class="nn-trip"><div><span>${text(data,'duration',clone?'47 мин':'12분')}</span><span>${text(data,'eta','10:01')}</span><span>${text(data,'remaining',clone?'2,6 км':'2.6 km')}</span></div><p>${text(data,'destination',clone?'Surf Coffee':'서울숲길 구역 104동')}</p></footer>`;
  let body='';
  switch(type){
   case 'turn':body=`<div class="nn-main">${arrow(direction)}<div class="nn-distance-row">${metric(distance,unit)}<span class="nn-road-badge">${text(data,'routeCode',clone?'M90':'서울숲')}</span></div><p class="nn-road">${road}</p></div>${trip}`;break;
   case 'nextturn':body=`<div class="nn-next-main"><p class="nn-overline">${clone?'':text(data,'label','이어서')}</p>${metric(text(data,'distance','280'),unit)}${arrow(direction)}<p class="nn-road">${text(data,'road',clone?'ул. Достоевского':'왕십리로')}</p></div>`;break;
   case 'lane':{
    const count=Number.isInteger(data.lanes)?Math.max(2,Math.min(5,data.lanes)):4;
    const chosen=Number.isInteger(data.activeLane)?Math.max(0,Math.min(count-1,data.activeLane)):0;
    body=`<div class="nn-lanes" role="img" aria-label="${count}개 차로 중 왼쪽에서 ${chosen+1}번째 차로 안내">${Array.from({length:count},(_,i)=>`<span class="${i===chosen?'is-active':''}">${arrow(i===chosen?direction:'straight')}</span>`).join('')}</div>${clone?'':`<div class="nn-lane-caption"><strong>왼쪽에서 ${chosen+1}번째 차로</strong><span>${text(data,'distance','300')} ${unit} 앞 ${direction==='left'?'좌회전':direction==='straight'?'직진':'우회전'}</span></div>`}`;break;
   }
   case 'arrival':body=`<div class="nn-place"><div class="nn-grab" aria-hidden="true"></div><p class="nn-overline">${clone?'Место назначения':'목적지 도착'}</p><h3>${text(data,'destination',clone?'Бургер Кинг':'104동 입구')}</h3><p class="nn-road">${text(data,'road',clone?'Чистопольская ул., 33В':'서울숲길 구역')}</p><div class="nn-place-bottom">${glyph('check')}<p>${clone?'Маршрут завершён':'안전하게 정차한 뒤<br>배송 요청을 확인하세요.'}</p></div></div>`;break;
   case 'reroute':body=`<div class="nn-reroute-content"><span class="nn-symbol nn-symbol-info">${glyph('route')}</span><div><span class="nn-priority">${clone?'Маршрут':'경로 변경'}</span><h3>${text(data,'title',clone?'Перестроение маршрута':'경로 재탐색 중')}</h3><p>${text(data,'message',clone?'Ожидайте обновления':'도로 표지를 따르세요.')}</p></div></div>`;break;
   case 'lowbattery':{
    const percent=Number.isFinite(Number(data.battery))&&data.battery!==null?Math.max(0,Math.min(100,Number(data.battery))):critical?5:15;
    body=clone?`<div class="nn-energy-strip"><b>P</b><div>${metric('0','км/ч')}</div><div class="nn-energy-value">${glyph('charge')}${metric(text(data,'range','89'),'км')}</div></div>`:critical?`<div class="nn-critical-head">${glyph('alert')}<span>배터리 부족 · 긴급</span></div><div class="nn-critical-body">${glyph('battery')}${metric(esc(percent),'%')}<div><h3>안전한 곳에 정차하세요</h3><p>정차 후 충전 경로를 확인하세요.</p></div></div>`:`<div class="nn-energy-warning"><span class="nn-symbol nn-symbol-warning">${glyph('battery')}</span><div><span class="nn-priority">배터리 부족 · 주의</span><h3>정차 후 충전 경로 확인</h3><p>예상 주행 가능 ${text(data,'range','35')} km</p></div>${metric(esc(percent),'%')}</div>`;break;
   }
   case 'chargewaypoint':body=`<div class="nn-charge-place"><div class="nn-charge-symbol">${glyph('charge')}</div><p class="nn-overline">${clone?'Зарядная станция':'충전 경유지'}</p><h3>${text(data,'charger',clone?'Зарядная станция':'성수 공영주차장 충전소')}</h3><p class="nn-road">${text(data,'road',clone?'По маршруту':'현재 안내 경로에 포함')}</p><div class="nn-charge-bottom">${metric(text(data,'distance',clone?'3':'1.2'),clone?'км':'km')}<span>${clone?'Через '+text(data,'duration','12 мин'):text(data,'duration','4분')+' 후 도착'}</span></div></div>`;break;
   case 'chargecomplete':body=`<div class="nn-charge-done"><span class="nn-complete-symbol">${glyph('check')}</span><div><p class="nn-overline">${clone?'Зарядка завершена':'충전 완료'}</p><h3>${text(data,'title',clone?'Можно продолжать путь':'충전 케이블을 분리하세요')}</h3><p>${text(data,'message',clone?'Проверьте подключение':'출발 전 연결 상태를 확인하세요.')}</p></div>${metric(text(data,'battery','80'),'%')}</div>`;break;
  }
  return `<figure class="nn-unit nn-${variant}"><div class="nn-card nn-${type} nn-${severity}" role="group" aria-label="${titles[type]}${critical?' · 긴급':''}">${body}</div><figcaption class="nn-demo-scope">${clone?'원본 구조를 코드로 재현한 연구':'NEXT 적용 시연'} · 표시된 거리·시간·차로·배터리·충전 상태는 모두 가상값입니다. 실제 차량·길안내 연결 없음.</figcaption></figure>`;
 }
 return Object.freeze({render,arrow,types,titles,version:'1.1.0'});
});

/* Standalone three-column study; inert when this script is used in the app. */
if(typeof document!=='undefined')document.addEventListener('DOMContentLoaded',()=>{
 const root=document.querySelector('[data-next-notifications-study]');if(!root)return;
 const N=window.NextNotifications;
 const sections={
  turn:{crop:[58,56,606,483],fact:'큰 우회전 화살표 → 515m → 도로명. 아래 회색 밴드에 시간·도착·거리.',change:'비율과 분리된 하단 밴드를 유지하고 도로·목적지 문구를 NEXT에 맞췄습니다.'},
  nextturn:{crop:[809,598,337,375],fact:'세로 카드 위 거리, 중앙 큰 화살표, 아래 도로명.',change:'현재 안내와 구분하는 “이어서” 라벨을 추가했습니다.'},
  lane:{crop:[57,598,280,157],fact:'파란 말풍선 안 네 화살표. 좌회전만 흰색으로 강조.',change:'꼬리 없는 캡슐에 같은 굵기의 채움 화살표를 배치합니다. 선택 차로만 선명하게, 나머지는 낮은 불투명도로 구분합니다.'},
  arrival:{crop:[57,969,458,332],fact:'장소 상세 카드가 원본에 있습니다. 도착 알림 자체는 관찰되지 않았습니다.',change:'장소 카드 위계를 빌린 도착 확장안. 주행 중 전화·경로 버튼은 제외했습니다.',extended:true},
  reroute:{crop:[58,1353,458,182],fact:'원본은 경로 요약과 색상 진행선입니다. 재탐색 알림은 관찰되지 않았습니다.',change:'넓은 하단 모듈을 재탐색 상태에 확장. 파란 채움 경로 심벌과 평면 배경을 사용하며 세로 강조선·가짜 진행률은 넣지 않습니다.',extended:true},
  lowbattery:{crop:[632,1348,516,137],fact:'P / 0 / 빨강 89km의 분할 구조. 실제 경고 조건과 배터리 잔량은 확인되지 않았습니다.',change:'주의는 황색 채움 배터리·부드러운 배경과 가로 배치, 긴급은 붉은 알림 면·분리된 행동 지시로 구분합니다. 세로 강조선은 사용하지 않습니다.',extended:true},
  chargewaypoint:{crop:[57,969,458,332],fact:'장소 카드의 제목·주소·하단 행동 영역을 참고했습니다. 충전소 화면은 원본에 없습니다.',change:'충전 경유 정보로 확장. 충전기 가용성이나 예약 성공을 표시하지 않습니다.',extended:true},
  chargecomplete:{crop:[632,1348,516,137],fact:'하단 에너지 모듈을 참고했습니다. 충전 완료 화면은 원본에 없습니다.',change:'채움 완료 심벌과 케이블 확인 문구로 충전 종료를 표현하는 확장안입니다.',extended:true}
 };
 root.innerHTML=N.types.map(type=>{const s=sections[type],c=s.crop;return `<section class="ns-row" id="notice-${type}"><header class="ns-row-head"><h2>${N.titles[type]}</h2><code>${type}</code>${type==='lowbattery'?'<fieldset class="ns-severity"><legend>배터리 경고 비교</legend><label><input type="radio" name="severity" value="warning" checked>주의</label><label><input type="radio" name="severity" value="critical">긴급</label></fieldset>':''}</header><div class="ns-three"><figure class="ns-source"><h3>원본${s.extended?' · 인접 모듈':''}</h3><a href="references/vehicle-9a109.jpg" target="_blank" rel="noopener" aria-label="${N.titles[type]} 참고 원본 전체 이미지 열기"><svg viewBox="${c.join(' ')}" role="img" aria-label="vehicle-9a109 원본 영역"><image href="references/vehicle-9a109.jpg" width="1200" height="1600"/></svg></a><figcaption>${s.fact}</figcaption></figure><div class="ns-example"><h3>코드 재현${s.extended?' · 구조 확장':''}</h3><div class="ns-stage ns-clone-stage">${N.render(type,{variant:'clone'})}</div><p class="ns-note">${s.extended?'원본에 없는 상태는 관찰한 모듈 구조를 확장했습니다. 원본 화면의 동일 재현으로 주장하지 않습니다.':'이미지 없이 HTML·CSS·자체 SVG로 재현했습니다. 정확한 서체·치수는 추정입니다.'}</p></div><div class="ns-example"><h3>NEXT 적용</h3><div class="ns-stage ns-next-stage" data-next-type="${type}">${N.render(type)}</div><p class="ns-note">${s.change}</p></div></div></section>`;}).join('');
 root.querySelectorAll('input[name="severity"]').forEach(el=>el.addEventListener('change',()=>{root.querySelector('[data-next-type="lowbattery"]').innerHTML=N.render('lowbattery',{severity:el.value});document.querySelector('#ns-status').textContent=`배터리 ${el.value==='critical'?'긴급':'주의'} 레이아웃 표시`;}));
 document.querySelector('#ns-layout').addEventListener('change',event=>{root.classList.toggle('ns-compact',event.target.checked);});
});
