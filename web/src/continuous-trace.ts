import { Trace, Frame, labels } from './trace';

export type ContinuousFrame = Frame & {food_stock:number; worker_loads:number[]; delivered:number; consumed:number; delivery:number; hunger_returns:number; refeeds:number; empty_waits:number};
export type ContinuousTrace = Omit<Trace, 'frames'> & {environment:string; frames:ContinuousFrame[]; initial_stock:number; capacity:number; depot:[number,number]; supply:number[]};
export type Run = {environment:string; n_larvae:number; n_wasps:number; grid_size:number; runtime_seconds:number; distance_per_larva:number; strategy:string; supply:string; seed:number; mean_hunger:number; mean_full_fraction:number; high_hunger_fraction:number; refeeds:number; food_consumed:number; empty_waits:number};
export type ContinuousManifest = {model_version:string; source_checksum:string; synthetic_only:boolean; horizon:number; seeds:number[]; environments:Record<string,{larvae:number;workers:number;grid_size:number}>; replays:Record<string,Record<string,string>>; replay_deliveries:Record<string,number[]>; results:Run[]};
export const environments:Record<string,number[]>={small:[36,12,12],medium:[108,36,21],large:[324,108,36]};

// Reconstruct every food/hunger transition before the renderer sees a replay.
export function validateContinuous(t:ContinuousTrace, manifest:ContinuousManifest) {
  const fail = () => {throw Error('Invalid continuous feeding replay');};
  const close = (a:number,b:number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b)<1e-8;
  const point = (p:number[]) => Array.isArray(p) && p.length===2 && p.every(v=>Number.isInteger(v)&&v>=0&&v<t.grid_size);
  if(!environments[t.environment])fail();
  const [n,w,size]=environments[t.environment], scale=n/36;
  const declared=manifest.environments?.[t.environment];
  if(!declared||declared.larvae!==n||declared.workers!==w||declared.grid_size!==size)fail();
  if (!manifest.synthetic_only || t.schema_version!==3 || t.model_version!=='continuous-synthetic-v1' || t.model_version!==manifest.model_version || t.source_checksum!==manifest.source_checksum || !labels[t.strategy] || t.grid_size!==size || t.larvae.length!==n || t.workers.length!==w || t.frames.length!==manifest.horizon+1 || t.frames.length>2001 || t.initial_stock!==6*scale || t.capacity!==2 || t.satiation_threshold!==.12 || !point(t.depot)) fail();
  const ranges:Record<string,number[]>={L1:[.2,.5],L2:[.45,.75],L3:[.65,1]};
  const supplies:Record<string,number[]>={scarce:[.08,1,3],variable:[.20,2,6],abundant:[.40,3,7]};
  const condition=t.scenario.slice(t.environment.length+1);
  if(!t.scenario.startsWith(t.environment+'-')||!supplies[condition]||t.supply.length!==3||t.supply.some((v,i)=>v!==supplies[condition][i]*(i?scale:1))||t.seed!==42||manifest.replay_deliveries[t.scenario]?.length!==t.frames.length)fail();
  const everFull=t.larvae.map(()=>false);
  if (new Set(t.larvae.map(l=>l.xy.join(','))).size!==t.larvae.length) fail();
  for(const l of t.larvae) if(!point(l.xy)||!ranges[l.stage]||!Number.isFinite(l.hunger)||l.hunger<ranges[l.stage][0]||l.hunger>ranges[l.stage][1]) fail();
  for(const [s,g,d] of [['L1',.020,.35],['L2',.028,.45],['L3',.035,.55]] as const) if(t.hunger_growth[s]!==g||t.feed_drop[s]!==d) fail();
  for(const [i,f] of t.frames.entries()) {
    if(f.tick!==i||f.phase!=='post_tick'||f.positions.length!==w||f.worker_loads.length!==w||f.targets.length!==w||f.reasons.length!==w||f.claims.length!==w||f.hunger.length!==n||f.feed_counts.length!==n||f.satiated_at.length!==n||f.first_feed.length!==n||f.positions.some(p=>!point(p))||f.worker_loads.some(v=>!Number.isFinite(v)||v< -1e-10||v>t.capacity)||f.hunger.some(h=>!Number.isFinite(h)||h<0||h>1)||f.satiated_at.some((v,l)=>!Number.isInteger(v)||v < -1||v>i||(v>=0)!==(f.hunger[l]<=.12))||f.fed!==f.hunger.filter(h=>h<=.12).length||f.food_stock < -1e-10||!close(t.initial_stock+f.delivered,f.food_stock+f.consumed+f.worker_loads.reduce((a,b)=>a+b,0))) fail();
    if(!i) {
      if(f.hunger.some((h,l)=>h!==t.larvae[l].hunger)||f.worker_loads.some(v=>v!==0)||f.events.length||f.worker_order.length||f.feed_counts.some(v=>v!==0)||f.first_feed.some(v=>v!==-1)||f.delivered||f.consumed||f.delivery||f.distance||f.messages||f.hunger_returns||f.refeeds||f.empty_waits||!close(f.food_stock,t.initial_stock)) fail();
      continue;
    }
    const p=t.frames[i-1], hunger=p.hunger.map((h,l)=>Math.min(1,h+t.hunger_growth[t.larvae[l].stage]));
    const loads=[...p.worker_loads],counts=[...p.feed_counts], first=[...p.first_feed];
    const full=p.satiated_at.map((v,l)=>hunger[l]>.12?-1:v);
    let stock=p.food_stock+f.delivery, consumed=p.consumed, messages=p.messages, order=-1, refeeds=p.refeeds, empty=p.empty_waits;
    let returns=p.hunger_returns+p.hunger.filter((h,l)=>h<=.12&&hunger[l]>.12).length;
    if(!Number.isFinite(f.delivery)||f.delivery!==manifest.replay_deliveries[t.scenario][i]||(f.delivery!==0&&(f.delivery<t.supply[1]||f.delivery>t.supply[2]))||!close(f.delivered,p.delivered+f.delivery)||f.worker_order.length!==w||new Set(f.worker_order).size!==w||f.worker_order.some(worker=>!Number.isInteger(worker)||worker<0||worker>=w)) fail();
    const actions=new Set<number>();
    for(const e of f.events) {
      const w=Number(e.worker), at=f.worker_order.indexOf(w);
      if(!Number.isInteger(w)||w<0||w>=t.workers.length||actions.has(w)||at<=order||f.positions[w].some((v,a)=>v!==p.positions[w][a])) fail();
      actions.add(w);order=at;
      if(e.type==='refill') {
        const amount=Math.min(t.capacity,stock);
        if(loads[w]>1e-12||p.positions[w].some((v,a)=>v!==t.depot[a])||!close(Number(e.amount),amount)) fail();
        loads[w]=amount;stock-=amount;if(amount===0)empty++;
      } else if(e.type==='feed'||e.type==='first_feed') {
        const l=Number(e.larva);
        if(!Number.isInteger(l)||l<0||l>=n||hunger[l]<=.12||loads[w]<=1e-12||p.positions[w].some((v,a)=>v!==t.larvae[l].xy[a])) fail();
        const amount=Math.min(t.feed_drop[t.larvae[l].stage],hunger[l],loads[w]);
        if(!close(Number(e.amount),amount)||!close(Number(e.hunger_before),hunger[l])||(e.type==='first_feed')!==(first[l]<0)) fail();
        if(first[l]<0)first[l]=i;
        hunger[l]-=amount;loads[w]-=amount;consumed+=amount;counts[l]++;
        if(everFull[l])refeeds++;
        if(hunger[l]<=.12){full[l]=i;everFull[l]=true;}
        if(!close(Number(e.hunger_after),hunger[l]))fail();
      } else if(e.type==='broadcast') messages++;
      else fail();
    }
    const movement=f.positions.reduce((sum,xy,w)=>{
      const d=Math.abs(xy[0]-p.positions[w][0])+Math.abs(xy[1]-p.positions[w][1]);
      if(d>1)fail();return sum+d;
    },0);
    if(f.refeeds!==refeeds||f.empty_waits!==empty||!close(f.food_stock,stock)||!close(f.consumed,consumed)||f.messages!==messages||f.distance!==p.distance+movement||f.hunger_returns!==returns||f.hunger.some((h,l)=>!close(h,hunger[l]))||f.worker_loads.some((v,w)=>!close(v,loads[w]))||f.feed_counts.some((v,l)=>v!==counts[l])||f.first_feed.some((v,l)=>v!==first[l])||f.satiated_at.some((v,l)=>v!==full[l])) fail();
  }
  return t;
}
