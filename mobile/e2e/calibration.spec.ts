/**
 * Setting your position by hand: on the full map, tap where you stand and
 * what the blaster points at. GPS and the compass are corrected from then on.
 */
import { test, expect } from '@playwright/test';
import { fitFull, mapExtent } from '../src/ui/mapFrame';
import { createSquad, intoMission, phone, place, shot, startMission, world } from './helpers';

test('marking your spot on the map corrects GPS and the compass', async ({ browser }) => {
  const ada = await phone(browser, 'Ada');
  await createSquad(ada);
  await ada.page.getByTestId('map-schmeichel').click();
  await startMission([ada]);
  await intoMission(ada);

  const map = await ada.page.evaluate(() => window.__loonieStore!.getState().map);
  const [sx, sy] = map.start as [number, number];
  // GPS says the start; really the player is 4 m away, aiming at the helicopter end of the building.
  await place(ada.page, sx, sy, 0);
  const really: [number, number] = [sx + 1, sy - 4];
  const target: [number, number] = [map.helicopter.x, map.helicopter.y];

  await ada.page.getByTestId('minimap-open').click();
  await ada.page.getByTestId('calibrate').click();
  await expect(ada.page.getByTestId('calibrate-steps')).toContainText('where you are standing');
  const box = (await ada.page.getByTestId('fullmap').boundingBox())!;
  const fit = fitFull(mapExtent(map), box.width, box.height);
  const tap = async ([x, y]: [number, number]) => {
    const [px, py] = fit.to(x, y);
    await ada.page.mouse.click(box.x + px, box.y + py);
  };
  await tap(really);
  await expect(ada.page.getByTestId('calibrate-steps')).toContainText('what your blaster points at');
  await shot(ada.page, '40-calibrate-facing');
  await tap(target);
  await expect(ada.page.getByTestId('calibrated')).toBeVisible();

  const bearing = (Math.atan2(target[0] - really[0], target[1] - really[1]) * 180) / Math.PI;
  let me = (await world(ada.page)).me;
  // A pixel on the map is a few centimetres of floor.
  expect(Math.hypot(me.x - really[0], me.y - really[1])).toBeLessThan(0.3);
  expect(Math.abs((((me.heading! - bearing) % 360) + 540) % 360 - 180)).toBeLessThan(1);

  // GPS keeps saying the start, and the compass keeps reading as before: both are now corrected.
  for (let i = 0; i < 8; i++) {
    await ada.page.evaluate(([x, y]) => window.__loonieSim!.at(x, y), [sx, sy]);
    await ada.page.evaluate(() => window.__loonieSim!.aim(0));
    await ada.page.waitForTimeout(150);
  }
  me = (await world(ada.page)).me;
  expect(Math.hypot(me.x - really[0], me.y - really[1])).toBeLessThan(0.5);
  expect(Math.abs((((me.heading! - bearing) % 360) + 540) % 360 - 180)).toBeLessThan(1);

  // Cancelling part way changes nothing.
  await ada.page.getByTestId('calibrate').click();
  await ada.page.getByTestId('calibrate-cancel').click();
  await expect(ada.page.getByTestId('fullmap-close')).toBeVisible();
  await ada.page.getByTestId('fullmap-close').click();
  await ada.ctx.close();
});
