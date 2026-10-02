import './style.css';
import * as THREE from 'three';
import { ReplayScene } from './scene';
import { labels } from './trace';
import { ContinuousManifest, ContinuousTrace, validateContinuous } from './continuous-trace';

document.body.classList.add('continuous-page');
document.querySelector('#app')!.innerHTML = `
<header><div><h1>Feeding, again</h1><p class="subtitle">Returning hunger. Finite food. Repeated visits.</p></div><nav><a href="./">One-round experiment</a><button id="theme-toggle">Light mode</button></nav></header>
<section class="method-bar"><p class="model-note">Synthetic scaling study. Nest, food units, arrival rates and hunger growth are assumptions, not measured biology. Each run covers 500 ticks.</p><div class="method-heading"><label>Colony size <select id="environment"><option value="small">Small: 36 larvae / 12 workers</option><option value="medium">Medium: 108 larvae / 36 workers</option><option value="large" selected>Large: 324 larvae / 108 workers</option></select></label><label>Food supply <select id="supply"><option>scarce</option><option selected>variable</option><option>abundant</option></select></label><label>Routing method <select id="strategy"></select></label></div><p id="supply-note"></p></section>
<footer><button id="play" disabled>Play</button><button id="return-event" disabled title="Find the next full larva whose hunger rises above the threshold">Next hunger return</button><label class="timeline">Tick <output id="tick">0 / 500</output><input id="seek" aria-label="Seek actual tick" type="range" min="0" max="500" value="0" disabled></label><label>Speed <select id="speed"><option value="10">10 ticks/s</option><option value="30" selected>30 ticks/s</option></select></label></footer>
<main><section class="viewport" aria-label="Continuous feeding simulation"><div class="view-tools"><span class="navigation-hint">Drag / two-finger scroll to rotate. Pinch to zoom. Shift-drag to pan.</span><button id="zoom-in">Zoom in</button><button id="zoom-out">Zoom out</button><button id="reset">Reset view</button><button id="expand-view">Expand view</button></div><div id="canvas"><div id="view-labels"><div class="view-label"><strong id="current-method"></strong><span id="current-count"></span></div></div></div><div id="status" role="status">Loading validated replay...</div><div class="legend"><span><i class="waiting"></i>Unfed</span><span><i class="partial"></i>Part-fed / hungry again</span><span><i class="fed"></i>Full now (hunger ≤ 0.12)</span><span><i class="wasp"></i>Feeding worker</span><span>Ring: food depot</span></div></section>
<aside class="layers"><span class="eyebrow">Individual differences</span><h2>Follow a larva or worker</h2>
<p>Tap an agent in the nest, or choose its ID below. The highlighted ring follows your selection.</p>
<section class="agent-inspector"><label class="entity-label">Inspect larva<select id="larva"></select></label>
<p id="larva-state"></p><progress id="larva-hunger" max="1" value="0" aria-label="Selected larva remaining hunger"></progress>
<dl><dt>Stage</dt><dd id="larva-stage"></dd><dt title="Randomly assigned once, then constant for this larva">Recovery per tick</dt><dd id="larva-rate"></dd><dt>No-feed outlook</dt><dd id="larva-outlook"></dd></dl>
<p id="larva-last-feed"></p><button id="larva-feed-event" disabled>Next feed for this larva</button> <button id="refeed-event" disabled>Next refeed after full</button></section>
<section class="agent-inspector"><label class="entity-label">Inspect worker<select id="worker"></select></label>
<p id="worker-state"></p><progress id="worker-load" max="2" value="0" aria-label="Selected worker carried food"></progress>
<p id="worker-action"></p><p id="worker-pickup"></p><button id="pickup-event" disabled>Next pickup for this worker</button></section>
<h3>Food budget</h3><div id="food-stats"></div>
<details><summary>What is random, and what do the units mean?</summary><p>Each larva has a fixed recovery rate sampled within 75–125% of its stage baseline. Each nonempty pickup requests 50–100% of the worker's 2-unit capacity; depot shortages can reduce it further. The inspector shows requested and actual amounts separately.</p><p>Arrivals are also random. These are reproducible, dimensionless assumptions, not measured biology. Recovery rates do not fluctuate every tick. Workers cannot see future deliveries; foragers are represented by deliveries, not animated agents. Feed, move, refill and communication each cost one action.</p></details></aside>
<aside class="inspector"><span class="eyebrow">Continuous care</span><h2 id="current-state"></h2><p id="return-count"></p><p id="end-note">This replay runs for 500 ticks. Green can fade as hunger rises; reaching full once does not end the experiment.</p><h3>Average hunger through time</h3><svg id="hunger-chart" viewBox="0 0 360 130" role="img" aria-label="Average hunger from 0 to 1 over 500 ticks"><text x="0" y="12" fill="currentColor" font-size="11">1</text><text x="0" y="112" fill="currentColor" font-size="11">0</text><path id="hunger-path" fill="none" stroke="var(--warning)" stroke-width="2"/><line id="chart-cursor" y1="10" y2="110" stroke="var(--ink)"/><text x="25" y="128" fill="currentColor" font-size="10">0 ticks</text><text x="290" y="128" fill="currentColor" font-size="10">500 ticks</text></svg><p>The line may rise after feeding. A lower time-averaged hunger means better sustained care within these assumptions.</p></aside></main>
<section class="continuous-results"><span class="eyebrow">540 runs / three sizes / ten paired seeds / six policies / three supplies</span><h2>Does performance hold as the colony grows?</h2><label>Compare <select id="metric"><option value="mean_hunger">Average hunger</option><option value="mean_full_fraction">Time spent full</option><option value="distance_per_larva">Movement per larva</option><option value="empty_waits">Empty-depot waiting</option><option value="runtime_seconds">Simulation runtime</option></select></label><p id="comparison-note"></p><div class="table-scroll"><table><thead><tr><th>Method</th><th>Small: 36</th><th>Medium: 108</th><th>Large: 324</th></tr></thead><tbody id="comparison"></tbody></table></div><p>Ten seeds per cell; mean and seed range, not a biological confidence interval. Staffing and delivered food per larva stay constant; whole-grid occupancy stays near 25%, but eligible interior-cell occupancy falls from 36.4% to 30.0% to 28.1%. One central depot, fixed sensing radius and a common 500-tick window mean larger colonies also have longer journeys. These synthetic results do not validate real wasp behavior.</p></section>`;
const $ = <T extends HTMLElement>(id:string) => document.getElementById(id) as T;
const scene = new ReplayScene($('canvas'));
const selectionSummary=document.createElement('p');selectionSummary.id='selection-summary';selectionSummary.className='selection-summary';
document.querySelector('.viewport')!.append(selectionSummary);
type EventAt={tick:number;event:Record<string,unknown>};
let feedHistory:EventAt[][]=[], pickupHistory:EventAt[][]=[];
let manifest:ContinuousManifest, trace:ContinuousTrace|undefined, tick=0, playing=false, last=performance.now(), request=0, abort=new AbortController();
const select=$<HTMLSelectElement>('strategy'), supply=$<HTMLSelectElement>('supply'), seek=$<HTMLInputElement>('seek'), environment=$<HTMLSelectElement>('environment');
for(const [key,label] of Object.entries(labels))select.add(new Option(label,key));
select.value='tsp';
let light=false;
function theme() {
  document.documentElement.dataset.theme=light?'light':'dark';
  scene.setTheme(light?'light':'dark');
  for(const view of scene.views){
    const depot=view.structure.getObjectByName('food-depot') as THREE.Mesh<THREE.TorusGeometry,THREE.MeshBasicMaterial>|undefined;
    depot?.material.color.set(scene.palette.selection);
  }
  for(const [key,value] of Object.entries(scene.palette))document.documentElement.style.setProperty(`--replay-${key}`,value);
  $('theme-toggle').textContent=light?'Dark mode':'Light mode';
}
theme();$('theme-toggle').onclick=()=>{light=!light;theme();};
function pause() {playing=false;$('play').textContent='Play';}
function update() {
  if(!trace)return;
  const f=trace.frames[Math.floor(tick)];
  scene.draw(f.tick);
  seek.value=String(f.tick);$('tick').textContent=`${f.tick} / 500`;
  $('current-count').textContent=`${f.fed}/${trace.larvae.length} full now / ${trace.workers.length} workers / tick ${f.tick}`;
  $('current-state').textContent=`${f.fed} full now / ${trace.larvae.length-f.fed} hungry`;
  $('return-count').textContent=`${f.hunger_returns} hunger-return events; ${f.refeeds} feeds to previously full larvae.`;
  $('food-stats').textContent=`Depot: ${f.food_stock.toFixed(2)} units. Carried: ${f.worker_loads.reduce((a,b)=>a+b,0).toFixed(2)}. Delivered: ${f.delivered.toFixed(2)}. Consumed: ${f.consumed.toFixed(2)}. Empty-depot waiting actions: ${f.empty_waits}. Initial stock: ${trace.initial_stock} units.`;
  const l=Number($<HTMLSelectElement>('larva').value)||0;
  $('larva-state').textContent=`${trace.larvae[l].id}: hunger ${f.hunger[l].toFixed(3)}; ${f.feed_counts[l]} feeds; ${f.hunger[l]<=.12?'full now':'needs food'}.`;
  $<HTMLProgressElement>('larva-hunger').value=f.hunger[l];
  $('larva-stage').textContent=trace.larvae[l].stage;
  $('larva-rate').textContent=`+${trace.individual_growth[l].toFixed(4)} hunger / tick`;
  $('larva-outlook').textContent=f.hunger[l]>.12?'Hungry now':`Hungry again in ${Math.floor((.12-f.hunger[l])/trace.individual_growth[l])+1} ticks if not fed`;
  const fed=feedHistory[l].filter(e=>e.tick<=f.tick).at(-1);
  $('larva-last-feed').textContent=fed?`Last feed: tick ${fed.tick}, ${trace.workers[Number(fed.event.worker)]} supplied ${Number(fed.event.amount).toFixed(3)} units. Hunger ${Number(fed.event.hunger_before).toFixed(3)} → ${Number(fed.event.hunger_after).toFixed(3)}. ${Number(fed.event.hunger_after)>.12?'Still needed food after this feed.':'Reached full after this feed.'}`:'No recorded feed yet.';
  if(fed&&Number(fed.event.hunger_after)>.12){
    const available=trace.frames[fed.tick-1].worker_loads[Number(fed.event.worker)];
    $('larva-last-feed').textContent+=available<trace.feed_drop[trace.larvae[l].stage]-1e-10?' The worker lacked food for a full stage-sized portion.':' One stage-sized portion was not enough.';
  }
  const w=Number($<HTMLSelectElement>('worker').value)||0;
  $<HTMLProgressElement>('worker-load').value=f.worker_loads[w];
  $('worker-state').textContent=`${trace.workers[w]}: carrying ${f.worker_loads[w].toFixed(3)} / ${trace.capacity.toFixed(1)} food units`;
  $('worker-action').textContent=`Action: ${f.reasons[w]}. ${f.targets[w]>=0?`Target: ${trace.larvae[f.targets[w]].id}.`:'No larval target.'}`;
  const pickup=pickupHistory[w].filter(e=>e.tick<=f.tick).at(-1);
  $('worker-pickup').textContent=pickup?`Last pickup: tick ${pickup.tick}. Requested ${Number(pickup.event.requested).toFixed(3)}, received ${Number(pickup.event.amount).toFixed(3)} units. ${Number(pickup.event.amount)<Number(pickup.event.requested)-1e-10?'Limited by depot stock.':'Requested load available.'}`:'No nonempty pickup yet.';
  selectionSummary.textContent=scene.selected?.kind==='worker'?`${$('worker-state').textContent}. ${f.reasons[w]}.`:`${$('larva-state').textContent} Recovery +${trace.individual_growth[l].toFixed(4)} / tick.`;
  $('chart-cursor').setAttribute('x1',String(25+f.tick/500*325));$('chart-cursor').setAttribute('x2',String(25+f.tick/500*325));
  $('end-note').textContent=f.tick===500?'Observation window ended. This is not permanent completion; hunger would continue to return.':'Green can fade as hunger rises. Fullness is a current state, not a permanent achievement.';
}
async function load() {
  const id=++request;pause();trace=undefined;tick=0;
  abort.abort();abort=new AbortController();const controller=abort;
  scene.setTraces([]);
  $('canvas').style.visibility='hidden';$('status').hidden=false;$('status').textContent='Validating food and hunger transitions...';
  selectionSummary.textContent='Loading selected replay...';
  for(const key of ['play','seek','return-event','refeed-event','larva-feed-event','pickup-event','larva','worker'])($<HTMLButtonElement>(key)).disabled=true;
  try {
    const path=manifest.replays[`${environment.value}-${supply.value}`]?.[select.value];
    if(!path||!/^[a-z_-]+\.json(?:\.gz)?$/.test(path))throw Error('Invalid replay path');
    const response=await fetch(`continuous/${path}`,{signal:controller.signal});
    if(!response.ok)throw Error('Replay unavailable');
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(id!==request)return;
    if(bytes.length>40_000_000)throw Error('Replay too large');
    const body=bytes[0]===31&&bytes[1]===139 ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text() : new TextDecoder().decode(bytes);
    if(body.length>40_000_000)throw Error('Replay too large');
    const data=validateContinuous(JSON.parse(body),manifest);
    if(id!==request)return;
    trace=data;scene.setTraces([data]);
    feedHistory=data.larvae.map(()=>[]);pickupHistory=data.workers.map(()=>[]);
    for(const frame of data.frames)for(const event of frame.events){
      if(event.type==='feed'||event.type==='first_feed')feedHistory[Number(event.larva)].push({tick:frame.tick,event});
      if(event.type==='refill'&&Number(event.amount)>0)pickupHistory[Number(event.worker)].push({tick:frame.tick,event});
    }
    for(const view of scene.views) {
      const ring=new THREE.Mesh(new THREE.TorusGeometry(.6,.07,6,24),new THREE.MeshBasicMaterial({color:scene.palette.selection}));
      ring.name='food-depot';
      ring.rotation.x=Math.PI/2;ring.position.set(data.depot[0]-data.grid_size/2,.15,data.depot[1]-data.grid_size/2);view.structure.add(ring);
    }
    scene.changed=true;
    const larvae=$<HTMLSelectElement>('larva');larvae.replaceChildren(...data.larvae.map((l,i)=>new Option(l.id,String(i))));
    $<HTMLSelectElement>('worker').replaceChildren(...data.workers.map((id,i)=>new Option(id,String(i))));
    scene.selected={kind:'larva',index:0,view:0};
    $('current-method').textContent=`${labels[select.value]} / ${environment.value} / ${supply.value} supply`;
    const [p,low,high]=data.supply;
    $('supply-note').textContent=`Assumed deliveries: ${(p*100).toFixed(0)}% chance each tick; ${low}–${high} food units per arrival. Capacity: 2 units per worker. Seed 42 replay; deliveries are paired across policies.`;
    $('canvas').style.visibility='visible';$('status').hidden=true;
    $('hunger-path').setAttribute('d',data.frames.map((f,i)=>`${i?'L':'M'}${25+i/500*325},${110-f.hunger.reduce((a,b)=>a+b,0)/data.larvae.length*100}`).join(' '));
    for(const key of ['play','seek','return-event','refeed-event','larva-feed-event','pickup-event','larva','worker'])($<HTMLButtonElement>(key)).disabled=false;
    update();
  } catch(error) {if(id===request)$('status').textContent=String(error);}
}
select.onchange=load;supply.onchange=()=>{comparison();load();};environment.onchange=load;
$('play').onclick=()=>{if(!trace)return;if(tick>=500)tick=0;playing=!playing;$('play').textContent=playing?'Pause':'Play';last=performance.now();};
seek.oninput=()=>{pause();tick=Number(seek.value);update();};
$('larva').onchange=()=>{if(!trace)return;scene.selected={kind:'larva',index:Number($<HTMLSelectElement>('larva').value),view:0};scene.changed=true;update();};
$('worker').onchange=()=>{if(!trace)return;scene.selected={kind:'worker',index:Number($<HTMLSelectElement>('worker').value),view:0};scene.changed=true;update();};
function jumpSelected(kind:'larva'|'worker'){
  if(!trace)return;pause();const index=Number($<HTMLSelectElement>(kind).value);
  const next=(kind==='larva'?feedHistory:pickupHistory)[index].find(e=>e.tick>tick);
  if(!next){$('end-note').textContent=`No later ${kind==='larva'?'feed':'nonempty pickup'} for this ${kind} in the recorded window.`;return;}
  tick=next.tick;scene.selected={kind,index,view:0};scene.changed=true;update();
}
$('larva-feed-event').onclick=()=>jumpSelected('larva');$('pickup-event').onclick=()=>jumpSelected('worker');
let pointerStart:{x:number;y:number;id:number}|undefined;
scene.canvas.addEventListener('pointerdown',e=>{pointerStart=e.isPrimary&&e.button===0?{x:e.clientX,y:e.clientY,id:e.pointerId}:undefined;});
scene.canvas.addEventListener('pointermove',e=>{if(pointerStart&&Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y)>5)pointerStart=undefined;});
scene.canvas.addEventListener('pointercancel',()=>{pointerStart=undefined;});
scene.canvas.addEventListener('pointerup',e=>{
  const start=pointerStart;pointerStart=undefined;
  if(!trace||!start||start.id!==e.pointerId)return;
  const picked=scene.pick(e.clientX,e.clientY,tick);
  if(picked&&(picked.kind==='larva'||picked.kind==='worker')){
    $<HTMLSelectElement>(picked.kind).value=String(picked.index);scene.selected=picked;scene.changed=true;update();
  }
});
function jump(kind:'return'|'refeed') {
  if(!trace)return;pause();
  const next=trace.frames.find((f,i)=>i>tick&&i>0&&(kind==='return'?f.hunger_returns>trace!.frames[i-1].hunger_returns:f.refeeds>trace!.frames[i-1].refeeds));
  if(next) {
    const previous=trace.frames[next.tick-1];
    const l=kind==='return'?next.hunger.findIndex((h,i)=>h>.12&&previous.hunger[i]<=.12):Number(next.events.find(e=>(e.type==='feed')&&trace!.frames.slice(0,next.tick).some(f=>f.satiated_at[Number(e.larva)]>=0))?.larva??0);
    tick=next.tick;if(l>=0){$<HTMLSelectElement>('larva').value=String(l);scene.selected={kind:'larva',index:l,view:0};}scene.changed=true;update();
  } else $('end-note').textContent=`No later ${kind==='return'?'hunger-return':'refeed-after-full'} event in this window.`;
}
$('return-event').onclick=()=>jump('return');$('refeed-event').onclick=()=>jump('refeed');
$('zoom-in').onclick=()=>scene.zoom(.8);$('zoom-out').onclick=()=>scene.zoom(1.25);$('reset').onclick=()=>scene.reset();
$('expand-view').hidden=!document.fullscreenEnabled;
$('expand-view').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.querySelector<HTMLElement>('.viewport')!.requestFullscreen();}catch{$('end-note').textContent='Full screen is unavailable in this browser.';}};
document.addEventListener('fullscreenchange',()=>{$('expand-view').textContent=document.fullscreenElement?'Exit full screen':'Expand view';requestAnimationFrame(()=>{scene.resize();scene.reset();});});
function loop(now:number){if(playing&&trace){tick=Math.min(500,tick+(now-last)/1000*Number($<HTMLSelectElement>('speed').value));if(tick>=500)pause();update();}else if(scene.changed&&trace)update();last=now;requestAnimationFrame(loop);}
requestAnimationFrame(loop);
function comparison(){
  const metric=$<HTMLSelectElement>('metric').value;
  const notes:Record<string,string>={mean_hunger:'Average remaining hunger (0–1; lower is better).',mean_full_fraction:'Fraction of larva-ticks spent full (higher is better).',distance_per_larva:'Grid moves per larva over 500 ticks. Interpret alongside hunger, not as energy.',empty_waits:'Fraction of worker-actions waiting at an empty depot (lower is better).',runtime_seconds:'Seconds per simulation; excludes export and browser rendering. Measured sequentially on one busy laptop; not a hardware benchmark.'};
  $('comparison-note').textContent=`${supply.value} supply: ${notes[metric]}`;
  if(metric==='runtime_seconds')$('comparison-note').textContent+=' Includes model setup and snapshot recording for seed 42.';
  $('comparison').replaceChildren();
  for(const [key,label] of Object.entries(labels)) {
    const row=document.createElement('tr');const name=document.createElement('th');name.textContent=label;row.append(name);
    for(const size of ['small','medium','large']){
      const runs=manifest.results.filter(r=>r.strategy===key&&r.supply===supply.value&&r.environment===size);
      if(runs.length!==10||runs.some(r=>!Number.isFinite(r.mean_hunger)))throw Error('Invalid comparison results');
      const values=runs.map(r=>metric==='empty_waits'?r.empty_waits/(r.n_wasps*500):Number(r[metric as keyof typeof r]));
      if(values.some(v=>!Number.isFinite(v)))throw Error('Invalid comparison metric');
      const cell=document.createElement('td');cell.dataset.label=`${size[0].toUpperCase()+size.slice(1)}: ${runs[0].n_larvae}`;
      const mean=document.createElement('span');mean.textContent=(values.reduce((a,b)=>a+b,0)/10).toFixed(3);
      const range=document.createElement('span');range.className='seed-range';range.textContent=`(${Math.min(...values).toFixed(3)}–${Math.max(...values).toFixed(3)})`;
      cell.append(mean,document.createTextNode(' '),range);row.append(cell);
    }$('comparison').append(row);
  }
}
$('metric').onchange=comparison;
fetch('continuous/manifest.json').then(async r=>{if(!r.ok)throw Error('Experiment unavailable');manifest=await r.json();comparison();await load();
}).catch(e=>{$('status').textContent=String(e);});
