/* Ephemeral snapshots only. No writes to saved delivery records. */
(()=>{'use strict';if(new URLSearchParams(location.search).get('autoplay')!=='1')return;
const E=window.NextDay,at='2026-10-20T08:00:00+09:00';
function make(t){let s=E.create();const act=(type,x={})=>s=E.reduce(s,{type,at,...x});
if(t.phase==='boarding')return s;
act('dayPlan');if(t.phase==='planning')return s;act('dayStart');act('drive');
if(t.leg===1&&t.phase==='drive')return s;act('park');
if(t.leg===1&&t.phase==='park')return s;
const done=id=>{act('select',{id});if(E.parcels[id].photoRequired)act('proof',{id,key:'autoplay-example-'+id,kind:'demo'});act('result',{id,value:'delivered'});};
if(t.leg===1&&t.phase==='delivery'){const count=Math.min(3,Math.floor(t.phaseProgress*4));for(const id of ['A-023','A-024','B-110'].slice(0,count))done(id);if(count<3)act('select',{id:['A-023','A-024','B-110'][count]});return s;}
for(const id of ['A-023','A-024','B-110'])done(id);act('select',{id:'C-051'});act('destination',{stop:'105',source:'center'});act('drive');
if(t.leg===2&&t.phase==='drive')return s;act('park');
if(t.leg===2&&t.phase==='park')return s;
if(t.leg===2&&t.phase==='delivery'&&t.phaseProgress<.65)return s;
done('C-051');act('openReview');act('sync',{outcome:'success'});if(t.phase==='delivery')return s;act('dayReturn');act('dayReturnDrive');
if(t.phase==='return')return s;act('dayReturnPark');act('dayFinish');return s;
}
function paint(t){window.NextApp?.setDemoState?.(make(t));}
window.addEventListener('next-demo-tick',e=>paint(e.detail));
document.addEventListener('click',e=>{if(e.target.closest('#center [data-action],#phone button,#center [data-cockpit="ai"]')){e.preventDefault();e.stopImmediatePropagation();}},true);
window.NextDemoBridge={make};if(window.NextLiveDemo)paint(window.NextLiveDemo.getTelemetry());
})();