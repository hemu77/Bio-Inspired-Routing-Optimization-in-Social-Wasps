import { test, expect } from "@playwright/test";
const state = async (page: any) =>
  page.evaluate(() => (window as any).labState);
async function ready(page: any, url = "/") {
  await page.goto(url);
  await expect(page.locator("#status")).toBeHidden({ timeout: 30000 });
}
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
