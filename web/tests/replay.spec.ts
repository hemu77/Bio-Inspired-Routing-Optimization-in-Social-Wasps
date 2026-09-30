import { test, expect } from "@playwright/test";
const state = async (page: any) =>
  page.evaluate(() => (window as any).labState);
async function ready(page: any, url = "/") {
  await page.goto(url);
  await expect(page.locator("#status")).toBeHidden({ timeout: 30000 });
}

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
  await expect(page.locator('#feeding-help')).toContainText('not satiation');
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
  await expect(page.locator('#scenario-context')).toContainText('97 recorded rows');
  await page.getByRole('button', {name: 'Restart', exact: true}).click();
  expect((await state(page)).tick).toBe(0);
});

test('context mismatch cannot display unverified feeding completion', async ({page}) => {
  await page.route('**/scenario-context.json', async route => {
    const response = await route.fetch();
    const context = await response.json();
    context.scenarios['v14-S08'].scaled_larvae = 69;
    await route.fulfill({json: context});
  });
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('Dataset context does not match');
  expect((await state(page)).frames).toEqual([]);
  await expect(page.locator('#next-feed')).toBeDisabled();
  await expect(page.locator('#coverage')).toHaveAttribute('value', '0');
  await page.locator('#scenario').selectOption('v72-S07');
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
    await expect(page.locator('#remaining')).toContainText('0 waiting');
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
  expect(await page.locator('.fed').evaluate(e => getComputedStyle(e).backgroundColor)).toBe('rgb(81, 181, 161)');
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
