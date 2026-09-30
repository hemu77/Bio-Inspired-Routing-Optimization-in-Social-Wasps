// Capture the existing viewer: no alternate geometry or feeding model.
import {chromium} from '@playwright/test';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

const output = path.resolve(process.argv[2]);
const url = process.env.LAB_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
  const page = await browser.newPage({viewport:{width:720,height:600},deviceScaleFactor:1});
  for (const method of ['tsp','biased','random','greedy']) {
    const trace = JSON.parse(await readFile(new URL(`./public/traces/v87-S06-${method}.json`,import.meta.url)));
    if (trace.model_version !== 'research-v3' || !trace.summary.finished)
      throw Error(`Incomplete or outdated ${method} trace`);
    await page.goto(`${url}/?scenario=v87-S06&strategy=${method}`);
    await page.locator('#status').waitFor({state:'hidden'});
    await page.addStyleTag({content:`
      header, .method-bar, footer, aside, .view-tools {display:none!important}
      #app, main {height:600px!important;min-height:600px!important}
      main {display:block!important}
      .viewport {width:720px;height:600px;min-height:0!important}
      #view-labels strong {font-size:24px}
      #view-labels span {font-size:15px}
      .viewport .legend {font-size:16px}
      .viewport #feed-caption {font-size:14px}
    `});
    await page.evaluate(() => document.fonts.ready);
    const last = trace.frames.length-1;
    const ticks = [...new Set(Array.from({length:90},(_,i)=>Math.round(i*last/89)))];
    const dir = path.join(output,method);
    await mkdir(dir,{recursive:true});
    for (const [index,tick] of ticks.entries()) {
      await page.locator('#seek').evaluate((input,tick) => {
        input.value = String(tick);
        input.dispatchEvent(new Event('input',{bubbles:true}));
      },tick);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await page.locator('#feed-caption').evaluate(element => {
        element.textContent = 'v87-S06 / research-v3 / sampled recorded replay';
      });
      const frame = await page.evaluate(() => window.labState.frames[0]);
      if (frame.tick !== tick || frame.fed !== trace.frames[tick].fed ||
          JSON.stringify(frame.hunger) !== JSON.stringify(trace.frames[tick].hunger))
        throw Error(`Displayed state differs from trace: ${method}/${tick}`);
      await page.locator('.viewport').screenshot({path:path.join(dir,`${String(index).padStart(3,'0')}.png`)});
    }
    const end = trace.frames[last];
    if (end.fed !== trace.larvae.length || !end.hunger.every(h=>h<=trace.satiation_threshold))
      throw Error(`Invalid terminal hunger state: ${method}`);
    await writeFile(path.join(dir,'sampling.json'),JSON.stringify({method,scenario:trace.scenario,
      model_version:trace.model_version,source_checksum:trace.source_checksum,ticks,
      full_larvae:end.fed,total_larvae:trace.larvae.length,completion_tick:last},null,2));
    console.log(`${method}: ${ticks.length} verified frames, ${last} ticks, ${end.fed}/${trace.larvae.length} full`);
  }
} finally {
  await browser.close();
}
