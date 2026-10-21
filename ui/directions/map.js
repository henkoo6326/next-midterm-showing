/* OSM vector geometry. All delivery overlays are explicit study scenarios. */
(()=>{'use strict';
const palettes={
light:{ground:'#E9EEF2',land:'#E2E7EA',green:'#CBE4D5',water:'#B9D9E7',building:'#D7DFE5',roof:'#E1E7EB',edge:'#C4CED6',road:'#FAFCFD',major:'#FFFFFF',line:'#D3DCE3',text:'#687C8C',label:'#435A6B',route:'#2279E5',halo:'#FFFFFF',selected:'#B8D6F7',point:'#FFFFFF',shadow:'#C2CBD3'},
dark:{ground:'#172630',land:'#1B2B36',green:'#1A3C3D',water:'#133344',building:'#243945',roof:'#314B5A',edge:'#304A59',road:'#344C5C',major:'#426175',line:'#1C303E',text:'#8AA6B8',label:'#B3C8D5',route:'#63BFFF',halo:'#174B70',selected:'#245675',point:'#E4F4FF',shadow:'#11212C'},
silver:{ground:'#EBEBEF',land:'#E1E3E9',green:'#D9E1DD',water:'#CBD9E4',building:'#CDD1DA',roof:'#F7F7FA',edge:'#B9BFCC',road:'#FDFDFE',major:'#FFFFFF',line:'#C9CDD7',text:'#757D91',label:'#5B6276',route:'#6C63C9',halo:'#FDFDFF',selected:'#C3BFF1',point:'#FFFFFF',shadow:'#B9BECD'},
paper:{ground:'#F2F3F3',land:'#EAEBE9',green:'#E0E7DE',water:'#D9E3E8',building:'#DADDDE',roof:'#E6E8E8',edge:'#C4CBCD',road:'#FFFFFF',major:'#FFFFFF',line:'#CACFD1',text:'#7B8587',label:'#566264',route:'#172E3D',halo:'#FFFFFF',selected:'#BFCDD3',point:'#FFFFFF',shadow:'#CBD1D2'},
mint:{ground:'#1C2928',land:'#223231',green:'#29473B',water:'#203A43',building:'#354643',roof:'#4A5D57',edge:'#49625B',road:'#4E605A',major:'#61736A',line:'#283D36',text:'#9AB3A6',label:'#C1D3C9',route:'#B9EF96',vehicle:'#385E35',halo:'#244438',selected:'#668866',point:'#EBF6DD',shadow:'#192621'}
};
palettes.silverNight={...palettes.dark,ground:'#24252F',land:'#292B36',green:'#303C3B',building:'#3C4050',roof:'#56596A',edge:'#575F75',road:'#4A4D60',major:'#5A5E72',line:'#222636',text:'#A4A9BD',label:'#C0C4D4',route:'#BBB2F3',vehicle:'#51418A',halo:'#383653',selected:'#716790',point:'#EAE7FE',shadow:'#222632'};
palettes.paperNight={...palettes.dark,ground:'#24282A',land:'#2A2F30',green:'#303C35',building:'#3C4243',roof:'#565D5E',edge:'#505B5D',road:'#515D5F',major:'#647174',line:'#232A2D',text:'#A6B5B6',label:'#C1CBCC',route:'#E0EBEE',vehicle:'#263A45',halo:'#37464B',selected:'#667A80',point:'#FFFFFF',shadow:'#242E31'};
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const path=pts=>pts.map((p,i)=>(i?'L':'M')+p[0]+','+p[1]).join('');
const points=pts=>pts.map(p=>p.join(',')).join(' ');
const len=pts=>pts.slice(1).reduce((a,p,i)=>a+Math.hypot(p[0]-pts[i][0],p[1]-pts[i][1]),0);
const mid=pts=>{const length=len(pts),goal=length*.5;let d=0;for(let i=1;i<pts.length;i++){const seg=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);if(d+seg>=goal){const t=seg?(goal-d)/seg:0;return [pts[i-1][0]+(pts[i][0]-pts[i-1][0])*t,pts[i-1][1]+(pts[i][1]-pts[i-1][1])*t,Math.atan2(pts[i][1]-pts[i-1][1],pts[i][0]-pts[i-1][0])*180/Math.PI]}d+=seg}return [...pts[0],0]};
const center=pts=>pts.reduce((a,p)=>[a[0]+p[0]/pts.length,a[1]+p[1]/pts.length],[0,0]);
const bounds=f=>{const xs=f.pts.map(p=>p[0]),ys=f.pts.map(p=>p[1]);return [Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]};
const unavailable=()=>({available:false,distance:'—',turn:null,label:'지도 확인 필요'});
const mapError=()=>'<div class="nx-map-error" role="status"><strong>지도를 불러오지 못했습니다.</strong><span>배송 주소와 요청은 확인할 수 있습니다.</span></div>';
const demo=window.NEXT_DEMO_ROUTE_DATA;const data=window.NEXT_MAP_DATA?{...window.NEXT_MAP_DATA,...(demo?{routes:demo.routes}: {})}:null;if(!data){window.NextMap={render:mapError,navigation:unavailable,decorate(){},controls:()=>'',zoom:1,setZoom:()=>1,features:0};return}
const fs=data.features.map(f=>({...f,bounds:bounds(f)}));
// Join fixture branches through their shared road nodes; no access/traffic claims.
function dayPoints(options,target){
 if(demo){
   const order=(options.hideRoute?[]:options.itinerary||[]).filter(id=>demo.stops[id]);
   if(options.returning)return demo.legs[(options.returnFrom||target)+':depot']?.points||demo.routes[target].points.slice().reverse();
   if(order.length){let from=options.from||'depot',pts=[];for(const stop of order){if(from===stop)continue;const leg=demo.legs[from+':'+stop];if(leg)pts.push(...(pts.length?leg.points.slice(1):leg.points));from=stop;}if(pts.length)return pts;}
   return demo.legs[(options.from||'depot')+':'+target]?.points||demo.routes[target].points;
 }

 const base=data.routes[target]||data.routes['104'];
 if(options.returning)return [...base.points].reverse();
 const order=(options.hideRoute?[]:options.itinerary||[]).filter(id=>data.routes[id]);
 if(!order.length)return base.points;
 let route=[...data.routes[order[0]].points];
 for(let i=1;i<order.length;i++){
  const from=data.routes[order[i-1]].points,to=data.routes[order[i]].points;let common=0;
  while(common<Math.min(from.length,to.length)&&from[common][0]===to[common][0]&&from[common][1]===to[common][1])common++;
  route.push(...from.slice(Math.max(0,common-1),-1).reverse(),...to.slice(common));
 }
 return route;
}
function render(options={}){
 if(demo&&options.from===null&&options.mode==='drive')options={...options,unknown:true};
 let {theme='light',mode='overview',target='104',labels=true,moving=false,unknown=false,zoom=1}=options;
 const design=typeof document!=='undefined'?document.body?.dataset.design:null;
 if(design==='night')theme='mint';else if(design==='paper')theme=theme==='dark'?'paperNight':'paper';
 const driving=mode==='drive'&&!unknown&&!options.hideRoute;
 const cameraRoute=dayPoints(options,target),cameraStart=cameraRoute[0],cameraNext=cameraRoute[1]||cameraStart;
 const cameraHeading=Math.atan2(cameraNext[1]-cameraStart[1],cameraNext[0]-cameraStart[0])*180/Math.PI+90;
 const p=palettes[theme]||palettes.light,r=data.routes[target]||data.routes['104'],view=demo&&mode!=='drive'?[...demo.viewBox]:mode==='building'?[200,290,1000,450]:mode==='drive'?[100,165,1120,747]:[110,160,1120,747];
 if(options.parkedTarget&&demo){view[2]=1000;view[3]=700;view[0]=r.points.at(-1)[0]-500;view[1]=r.points.at(-1)[1]-350;}
 if(driving){view[0]=cameraStart[0]-view[2]*.5;view[1]=cameraStart[1]-view[3]*.74;}
 if(zoom!==1&&!driving){const w=view[2]/zoom,h=view[3]/zoom,focus=r.points.at(-1);view[0]=focus[0]-w*.58;view[1]=focus[1]-h*.55;view[2]=w;view[3]=h}
 const v={x:view[0],y:view[1],w:view[2],h:view[3]},inside=(x,y,pad=20)=>x>v.x+pad&&x<v.x+v.w-pad&&y>v.y+pad&&y<v.y+v.h-pad;
 const visible=fs.filter(f=>driving||f.bounds[2]>v.x-100&&f.bounds[0]<v.x+v.w+100&&f.bounds[3]>v.y-100&&f.bounds[1]<v.y+v.h+100);
 const lands=visible.filter(f=>['land','green','water'].includes(f.kind)).sort((a,b)=>({land:0,green:1,water:2}[a.kind]-({land:0,green:1,water:2}[b.kind])));
 const roads=visible.filter(f=>f.kind==='road');
 const buildings=visible.filter(f=>f.kind==='building').sort((a,b)=>a.bounds[3]-b.bounds[3]);
 const roadWidth=f=>({motorway:18,trunk:16,primary:15,secondary:12,tertiary:9,residential:6.5,unclassified:6,service:4.5,living_street:5,footway:2,path:1.4,cycleway:2,steps:1.5,pedestrian:4}[f.sub]||3);
 const roadLayer=(edge)=>roads.map(f=>`<path d="${path(f.pts)}" stroke="${edge?p.line:(['footway','path','steps','cycleway'].includes(f.sub)?p.road:roadWidth(f)>8?p.major:p.road)}" stroke-width="${roadWidth(f)+(edge?2:0)}" ${f.tunnel?'stroke-dasharray="5 3" opacity=".65"':''}/>`).join('');
 const roofs=buildings.map(f=>{const isTarget=f.id===r.buildingId;const raised=mode==='building'?Math.min(30,4+f.levels*.8):0;const top=f.pts.map(([x,y])=>[x-raised*.32,y-raised]);let sides='';if(raised){for(let i=1;i<f.pts.length;i++){const a=f.pts[i-1],b=f.pts[i];sides+=`<polygon points="${points([a,b,top[i],top[i-1]])}" fill="${b[0]>a[0]?p.edge:p.shadow}"/>`}}return `${sides}<polygon class="nx-map-building${isTarget?' is-target':''}" data-osm-id="${f.id}" points="${points(top)}" fill="${isTarget?p.selected:raised?p.roof:p.building}" stroke="${isTarget?p.route:p.edge}" stroke-width="${isTarget?1.5:.55}"/>`}).join('');
 const used=[],mapLabels=[];
 const reserve=(x,y,w,h)=>{if(used.some(b=>Math.abs(x-b.x)<(w+b.w)/2&&Math.abs(y-b.y)<(h+b.h)/2))return false;used.push({x,y,w,h});return true};
 if(labels){
  const names=new Map();for(const f of roads){if(!f.name||f.sub==='service'||['footway','cycleway','steps','path'].includes(f.sub))continue;const segment=f.pts.filter(pt=>inside(...pt,35));if(segment.length<2||len(segment)<90)continue;const old=names.get(f.name);if(!old||len(segment)>len(old.pts))names.set(f.name,{...f,pts:segment})}
  for(const f of [...names.values()].sort((a,b)=>roadWidth(b)-roadWidth(a))){let [x,y,rot]=mid(f.pts);if(rot>90)rot-=180;if(rot< -90)rot+=180;if(!inside(x,y,45)||!reserve(x,y,f.name.length*13,35))continue;mapLabels.push(`<text class="nx-road-label" transform="translate(${x.toFixed(1)} ${(y-5).toFixed(1)}) rotate(${(driving?cameraHeading:rot).toFixed(1)})" fill="${p.label}" font-size="${mode==='building'?12:13}" text-anchor="middle" paint-order="stroke" stroke="${p.ground}" stroke-width="3">${esc(f.name)}</text>`)}
  const picked=buildings.filter(f=>f.id===r.buildingId||/^(10[1-9](동)?)$/.test(f.name));for(const f of picked){let[x,y]=center(f.pts);if(mode==='building')y-=Math.min(30,4+f.levels*.8);if(!inside(x,y,35)||!reserve(x,y,42,25))continue;mapLabels.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" fill="${f.id===r.buildingId?p.route:p.text}" font-size="${f.id===r.buildingId?15:11}" font-weight="${f.id===r.buildingId?600:400}">${esc(f.name.replace('동',''))}</text>`)}
  const parks=visible.filter(f=>f.kind==='green'&&f.name);for(const f of parks){const [x,y]=center(f.pts);if(inside(x,y,45)&&reserve(x,y,90,40))mapLabels.push(`<text x="${x}" y="${y}" fill="${p.text}" font-size="16" text-anchor="middle">${esc(f.name)}</text>`)}
  // This label names the geographic park, not a delivery location.
  if(inside(230,480,50)&&reserve(230,480,80,40))mapLabels.push(`<text x="230" y="480" fill="${p.text}" font-size="17" text-anchor="middle">서울숲</text>`);
 }
 const route=dayPoints(options,target);const start=route[0],end=route.at(-1);const next=route[1]||start;const heading=Math.atan2(next[1]-start[1],next[0]-start[0])*180/Math.PI+90;
 const vehiclePoint=options.parkedTarget?end:start;
 const overlay=unknown||options.hideRoute?'':`<path class="nx-map-route-halo" d="${path(route)}" fill="none" stroke="${p.halo}" stroke-width="12" stroke-linejoin="round" stroke-linecap="round"/><path class="nx-map-route" d="${path(route)}" fill="none" stroke="${p.route}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${end[0]}" cy="${end[1]}" r="7" fill="${p.point}" stroke="${p.route}" stroke-width="3"/>${options.parkedTarget?'':`<g class="nx-map-vehicle" transform="translate(${vehiclePoint.join(' ')}) rotate(${heading})"><circle r="20" fill="${p.point}" stroke="${p.route}" stroke-width="2"/><path d="M0 -12L10 11 0 6 -10 11Z" fill="${p.vehicle||p.route}"/></g>`}`;
 if(driving){for(let i=0;i<mapLabels.length;i++){if(!mapLabels[i].includes('transform=')){mapLabels[i]=mapLabels[i].replace(/<text x="([^"]+)" y="([^"]+)"/,(_,x,y)=>`<text transform="rotate(${cameraHeading} ${x} ${y})" x="${x}" y="${y}"`);}}}
 const orderPins=(options.hideRoute?[]:options.itinerary||[]).filter(id=>data.routes[id]).map((id,i)=>{const pt=data.routes[id].points.at(-1);return `<g transform="translate(${pt[0]} ${pt[1]-24})" aria-label="방문 ${i+1} · ${id}동"><circle r="14" fill="${p.route}" stroke="${p.point}" stroke-width="2"/><text y="5" fill="${p.point}" text-anchor="middle" font-size="14" font-family="Arial">${i+1}</text></g>`}).join('');
 const areaPins=demo&&!driving&&!options.hideRoute?Object.values(demo.stops).map(st=>`<text x="${st.point[0]}" y="${st.point[1]+30}" fill="${p.route}" font-size="18" font-weight="600" text-anchor="middle" paint-order="stroke" stroke="${p.ground}" stroke-width="4">${esc(st.shortName)} · ${st.id}동</text>`).join(''):'';
 const returnPin=options.returning&&!options.hideRoute?`<g aria-label="복귀 장소"><text x="${end[0]}" y="${end[1]-20}" fill="${p.route}" text-anchor="middle" font-size="17">출발 지점</text></g>`:'';
 return `<svg data-fit-overview="${!!demo&&!driving&&!options.parkedTarget&&zoom===1}" data-fit-box="${view.join(' ')}" data-camera="${driving?'heading-up':'overview'}" data-camera-x="${cameraStart[0]}" data-camera-y="${cameraStart[1]}" data-camera-heading="${cameraHeading}" data-itinerary="${esc((options.itinerary||[]).join(','))}" data-returning="${!!options.returning}" class="nx-map nx-map-${theme}" xmlns="http://www.w3.org/2000/svg" viewBox="${view.join(' ')}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="성수동 OSM 도로·건물 지도, 배송 경로는 시연"><title>성수동 도로와 건물 형상 · OSM / 가상 배송 경로</title><rect x="${v.x}" y="${v.y}" width="${v.w}" height="${v.h}" fill="${p.ground}"/><g class="nx-map-world" ${driving?`transform="rotate(${-cameraHeading} ${cameraStart.join(' ')})"`: ''}><g class="nx-map-land">${lands.map(f=>`<path d="${path(f.pts)}Z" fill="${f.kind==='green'?p.green:f.kind==='water'?p.water:p.land}"/>`).join('')}</g><g class="nx-map-roads" fill="none" stroke-linejoin="round" stroke-linecap="round">${roadLayer(true)}${roadLayer(false)}</g><g class="nx-map-buildings">${roofs}</g><g class="nx-map-labels" font-family="Wanted,Arial,sans-serif">${mapLabels.join('')}</g><g class="nx-map-overlays">${overlay}${orderPins}${returnPin}${areaPins}</g></g><g class="nx-map-decoration" fill="${p.label}" stroke="${p.label}" data-map-color="${p.label}"/> </svg>`;
}
function navigation(target='104',options={}){
 if(demo&&options.from===null&&!options.returning)return {available:false,distance:'—',turn:null,label:'출발 위치 미확인'};
 const original=data.routes[target]||data.routes['104'];const r={...original,points:dayPoints(options,target)};if(options.returning)target='depot';let walked=0;
 for(let i=1;i<r.points.length-1;i++){const a=r.points[i-1],b=r.points[i],c=r.points[i+1];walked+=Math.hypot(b[0]-a[0],b[1]-a[1]);const d=((Math.atan2(c[1]-b[1],c[0]-b[0])-Math.atan2(b[1]-a[1],b[0]-a[0]))*180/Math.PI+540)%360-180;if(Math.abs(d)>40&&walked>30)return {distance:Math.round(walked/10)*10,turn:d>0?'right':'left',label:d>0?'우회전':'좌회전',target,derived:true}}
 // OSM curves often split a turn over several short segments. Compare bearings
 // across a 40 m window before treating a whole route as one straight segment.
 let distance=0;
 for(let i=1;i<r.points.length-1;i++){
   distance+=Math.hypot(r.points[i][0]-r.points[i-1][0],r.points[i][1]-r.points[i-1][1]);
   let a=i-1,c=i+1;
   while(a>0&&Math.hypot(r.points[i][0]-r.points[a][0],r.points[i][1]-r.points[a][1])<40)a--;
   while(c<r.points.length-1&&Math.hypot(r.points[c][0]-r.points[i][0],r.points[c][1]-r.points[i][1])<40)c++;
   const before=Math.atan2(r.points[i][1]-r.points[a][1],r.points[i][0]-r.points[a][0]),after=Math.atan2(r.points[c][1]-r.points[i][1],r.points[c][0]-r.points[i][0]),delta=((after-before)*180/Math.PI+540)%360-180;
   if(Math.abs(delta)>42&&distance>50)return {distance:Math.round(distance/10)*10,turn:delta>0?'right':'left',label:delta>0?'우회전':'좌회전',target,derived:true};
 }
 return {distance:Math.round(len(r.points)/10)*10,turn:'straight',label:'직진',target,derived:true};
}
function decorate(root=document){
 for(const svg of root.querySelectorAll('svg.nx-map')){
  const layer=svg.querySelector('.nx-map-decoration'),box=svg.viewBox.baseVal,w=svg.clientWidth,h=svg.clientHeight;if(!layer||!w||!h)continue;
  if(svg.dataset.fitOverview==='true'){const [bx,by,bw,bh]=svg.dataset.fitBox.split(' ').map(Number),height=Math.max(bh,bw*h/w),width=height*w/h;svg.setAttribute('viewBox',`${bx+bw/2-width/2} ${by+bh/2-height/2} ${width} ${height}`);}
  if(svg.dataset.camera==='heading-up'){const height=620,width=height*w/h;svg.setAttribute('viewBox',`${+svg.dataset.cameraX-width*.5} ${+svg.dataset.cameraY-height*.74} ${width} ${height}`);}
  const k=Math.max(w/box.width,h/box.height),x=box.x+(box.width-w/k)/2,y=box.y+(box.height-h/k)/2,small=!!svg.closest('#cluster'),variant=document.body.dataset.direction;
  for(const text of svg.querySelectorAll('.nx-map-labels text')){const base=+(text.dataset.mapFontSize||text.getAttribute('font-size')||13);text.dataset.mapFontSize=base;text.style.fontSize=(base/k)+'px';if(text.hasAttribute('stroke-width'))text.style.strokeWidth=3/k}
  const marker=svg.querySelector('.nx-map-vehicle');if(marker){const original=marker.dataset.mapTransform||marker.getAttribute('transform');marker.dataset.mapTransform=original;marker.setAttribute('transform',original+' scale('+((small?.55:1)/k)+')')}
  const routeLine=svg.querySelector('.nx-map-route'),routeHalo=svg.querySelector('.nx-map-route-halo');if(routeLine)routeLine.setAttribute('stroke-width',(small?4:7)/k);if(routeHalo)routeHalo.setAttribute('stroke-width',(small?7:12)/k);
  const end=svg.querySelector('.nx-map-overlays>circle');if(end){end.setAttribute('r',(small?3.5:6)/k);end.setAttribute('stroke-width',2/k)}
  // Decorations use the visible crop, not the full SVG viewBox, so wide screens keep them in view.
  const nx=x+(w-25)/k,ny=y+(small?25:variant==='a'?170:variant==='c'?122:90)/k;
  const meters=w<450?100:200,bar=meters*k,left=small?16:['a','e'].includes(variant)?220:24;
  const sx=x+left/k,sy=y+(h-36)/k;
  layer.innerHTML=`<g transform="translate(${nx} ${ny}) scale(${1/k})" font-family="Arial,sans-serif" text-anchor="middle" stroke="none"><text y="0" font-size="11">${svg.dataset.camera==='heading-up'?'↑':'N'}</text>${svg.dataset.camera==='heading-up'?'':'<path d="M0 8L5 21 0 18 -5 21Z"/>'}</g><g class="nx-map-scale" transform="translate(${sx} ${sy}) scale(${1/k})" font-family="Arial,sans-serif" stroke-width="1.2"><path d="M0 -4V0H${bar}V-4" fill="none"/><text x="${bar/2}" y="-7" text-anchor="middle" font-size="10" stroke="none">${meters} m</text></g>`;
 }
}
window.NextMap={render,decorate,navigation,palettes,source:data.source,features:fs.length,zoom:1,setZoom(value){this.zoom=Math.max(1,Math.min(2.6,value));return this.zoom;},controls(){return `<div class="nx-map-controls" aria-label="지도 확대"><button type="button" data-map-zoom="out" aria-label="지도 축소" ${this.zoom<=1?'disabled':''}>−</button><button type="button" data-map-zoom="reset" aria-label="전체 경로 보기">전체</button><button type="button" data-map-zoom="in" aria-label="지도 확대" ${this.zoom>=2.6?'disabled':''}>+</button></div>`;}};
})();
