import { test, expect } from '@playwright/test';

test('rendered preview: search, selection, favorites, dialogs, settings and empty state', async ({page}, testInfo) => {
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/?preview=1');
  await expect(page.getByRole('heading',{name:'Your next little escape.'})).toBeVisible();
  await expect(page.locator('.game-card')).toHaveCount(6);
  await expect(page.locator('img').first()).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('renew-library-preview.png'),fullPage:true});
  await page.getByRole('searchbox',{name:'Find a game'}).fill('moon');
  await expect(page.locator('.game-card')).toHaveCount(1);
  await expect(page.locator('.card-title')).toHaveText('Moonlit Letters');
  await page.getByRole('searchbox',{name:'Find a game'}).fill('');
  await page.getByRole('button',{name:'Select Between the Tides',exact:true}).click();
  await expect(page.locator('#hero-title')).toHaveText('Between the Tides');
  await page.getByRole('button',{name:'Play game'}).click();
  await expect(page.getByRole('dialog')).toContainText('does not launch an emulator');
  await page.getByRole('button',{name:'Got it',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.screenshot({path:testInfo.outputPath('renew-settings-preview.png'),fullPage:false});
  await page.getByRole('switch',{name:'Start games fullscreen'}).uncheck();
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.getByRole('switch',{name:'Start games fullscreen'})).not.toBeChecked();
  await page.getByRole('button',{name:'Explore the empty-library state'}).click();
  await expect(page.locator('.game-card')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'A new home for old favorites.'})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('renew-empty-preview.png'),fullPage:true});
  expect(errors).toEqual([]);
});

test('supported narrow window retains named navigation and no horizontal overflow',async({page},testInfo)=>{
  await page.setViewportSize({width:980,height:720});
  await page.goto('/?preview=1');
  for(const name of ['Library','Favorites','Settings','Game Boy Advance','Game Boy Color','Game Boy']) await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Details for The Verdant Trail'}).click();
  await page.getByRole('textbox',{name:'Display name'}).fill('A'.repeat(160));
  await page.getByRole('button',{name:'Save name'}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('renew-narrow-preview.png'),fullPage:true});
});

test('preview never silently replaces a missing desktop connection',async({page})=>{
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Renew couldn’t open your library'})).toBeVisible();
  await expect(page.locator('.game-card')).toHaveCount(0);
});
