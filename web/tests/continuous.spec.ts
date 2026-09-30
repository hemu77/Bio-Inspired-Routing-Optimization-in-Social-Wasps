import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validateContinuous} from '../src/continuous-trace';

test('all synthetic replays conserve food and reconstruct renewable hunger',()=>{
  const read=(name:string)=>JSON.parse(readFileSync(`public/continuous/${name}`,'utf8'));
  const manifest=read('manifest.json');
  const source=(name:string)=>readFileSync(name,'utf8').replace(/\r\n/g,'\n');
  const checksum=createHash('sha256').update(source('../continuous_model.py')).update(source('../research_model.py')).digest('hex');
  expect(manifest.source_checksum).toBe(checksum);
  expect(manifest.results).toHaveLength(180);
  expect(new Set(manifest.results.map((r:any)=>`${r.supply}/${r.strategy}/${r.seed}`)).size).toBe(180);
  for(const methods of Object.values(manifest.replays) as Record<string,string>[]){
    let deliveries:number[]|undefined;
    for(const name of Object.values(methods)){
      const trace=validateContinuous(read(name),manifest);
      const arrivals=trace.frames.map(f=>f.delivery);
      if(deliveries)expect(arrivals).toEqual(deliveries);else deliveries=arrivals;
      const mean=trace.frames.slice(1).reduce((s,f)=>s+f.hunger.reduce((a,b)=>a+b,0)/36,0)/500;
      const row=manifest.results.find((r:any)=>r.supply===trace.scenario&&r.strategy===trace.strategy&&r.seed===trace.seed);
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
  await page.setViewportSize({width:390,height:844});
  await page.locator('#reset').click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({path:'test-results/continuous-mobile.png'});
  expect(errors).toEqual([]);
});

test('continuous viewer rejects fabricated food',async({page})=>{
  await page.route('**/continuous/variable-tsp.json',async route=>{
    const data=await(await route.fetch()).json();data.frames[1].food_stock+=2;
    await route.fulfill({json:data});
  });
  await page.goto('/continuous.html');
  await expect(page.locator('#status')).toContainText('Invalid');
  await expect(page.locator('#play')).toBeDisabled();
});
