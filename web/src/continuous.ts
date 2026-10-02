import './style.css';
import * as THREE from 'three';
import { ReplayScene } from './scene';
import { labels } from './trace';
import { ContinuousManifest, ContinuousTrace, validateContinuous } from './continuous-trace';

document.querySelector('#app')!.innerHTML = `
<header><div><h1>Feeding, again</h1><p class="subtitle">Returning hunger. Finite food. Repeated visits.</p></div><nav><a href="./">One-round experiment</a><button id="theme-toggle">Light mode</button></nav></header>
<section class="method-bar"><p class="model-note">Synthetic scaling study. Nest, food units, arrival rates and hunger growth are assumptions, not measured biology. Each run covers 500 ticks.</p><div class="method-heading"><label>Colony size <select id="environment"><option value="small">Small: 36 larvae / 12 workers</option><option value="medium">Medium: 108 larvae / 36 workers</option><option value="large" selected>Large: 324 larvae / 108 workers</option></select></label><label>Food supply <select id="supply"><option>scarce</option><option selected>variable</option><option>abundant</option></select></label><label>Routing method <select id="strategy"></select></label></div><p id="supply-note"></p></section>
<footer><button id="play" disabled>Play</button><button id="return-event" disabled title="Find the next full larva whose hunger rises above the threshold">Next hunger return</button><label class="timeline">Tick <output id="tick">0 / 500</output><input id="seek" aria-label="Seek actual tick" type="range" min="0" max="500" value="0" disabled></label><label>Speed <select id="speed"><option value="10">10 ticks/s</option><option value="30" selected>30 ticks/s</option></select></label></footer>
<main><section class="viewport" aria-label="Continuous feeding simulation"><div class="view-tools"><span class="navigation-hint">Drag / two-finger scroll to rotate. Pinch to zoom. Shift-drag to pan.</span><button id="zoom-in">Zoom in</button><button id="zoom-out">Zoom out</button><button id="reset">Reset view</button><button id="expand-view">Expand view</button></div><div id="canvas"><div id="view-labels"><div class="view-label"><strong id="current-method"></strong><span id="current-count"></span></div></div></div><div id="status" role="status">Loading validated replay...</div><div class="legend"><span><i class="waiting"></i>Unfed</span><span><i class="partial"></i>Part-fed / hungry again</span><span><i class="fed"></i>Full now (hunger ≤ 0.12)</span><span><i class="wasp"></i>Feeding worker</span><span>Ring: food depot</span></div></section>
<aside class="layers"><span class="eyebrow">Food budget</span><h2>Finite deliveries</h2><div id="food-stats"></div><p>A worker must visit the depot to load food. Refill, feed, movement and communication each cost an action. A small carried load may only partly satisfy a larva.</p><p>Deliveries represent external foraging trips; foragers are not animated. Workers cannot see future arrivals. Routing methods retain their disclosed local or global knowledge of larvae.</p><label class="entity-label">Inspect larva<select id="larva"></select></label><div id="larva-state"></div><button id="refeed-event">Next refeed after full</button></aside>
<aside class="inspector"><span class="eyebrow">Continuous care</span><h2 id="current-state"></h2><p id="return-count"></p><p id="end-note">This replay runs for 500 ticks. Green can fade as hunger rises; reaching full once does not end the experiment.</p><h3>Average hunger through time</h3><svg id="hunger-chart" viewBox="0 0 360 130" role="img" aria-label="Average hunger from 0 to 1 over 500 ticks"><text x="0" y="12" fill="currentColor" font-size="11">1</text><text x="0" y="112" fill="currentColor" font-size="11">0</text><path id="hunger-path" fill="none" stroke="var(--warning)" stroke-width="2"/><line id="chart-cursor" y1="10" y2="110" stroke="var(--ink)"/><text x="25" y="128" fill="currentColor" font-size="10">0 ticks</text><text x="290" y="128" fill="currentColor" font-size="10">500 ticks</text></svg><p>The line may rise after feeding. A lower time-averaged hunger means better sustained care within these assumptions.</p></aside></main>
<section class="continuous-results"><span class="eyebrow">540 runs / three sizes / ten paired seeds / six policies / three supplies</span><h2>Does performance hold as the colony grows?</h2><label>Compare <select id="metric"><option value="mean_hunger">Average hunger</option><option value="mean_full_fraction">Time spent full</option><option value="distance_per_larva">Movement per larva</option><option value="empty_waits">Empty-depot waiting</option><option value="runtime_seconds">Simulation runtime</option></select></label><p id="comparison-note"></p><div class="table-scroll"><table><thead><tr><th>Method</th><th>Small: 36</th><th>Medium: 108</th><th>Large: 324</th></tr></thead><tbody id="comparison"></tbody></table></div><p>Ten seeds per cell; mean and seed range, not a biological confidence interval. Staffing and delivered food per larva stay constant; whole-grid occupancy stays near 25%, but eligible interior-cell occupancy falls from 36.4% to 30.0% to 28.1%. One central depot, fixed sensing radius and a common 500-tick window mean larger colonies also have longer journeys. These synthetic results do not validate real wasp behavior.</p></section>`;
const $ = <T extends HTMLElement>(id:string) => document.getElementById(id) as T;
const scene = new ReplayScene($('canvas'));
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
  $('chart-cursor').setAttribute('x1',String(25+f.tick/500*325));$('chart-cursor').setAttribute('x2',String(25+f.tick/500*325));
  $('end-note').textContent=f.tick===500?'Observation window ended. This is not permanent completion; hunger would continue to return.':'Green can fade as hunger rises. Fullness is a current state, not a permanent achievement.';
}
async function load() {
  const id=++request;pause();trace=undefined;tick=0;
  abort.abort();abort=new AbortController();const controller=abort;
  scene.setTraces([]);
  $('canvas').style.visibility='hidden';$('status').hidden=false;$('status').textContent='Validating food and hunger transitions...';
  for(const key of ['play','seek','return-event','refeed-event'])($<HTMLButtonElement>(key)).disabled=true;
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
    for(const view of scene.views) {
      const ring=new THREE.Mesh(new THREE.TorusGeometry(.6,.07,6,24),new THREE.MeshBasicMaterial({color:scene.palette.selection}));
      ring.name='food-depot';
      ring.rotation.x=Math.PI/2;ring.position.set(data.depot[0]-data.grid_size/2,.15,data.depot[1]-data.grid_size/2);view.structure.add(ring);
    }
    scene.changed=true;
    const larvae=$<HTMLSelectElement>('larva');larvae.replaceChildren(...data.larvae.map((l,i)=>new Option(l.id,String(i))));
    $('current-method').textContent=`${labels[select.value]} / ${environment.value} / ${supply.value} supply`;
    const [p,low,high]=data.supply;
    $('supply-note').textContent=`Assumed deliveries: ${(p*100).toFixed(0)}% chance each tick; ${low}–${high} food units per arrival. Capacity: 2 units per worker. Seed 42 replay; deliveries are paired across policies.`;
    $('canvas').style.visibility='visible';$('status').hidden=true;
    $('hunger-path').setAttribute('d',data.frames.map((f,i)=>`${i?'L':'M'}${25+i/500*325},${110-f.hunger.reduce((a,b)=>a+b,0)/data.larvae.length*100}`).join(' '));
    for(const key of ['play','seek','return-event','refeed-event'])($<HTMLButtonElement>(key)).disabled=false;
    update();
  } catch(error) {if(id===request)$('status').textContent=String(error);}
}
select.onchange=load;supply.onchange=()=>{comparison();load();};environment.onchange=load;
$('play').onclick=()=>{if(!trace)return;if(tick>=500)tick=0;playing=!playing;$('play').textContent=playing?'Pause':'Play';last=performance.now();};
seek.oninput=()=>{pause();tick=Number(seek.value);update();};
$('larva').onchange=()=>{if(!trace)return;scene.selected={kind:'larva',index:Number($<HTMLSelectElement>('larva').value),view:0};scene.changed=true;update();};
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
      const cell=document.createElement('td');cell.textContent=`${(values.reduce((a,b)=>a+b,0)/10).toFixed(3)} (${Math.min(...values).toFixed(3)}–${Math.max(...values).toFixed(3)})`;row.append(cell);
    }$('comparison').append(row);
  }
}
$('metric').onchange=comparison;
fetch('continuous/manifest.json').then(async r=>{if(!r.ok)throw Error('Experiment unavailable');manifest=await r.json();comparison();await load();
}).catch(e=>{$('status').textContent=String(e);});
