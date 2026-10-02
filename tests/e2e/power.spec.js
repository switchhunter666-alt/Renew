import {test, expect} from '@playwright/test';

async function enablePower(page) {
  await page.getByRole('button', {name:'Settings',exact:true}).click();
  await page.getByRole('tab', {name:'Power user',exact:true}).click();
  await page.getByRole('switch', {name:'Power user tools',exact:true}).check();
  await page.getByRole('switch', {name:'Command palette',exact:true}).check();
  await page.getByRole('button', {name:'Done',exact:true}).click();
}
async function capture(page, testInfo, filename) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({path: testInfo.outputPath(filename), fullPage: false});
}
const search = page => page.getByRole('searchbox', {name:'Find a command or game',exact:true});

test('Power user defaults off; actual settings tabs, switches, reload and reset preserve independent choices', async ({page}, testInfo) => {
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/?preview=1');
  await expect(page.getByRole('button',{name:'Open command palette',exact:true})).toHaveCount(0);
  await page.locator('#collection-title').focus(); await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('tab',{name:'Emulator',exact:true}).focus(); await page.keyboard.press('End');
  await expect(page.getByRole('tab',{name:'Power user',exact:true})).toBeFocused();
  await expect(page.getByRole('switch',{name:'Power user tools',exact:true})).not.toBeChecked();
  await expect(page.getByRole('switch',{name:'Command palette',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Read device information'})).toBeDisabled();
  await page.getByRole('switch',{name:'Power user tools',exact:true}).check();
  await page.getByRole('switch',{name:'Command palette',exact:true}).check();
  await capture(page, testInfo, 'renew-power-settings.png');
  await page.getByRole('button',{name:'Done',exact:true}).click(); await page.reload();
  await expect(page.getByRole('button',{name:'Open command palette',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Settings',exact:true}).click(); await page.getByRole('tab',{name:'Power user',exact:true}).click();
  await page.getByRole('switch',{name:'Power user tools',exact:true}).uncheck();
  await expect(page.getByRole('switch',{name:'Command palette',exact:true})).toBeChecked();
  await expect(page.getByRole('switch',{name:'Command palette',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Done',exact:true}).click(); await page.reload();
  await expect(page.getByRole('button',{name:'Open command palette',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Settings',exact:true}).click(); await page.getByRole('tab',{name:'Power user',exact:true}).click();
  await page.getByRole('switch',{name:'Power user tools',exact:true}).check();
  await expect(page.getByRole('switch',{name:'Command palette',exact:true})).toBeChecked();
  await page.getByRole('button',{name:'Reset Power user tools'}).click();
  await expect(page.getByRole('switch',{name:'Power user tools',exact:true})).not.toBeChecked();
  await expect(page.getByRole('switch',{name:'Command palette',exact:true})).not.toBeChecked();
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await expect(page.locator('[data-shelf="recent"] .game-card')).toHaveCount(4);
  expect(errors).toEqual([]);
});

test('real palette keyboard navigation and Pick unplayed select a visible game without invoking preview launch', async ({page},testInfo) => {
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/?preview=1');await enablePower(page);
  const trigger=page.getByRole('button',{name:'Open command palette',exact:true});
  await trigger.focus();await page.keyboard.press('Control+k');await expect(search(page)).toBeFocused();
  await search(page).fill('Open Library');await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-power-command="library"]')).toBeFocused();await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).not.toBeVisible();await expect(page.locator('#collection-title')).toBeFocused();
  await page.keyboard.press('Enter');await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button',{name:'Game Boy',exact:true}).click();
  await trigger.click();await search(page).fill('Pick an unplayed');await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).not.toBeVisible();await expect(page.getByRole('heading',{name:'Library',exact:true})).toBeVisible();
  await expect(page.locator('.game-card')).toHaveCount(6);
  await expect(page.locator('[data-focus="filter-all"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.game-art-button:focus')).toHaveAttribute('aria-pressed','true');
  expect(['Another Dawn','Between the Tides']).toContain(await page.locator('#hero-title').textContent());
  await capture(page, testInfo, 'renew-power-pick-unplayed-selection.png');
  await trigger.click();await search(page).fill('no such command');await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();await expect(page.locator('#palette-results')).toHaveText('No matching commands.');
  await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
  await trigger.click();await search(page).fill('Play Moonlit Letters');await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toContainText('Native launch is available in the Windows desktop app');
  await expect(page.locator('#hero-title')).toHaveText('Moonlit Letters');
  await page.getByRole('button',{name:'Got it',exact:true}).click();
  await expect(page.getByRole('button',{name:'Play game',exact:true})).toBeFocused();
  await trigger.click();await search(page).fill('This device');await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toContainText('Unavailable in the visual preview');
  await expect(page.locator('#device-info')).not.toContainText('win32');
  await capture(page, testInfo, 'renew-power-preview-device-unavailable.png');
  expect(errors).toEqual([]);
});

test('palette renders all scene colors and stays within the existing narrow desktop viewport', async ({page},testInfo) => {
  await page.setViewportSize({width:980,height:680});await page.goto('/?preview=1');await enablePower(page);
  const scenes=[['aurora','The Last Orchard','recent'],['ember','Solstice Valley','recent'],['ocean','Between the Tides','unplayed'],['violet','Moonlit Letters','recent']];
  for(const [palette,title,shelf] of scenes){
    await page.locator(`[data-shelf="${shelf}"]`).getByRole('button',{name:`Select ${title}`,exact:true}).click();
    await expect(page.locator('#app')).toHaveAttribute('data-palette',palette);
    await page.getByRole('button',{name:'Open command palette',exact:true}).click();
    await expect(search(page)).toBeFocused();await page.keyboard.press('ArrowDown');await page.keyboard.press('End');
    const last=page.locator('[data-power-command]:not(:disabled)').last();await expect(last).toBeFocused();
    await page.keyboard.press('Home');await expect(page.locator('[data-power-command="home"]')).toBeFocused();
    const dialogBox=await page.getByRole('dialog').boundingBox();expect(dialogBox.x).toBeGreaterThanOrEqual(0);expect(dialogBox.y).toBeGreaterThanOrEqual(0);expect(dialogBox.x+dialogBox.width).toBeLessThanOrEqual(980);expect(dialogBox.y+dialogBox.height).toBeLessThanOrEqual(680);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await capture(page, testInfo, `renew-power-palette-${palette}-980.png`);
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('tab',{name:'Power user',exact:true}).click();
  await capture(page, testInfo, 'renew-power-settings-980.png');
});

test('Ctrl+K never replaces existing dialogs or edits and repeats cannot activate a palette command',async({page})=>{
  await page.goto('/?preview=1');await enablePower(page);
  await page.getByRole('searchbox',{name:'Find a game'}).focus();await page.keyboard.press('Control+k');await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.keyboard.press('Control+k');await expect(page.getByRole('dialog')).toContainText('Your emulator');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Open command palette',exact:true}).click();await search(page).fill('Open Library');
  await search(page).dispatchEvent('keydown',{key:'Enter',code:'Enter',repeat:true,bubbles:true,cancelable:true});
  await search(page).dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,bubbles:true,cancelable:true});
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Enter');await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('#collection-title')).toBeFocused();
});
