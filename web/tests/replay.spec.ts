import { test, expect } from "@playwright/test";
const state = async (page: any) =>
  page.evaluate(() => (window as any).labState);
for (const corruption of ['initial hunger', 'initial feeding', 'feed event'])
test(`rejects corrupted ${corruption}`, async ({page}) => {
  await page.route('**/traces/*.json', async route => {
    const trace = await (await route.fetch()).json();
    if (corruption === 'initial hunger') {
      trace.larvae[0].hunger = .13;
      trace.frames[0].hunger[0] = .13;
    } else if (corruption === 'initial feeding') {
      trace.frames[0].first_feed[0] = 0;
    } else {
      const event = trace.frames.flatMap((f:any) => f.events).find((e:any) => e.type === 'first_feed');
      delete event.hunger_after;
    }
    await route.fulfill({json:trace});
  });
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('Invalid');
  expect((await state(page)).frames).toEqual([]);
  await expect(page.locator('#next-feed')).toBeDisabled();
});
async function ready(page: any, url = "/") {
  await page.goto(url);
  await expect(page.locator("#status")).toBeHidden({ timeout: 30000 });
}

for (const variant of ['3d', '2d', 'mobile'])
test(`whole-interface themes preserve replay state: ${variant}`, async ({page}) => {
  if (variant === 'mobile') await page.setViewportSize({width:390,height:844});
  await ready(page, '/?scenario=v87-S06&strategy=tsp' + (variant === '2d' ? '&2d=1' : ''));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#entity').selectOption('worker:0');
  await page.getByRole('button', {name:'50% fed', exact:true}).click();
  const before = await state(page);
  await page.getByRole('button', {name:'Switch to light mode', exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const after = await state(page);
  const checkContrast = async () => {
    const ratios = await page.evaluate(() => {
      const rgb = (s:string) => (s.match(/[\d.]+/g) || []).slice(0,3).map(Number);
      const lum = (c:number[]) => c.map(v => {
        const s=v/255; return s <= .04045 ? s/12.92 : ((s+.055)/1.055)**2.4;
      }).reduce((sum,v,i) => sum+v*[.2126,.7152,.0722][i],0);
      return ['.subtitle','.model-note','#method-explanation','.scope-note','#remaining','.view-label span','#feed-caption','#method-filters [aria-pressed="true"]','#theme-toggle'].map(selector => {
        const element = document.querySelector(selector)!;
        let node:Element|null=element, background='';
        while(node) {
          background=getComputedStyle(node).backgroundColor;
          if(background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') break;
          node=node.parentElement;
        }
        const a=lum(rgb(getComputedStyle(element).color)), b=lum(rgb(background));
        return {selector,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
      });
    });
    for(const result of ratios) expect(result.ratio, result.selector).toBeGreaterThanOrEqual(4.5);
  };
  await checkContrast();
  expect(after.tick).toBe(before.tick);
  expect(after.frames).toEqual(before.frames);
  expect(after.camera).toEqual(before.camera);
  expect(after.selected).toEqual(before.selected);
  expect(after.layers).toEqual(before.layers);
  expect(after.palette.background).toBe('#edf1f3');
  await page.screenshot({path:`test-results/theme-light-${variant}.png`,fullPage:true});
  await page.reload();
  await expect(page.locator('#status')).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', {name:'Switch to dark mode', exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await checkContrast();
  expect((await state(page)).palette.background).toBe('#20282b');
  if (variant === 'mobile') {
    await page.locator('canvas').scrollIntoViewIfNeeded();
    await page.locator('#seek').dispatchEvent('input');
    await page.waitForTimeout(250);
    await page.screenshot({path:'test-results/mobile-viewport.png'});
  }
  await page.screenshot({path:`test-results/theme-dark-${variant}.png`,fullPage:true});
});

test("beginner flow shows one method, real feeding milestones and provenance", async ({page}) => {
  await ready(page);
  await expect(page.locator('.view-label')).toHaveCount(1);
  await expect(page.locator('#coverage')).toHaveAttribute('value', '0');
  await page.getByRole('button', {name: 'Random', exact: true}).click();
  await expect(page.locator('#status')).toBeHidden();
  await expect(page.locator('#strategy')).toHaveValue('random');
  await expect(page.locator('.view-label')).toHaveCount(1);
  await expect(page.locator('#method-explanation')).toContainText('No knowledge');
  await page.getByText('What counts as fed?', {exact: true}).click();
  await expect(page.locator('#feeding-help')).toBeVisible();
  await expect(page.locator('#feeding-help')).toContainText('three feeds do not automatically mean full');
  await page.locator('.help summary').first().focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#feeding-help')).toBeHidden();
  await page.getByRole('button', {name: 'Next feed', exact: true}).click();
  const next = await state(page);
  expect(next.frames[0].events.some((e: any) => e.type === 'first_feed')).toBeTruthy();
  await expect(page.locator('#feed-events')).toContainText('fed');
  await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Play replay');
  await page.getByRole('button', {name: '100% fed', exact: true}).click();
  const end = await state(page);
  expect(end.frames[0].fed).toBe(end.frames[0].first_feed.length);
  await expect(page.locator('#cycle-state')).toContainText('Round complete');
  await expect(page.locator('#coverage')).toHaveAttribute('value', '100');
  await expect(page.locator('#next-feed')).toBeDisabled();
  await page.getByText('Where these data come from', {exact: true}).click();
  await expect(page.locator('#provenance')).toContainText('ED_FL_3nests1noC2.csv');
  await expect(page.locator('#scenario-context')).toContainText('150 recorded rows');
  await page.getByRole('button', {name: 'Restart', exact: true}).click();
  expect((await state(page)).tick).toBe(0);
});

test('context mismatch cannot display unverified feeding completion', async ({page}) => {
  await page.route('**/scenario-context.json', async route => {
    const response = await route.fetch();
    const context = await response.json();
    context.scenarios['v14-S07'].scaled_larvae = 69;
    await route.fulfill({json: context});
  });
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('Dataset context does not match');
  expect((await state(page)).frames).toEqual([]);
  await expect(page.locator('#next-feed')).toBeDisabled();
  await expect(page.locator('#coverage')).toHaveAttribute('value', '0');
  await page.locator('#scenario').selectOption('v72-S03');
  await expect(page.locator('#status')).toBeHidden();
  await expect(page.locator('.view-label')).toHaveCount(1);
});

test('each method filter reaches its recorded end without extra views', async ({page}) => {
  await ready(page, '/?scenario=v87-S06');
  for (const method of ['tsp', 'biased', 'random', 'greedy', 'local_nearest', 'local_urgency_claims']) {
    if (method.startsWith('local_') && await page.locator('#extra-methods').getAttribute('open') === null)
      await page.locator('#extra-methods summary').click();
    await page.locator(`[data-method="${method}"]`).click();
    await expect(page.locator('#status')).toBeHidden();
    await expect(page.locator(`[data-method="${method}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.view-label')).toHaveCount(1);
    await page.getByRole('button', {name: '100% fed', exact: true}).click();
    const end = await state(page);
    expect(end.frames[0].fed).toBe(134);
    expect(end.frames[0].tick).toBe(end.tick);
    await expect(page.locator('#remaining')).toContainText('0 unfed / 0 part-fed');
  }
});

for (const variant of ['desktop', 'fallback', 'mobile'])
test(`comparison annotations never overlap rendered regions: ${variant}`, async ({page}) => {
  if (variant === 'mobile') await page.setViewportSize({width:390,height:844});
  await ready(page, '/?scenario=v87-S06&compare=1' + (variant === 'fallback' ? '&2d=1' : ''));
  const boxes = await page.evaluate(() => {
    const bounds = (element: Element) => {
      const r = element.getBoundingClientRect();
      return {x:r.x, y:r.y, right:r.right, bottom:r.bottom};
    };
    return {canvas:bounds(document.querySelector('canvas')!),
      legend:bounds(document.querySelector('#legend')!),
      controls:bounds(document.querySelector('footer')!),
      labels:[...document.querySelectorAll('.view-label')].map(bounds),
      regions:(window as any).labState.regions};
  });
  expect(boxes.legend.y).toBeGreaterThanOrEqual(boxes.canvas.bottom);
  expect(boxes.controls.bottom).toBeLessThanOrEqual(boxes.canvas.y);
  expect(boxes.regions).toHaveLength(4);
  for (let i=0; i<4; i++) {
    const region = boxes.regions[i];
    expect(boxes.labels[i].bottom).toBeLessThanOrEqual(boxes.canvas.y + region.y);
    expect(region.h).toBeGreaterThan(100);
  }
  await expect(page.locator('#method-filters > button')).toHaveText(['Random', 'Biased', 'Greedy', 'TSP']);
  expect(await page.locator('.waiting').evaluate(e => getComputedStyle(e).backgroundColor)).toBe('rgb(128, 191, 255)');
  expect(await page.locator('.fed').evaluate(e => getComputedStyle(e).backgroundColor)).toBe('rgb(101, 214, 139)');
  expect(await page.locator('.wasp').evaluate(e => getComputedStyle(e).backgroundColor)).toBe('rgb(245, 196, 81)');
  await page.screenshot({path:`test-results/comparison-${variant}.png`,fullPage:true});
});
test('legacy references serve preserved players, not the v2 app shell', async ({page, request}) => {
  await ready(page, '/?strategy=tsp');
  await expect(page.locator('#legacy-replay')).toHaveAttribute('href', 'legacy/simulation_tsp.html');
  for (const method of ['tsp','biased','random','greedy']) {
    const response = await request.get(`/legacy/simulation_${method}.html`);
    expect(response.ok()).toBeTruthy();
    const html = await response.text();
    expect(html).toContain('new Animation(');
    expect(html).not.toContain('/src/main.ts');
  }
  await page.locator('#strategy').selectOption('local_nearest');
  await expect(page.locator('#status')).toBeHidden();
  await expect(page.locator('#legacy-replay')).toBeHidden();
});

test('partial feeding is visible and green completion requires recorded low hunger', async ({page}) => {
  await ready(page, '/?scenario=v87-S06');
  const partial = await page.evaluate(() => {
    // Read the already-loaded, validated trace through its public metrics state.
    return (window as any).labState.partialExample;
  });
  expect(partial).not.toBeNull();
  await page.locator('#seek').fill(String(partial.tick));
  await page.locator('#seek').dispatchEvent('input');
  await page.locator('#entity').selectOption(`larva:${partial.index}`);
  await expect(page.locator('#details')).toContainText('Part-fed, still hungry');
  const f = (await state(page)).frames[0];
  expect(f.feed_counts[partial.index]).toBeGreaterThan(0);
  expect(f.hunger[partial.index]).toBeGreaterThan(.12);
  expect(f.satiated_at[partial.index]).toBe(-1);
  await page.screenshot({path:'test-results/partial-feeding.png',fullPage:true});
  await page.getByRole('button', {name:'100% fed',exact:true}).click();
  const final = (await state(page)).frames[0];
  expect(final.hunger.every((h:number) => h <= .12)).toBeTruthy();
  expect(final.satiated_at.every((t:number) => t >= 0)).toBeTruthy();
  await expect(page.locator('#details')).toContainText('Full (model threshold)');
});

test('pointer-centered zoom, pan and reset keep the replay unchanged', async ({page}) => {
  await ready(page, '/?scenario=v87-S06');
  const original = await state(page), box = await page.locator('canvas').boundingBox();
  if (!box) throw Error('Missing canvas');
  await page.mouse.move(box.x+box.width*.65, box.y+box.height*.65);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0,-250);
  await page.keyboard.up('Control');
  await expect.poll(async() => (await state(page)).cameraTarget).not.toEqual(original.cameraTarget);
  const zoomed = await state(page);
  expect(zoomed.tick).toBe(original.tick);
  expect(zoomed.frames).toEqual(original.frames);
  await page.mouse.down({button:'right'});
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5,{steps:10});
  await page.mouse.up({button:'right'});
  expect((await state(page)).cameraTarget).not.toEqual(zoomed.cameraTarget);
  await page.locator('#reset').click();
  expect((await state(page)).camera).toEqual(original.camera);
  expect((await state(page)).cameraTarget).toEqual(original.cameraTarget);
  await page.keyboard.down('Shift');
  await page.mouse.move(box.x+box.width*.65,box.y+box.height*.65);
  await page.mouse.down();
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5,{steps:10});
  await page.mouse.up();
  await page.keyboard.up('Shift');
  expect((await state(page)).cameraTarget).not.toEqual(original.cameraTarget);
  expect((await state(page)).frames).toEqual(original.frames);
  await page.locator('#reset').click();
  expect((await state(page)).cameraTarget).toEqual(original.cameraTarget);
  const legend = await page.locator('#legend').boundingBox();
  if (!legend) throw Error('Missing legend');
  expect(legend.y).toBeGreaterThanOrEqual(box.y+box.height);
});

test('wide replay supports two-axis trackpad pan and explicit zoom', async ({page}) => {
  await ready(page, '/?scenario=v87-S06');
  const canvas = page.locator('canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  expect(box.width).toBeGreaterThan(1400);
  expect(box.height).toBeGreaterThan(450);
  const initial = await state(page);
  const distance = (s: any) => Math.hypot(...s.camera.map((v:number,i:number) => v-s.cameraTarget[i]));
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.wheel(160,0);
  await expect.poll(async () => (await state(page)).cameraTarget).not.toEqual(initial.cameraTarget);
  const horizontal = await state(page);
  expect(distance(horizontal)).toBeCloseTo(distance(initial), 6);
  await page.mouse.wheel(0,160);
  await expect.poll(async () => (await state(page)).cameraTarget).not.toEqual(horizontal.cameraTarget);
  expect(distance(await state(page))).toBeCloseTo(distance(initial), 6);
  await page.locator('#zoom-in').click();
  expect(distance(await state(page))).toBeLessThan(distance(initial));
  await canvas.scrollIntoViewIfNeeded();
  const zoomBox = (await canvas.boundingBox())!;
  await page.mouse.move(zoomBox.x+zoomBox.width/2,zoomBox.y+zoomBox.height/2);
  const beforeDiagonal = await state(page);
  await page.mouse.wheel(113,-79);
  await expect.poll(async () => (await state(page)).cameraTarget).not.toEqual(beforeDiagonal.cameraTarget);
  const diagonal = await state(page);
  expect(distance(diagonal)).toBeCloseTo(distance(beforeDiagonal),6);
  expect(diagonal.cameraTarget[1]).not.toBeCloseTo(beforeDiagonal.cameraTarget[1],6);
  expect(diagonal.cameraTarget[0]).not.toBeCloseTo(beforeDiagonal.cameraTarget[0],6);
  await page.mouse.wheel(-113,79);
  await expect.poll(async () => (await state(page)).cameraTarget[0]).toBeCloseTo(beforeDiagonal.cameraTarget[0],6);
  expect((await state(page)).frames).toEqual(initial.frames);
  await page.locator('#zoom-out').click();
  expect(distance(await state(page))).toBeCloseTo(distance(initial), 6);
  await page.locator('#reset').click();
  expect((await state(page)).camera).toEqual(initial.camera);
  expect((await state(page)).frames).toEqual(initial.frames);
  await page.locator('#expand-view').click();
  await expect(page.locator('.viewport')).toHaveJSProperty('clientWidth', 1440);
  await expect(page.locator('#expand-view')).toHaveText('Exit full screen');
  await page.screenshot({path:'test-results/expanded-replay.png'});
  await page.locator('#expand-view').click();
  await expect(page.locator('#expand-view')).toHaveText('Expand view');
  await canvas.scrollIntoViewIfNeeded();
  await page.screenshot({path:'test-results/wide-replay.png'});
});

test('theme controls work when browser storage is unavailable', async ({page}) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {throw Error('Storage blocked')};
    Storage.prototype.setItem = () => {throw Error('Storage blocked')};
  });
  await ready(page);
  await page.getByRole('button',{name:'Switch to light mode',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
});
test("recorded playback, seek and inspector retain camera / hidden pin", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ready(page);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({path: "test-results/initial.png", fullPage: true});
  const initial = await state(page);
  expect(initial.mode).toBe("3d");
  await page.locator("#entity").selectOption("worker:0");
  await page.locator("#seek").fill("20");
  await page.locator("#seek").dispatchEvent("input");
  const seeking = await state(page);
  expect(seeking.tick).toBe(20);
  expect(seeking.camera).toEqual(initial.camera);
  await expect(page.locator("#details")).toHaveAttribute(
    "data-position",
    seeking.frames[0].positions[0].join(","),
  );
  await page.locator('#layer-controls summary').click();
  await page.locator("[data-layer=wasps]").uncheck();
  await expect(page.locator("#details")).toContainText("layer is hidden");
  expect((await state(page)).selected.index).toBe(0);
  await page.locator("#play").click();
  await page.waitForTimeout(700);
  expect((await state(page)).tick).toBeGreaterThan(20);
  await page.locator("#play").click();
  await page
    .locator("#seek")
    .fill((await page.locator("#seek").getAttribute("max")) || "1");
  await page.locator("#seek").dispatchEvent("input");
  await expect(page.locator("#view-labels")).toContainText("COMPLETE");
  await page.locator("[data-layer=wasps]").check();
  await page.waitForTimeout(250);
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
  expect(errors).toEqual([]);
});
test("original four methods share actual tick and retain final states", async ({
  page,
}) => {
  await ready(page);
  await page.locator("#compare").check();
  await expect(page.locator(".view-label")).toHaveCount(4);
  await expect(page.locator("#status")).toBeHidden();
  const s = await state(page);
  expect(s.frames.length).toBe(4);
  expect(s.frames.every((f: any) => f.tick === 0)).toBeTruthy();
  await page.locator("#seek").fill("80");
  await page.locator("#seek").dispatchEvent("input");
  const next = await state(page);
  expect(next.frames.every((f: any) => f.tick <= 80)).toBeTruthy();
  await page
    .locator("#seek")
    .fill((await page.locator("#seek").getAttribute("max")) || "1");
  await page.locator("#seek").dispatchEvent("input");
  const end = await state(page);
  expect(
    end.frames.every((f: any) => f.first_feed.every((v: number) => v >= 0)),
  ).toBeTruthy();
  await page.waitForTimeout(250);
  await page.screenshot({ path: "test-results/compare.png", fullPage: true });
});
test("fallback preserves layer controls, playback and inspection", async ({
  page,
}) => {
  await ready(page, "/?2d=1");
  expect((await state(page)).mode).toBe("2d");
  await expect(page.locator("#top")).toBeDisabled();
  await page.locator("#entity").selectOption("larva:0");
  await expect(page.locator("#details")).toContainText("Initial hunger");
  await page.locator('#layer-controls summary').click();
  await page.locator("[data-layer=larvae]").uncheck();
  await expect(page.locator("#details")).toContainText("layer is hidden");
  await page.locator("#seek").fill("10");
  await page.locator("#seek").dispatchEvent("input");
  expect((await state(page)).tick).toBe(10);
  await page.screenshot({ path: "test-results/fallback.png", fullPage: true });
});
test("mobile layout stays inside viewport and controls remain usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.locator("#entity").selectOption("worker:1");
  await expect(page.locator("#details")).toContainText("Position (XY)");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
});
test("orbit drag does not pin an entity and data switches dispose old geometry", async ({
  page,
}) => {
  await ready(page);
  await page.locator("#entity").selectOption("worker:0");
  const before = await state(page);
  const box = await page.locator("canvas").boundingBox();
  if (!box) throw Error("Canvas missing");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 100,
    box.y + box.height / 2 + 20,
    { steps: 10 },
  );
  await page.mouse.up();
  const after = await state(page);
  expect(after.selected).toEqual(before.selected);
  expect(after.camera).not.toEqual(before.camera);
  for (const s of [
    "random",
    "greedy",
    "local_nearest",
    "local_urgency_claims",
  ]) {
    await page.locator("#strategy").selectOption(s);
    await expect(page.locator("#status")).toBeHidden();
  }
  const final = await state(page);
  expect(final.renderer.geometries).toBeLessThan(20);
});

test('playback performance and all selected nest traces stay valid', async ({page}) => {
  await ready(page);
  for (const id of await page.locator('#scenario option').evaluateAll(options=>options.map(o=>(o as HTMLOptionElement).value))) {
    await page.locator('#scenario').selectOption(id);
    await expect(page.locator('#status')).toBeHidden();
    await page.locator('#compare').check();
    await expect(page.locator('#status')).toBeHidden();
    expect((await state(page)).frames.length).toBe(4);
    await page.locator('#compare').uncheck();
    await expect(page.locator('#status')).toBeHidden();
  }
  await page.locator('#strategy').selectOption('random');
  await expect(page.locator('#status')).toBeHidden();
  await page.locator('#speed').selectOption('10');
  await page.locator('#play').click();
  await page.waitForTimeout(5000);
  const measurement = await page.evaluate(() => ({fps:(window as any).labState.measuredFps,
    heapMB:(performance as any).memory?.usedJSHeapSize/1024**2,
    geometries:(window as any).labState.renderer.geometries}));
  console.log('Measured viewer:',JSON.stringify(measurement));
  // Hosted CI uses software WebGL; only the local device measures the hardware gate.
  if (!process.env.CI) expect(measurement.fps).toBeGreaterThanOrEqual(20);
  if(measurement.heapMB) expect(measurement.heapMB).toBeLessThan(500);
});
