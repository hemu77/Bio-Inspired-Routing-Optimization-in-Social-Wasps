import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {validateContinuous} from '../src/continuous-trace';

test('all synthetic replays conserve food and reconstruct renewable hunger',()=>{
  const read=(name:string)=>{const bytes=readFileSync(`public/continuous/${name}`);return JSON.parse((name.endsWith('.gz')?gunzipSync(bytes):bytes).toString('utf8'));};
  const manifest=read('manifest.json');
  const source=(name:string)=>readFileSync(name,'utf8').replace(/\r\n/g,'\n');
  const checksum=createHash('sha256').update(source('../continuous_model.py')).update(source('../research_model.py')).digest('hex');
  expect(manifest.source_checksum).toBe(checksum);
  expect(manifest.results).toHaveLength(540);
  expect(new Set(manifest.results.map((r:any)=>`${r.environment}/${r.supply}/${r.strategy}/${r.seed}`)).size).toBe(540);
  expect(Object.keys(manifest.replays)).toHaveLength(9);
  for(const row of manifest.results){
    expect(row.n_larvae/row.n_wasps).toBe(3);
    expect(row.observed_steps).toBe(500);
    expect(row.mean_hunger).toBeGreaterThanOrEqual(0);
    expect(row.mean_hunger).toBeLessThanOrEqual(1);
    expect(row.mean_full_fraction).toBeGreaterThanOrEqual(0);
    expect(row.mean_full_fraction).toBeLessThanOrEqual(1);
    expect(row.food_consumed+row.food_remaining).toBeCloseTo(6*row.n_larvae/36+row.food_delivered,7);
    const paired=manifest.results.find((r:any)=>r.environment==='small'&&r.supply===row.supply&&r.seed===row.seed);
    expect(row.food_delivered/row.n_larvae).toBeCloseTo(paired.food_delivered/36,10);
    for(const metric of ['mean_hunger','mean_full_fraction','distance_per_larva','runtime_seconds'])expect(Number.isFinite(row[metric])).toBe(true);
  }
  for(const methods of Object.values(manifest.replays) as Record<string,string>[]){
    let deliveries:number[]|undefined;
    expect(Object.keys(methods)).toHaveLength(6);
    for(const name of Object.values(methods)){
      const trace=validateContinuous(read(name),manifest);
      expect(()=>validateContinuous(trace,{...manifest,environments:{}})).toThrow();
      const arrivals=trace.frames.map(f=>f.delivery);
      if(deliveries)expect(arrivals).toEqual(deliveries);else deliveries=arrivals;
      const mean=trace.frames.slice(1).reduce((s,f)=>s+f.hunger.reduce((a,b)=>a+b,0)/trace.larvae.length,0)/500;
      const row=manifest.results.find((r:any)=>`${r.environment}-${r.supply}`===trace.scenario&&r.strategy===trace.strategy&&r.seed===trace.seed);
      expect(mean).toBeCloseTo(row.mean_hunger,10);
      expect(trace.frames.at(-1)!.refeeds).toBeGreaterThan(0);
      const corrupt=structuredClone(trace);corrupt.frames[2].worker_loads[0]+=.01;
      expect(()=>validateContinuous(corrupt,manifest)).toThrow();
      const supply=structuredClone(trace);supply.supply[0]=1;
      expect(()=>validateContinuous(supply,manifest)).toThrow();
      const arrival=structuredClone(trace);arrival.frames[1].delivery=999;
      expect(()=>validateContinuous(arrival,manifest)).toThrow();
    }
  }
});

test('continuous viewer shows hunger returning, refeeding, supply comparison and fixed endpoint',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/continuous.html');
  await expect(page.locator('#status')).toBeHidden();
  await expect(page.locator('#comparison tr')).toHaveCount(6);
  await expect(page.locator('#current-count')).toContainText('324 full now / 108 workers');
  await expect(page.locator('#hunger-path')).toHaveAttribute('d',/^M25,/);
  for(const size of ['small','medium','large']){
    await page.locator('#environment').selectOption(size);
    await expect(page.locator('#status')).toBeHidden();
    await expect(page.locator('#current-method')).toContainText(size);
  }
  for(const metric of ['mean_full_fraction','distance_per_larva','empty_waits','runtime_seconds','mean_hunger']){
    await page.locator('#metric').selectOption(metric);
    await expect(page.locator('#comparison td')).toHaveCount(18);
    await expect(page.locator('#comparison')).not.toContainText('NaN');
  }
  await page.locator('#return-event').click();
  await expect(page.locator('#return-count')).not.toContainText('0 hunger-return events;');
  await page.locator('#refeed-event').click();
  await expect(page.locator('#tick')).not.toHaveText('0 / 500');
  await page.locator('#seek').fill('500');
  await expect(page.locator('#end-note')).toContainText('not permanent completion');
  for(const condition of ['scarce','abundant']){
    await page.locator('#supply').selectOption(condition);
    await expect(page.locator('#status')).toBeHidden();
    await expect(page.locator('#current-method')).toContainText(condition);
  }
  await page.locator('#strategy').selectOption('local_urgency_claims');
  await expect(page.locator('#status')).toBeHidden();
  await page.locator('#play').click();
  await expect(page.locator('#tick')).not.toHaveText('0 / 500');
  await page.locator('#play').click();
  await page.locator('canvas').scrollIntoViewIfNeeded();
  const canvasBox=(await page.locator('canvas').boundingBox())!;
  expect((await page.locator('.legend').boundingBox())!.y).toBeGreaterThanOrEqual(canvasBox.y+canvasBox.height-1);
  await page.screenshot({path:'test-results/continuous-desktop.png'});
  await page.locator('.continuous-results').screenshot({path:'test-results/continuous-comparison.png'});
  await page.locator('.inspector').screenshot({path:'test-results/continuous-hunger.png'});
  await page.locator('#theme-toggle').click();
  await page.locator('.viewport').screenshot({path:'test-results/continuous-light.png'});
  await page.setViewportSize({width:390,height:844});
  await page.locator('#reset').click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({path:'test-results/continuous-mobile.png',fullPage:true});
  expect(errors).toEqual([]);
});

test('continuous viewer rejects fabricated food',async({page})=>{
  await page.route('**/continuous/large-variable-tsp.json.gz',async route=>{
    const bytes=await(await route.fetch()).body();
    const data=JSON.parse((bytes[0]===31?gunzipSync(bytes):bytes).toString('utf8'));data.frames[1].food_stock+=2;
    await route.fulfill({json:data});
  });
  await page.goto('/continuous.html');
  await expect(page.locator('#status')).toContainText('Invalid');
  await expect(page.locator('#play')).toBeDisabled();
});

test.describe('continuous mobile layout',()=>{
  test.use({hasTouch:true});
  for(const width of [320,390,768])test(`readable controls and results at ${width}px`,async({page})=>{
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setViewportSize({width,height:844});
    await page.goto('/continuous.html');
    await expect(page.locator('#status')).toBeHidden();
    await page.locator('#strategy').selectOption('local_urgency_claims');
    await expect(page.locator('#status')).toBeHidden();
    for(const id of ['play','environment','supply','strategy','zoom-in','zoom-out','reset','theme-toggle']){
      const box=(await page.locator(`#${id}`).boundingBox())!;
      expect(box.height,`${id} touch target`).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x+box.width).toBeLessThanOrEqual(width);
    }
    const header=(await page.locator('.view-label').boundingBox())!;
    const count=(await page.locator('#current-count').boundingBox())!;
    expect(count.y+count.height).toBeLessThanOrEqual(header.y+58);
    await page.locator('#play').tap();
    await expect(page.locator('#tick')).not.toHaveText('0 / 500');
    await page.locator('#play').tap();
    await page.locator('#zoom-in').tap();
    await page.locator('#reset').tap();
    await page.locator('.viewport').screenshot({path:`test-results/mobile-${width}-dark.png`});
    await page.locator('#theme-toggle').tap();
    await page.locator('.viewport').screenshot({path:`test-results/mobile-${width}-light.png`});
    await expect(page.locator('#comparison .seed-range')).toHaveCount(18);
    const clipped=await page.locator('#comparison td').evaluateAll(cells=>cells.some(c=>c.scrollWidth>c.clientWidth));
    expect(clipped).toBe(false);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.locator('.continuous-results').screenshot({path:`test-results/mobile-${width}-results.png`});
    expect(errors).toEqual([]);
  });
});
