import { test, expect } from '@playwright/test';

test('rendered preview: search, selection, favorites, dialogs, settings and empty state', async ({page}, testInfo) => {
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/?preview=1');
  await page.getByRole('button',{name:'Library',exact:true}).click();
  await expect(page.getByRole('heading',{name:'The Last Orchard',exact:true})).toBeVisible();
  await expect(page.locator('.game-card')).toHaveCount(6);
  await expect(page.locator('img').first()).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('renew-library-preview.png'),fullPage:true});
  await page.getByRole('searchbox',{name:'Find a game'}).fill('moon');
  await expect(page.locator('.game-card')).toHaveCount(1);
  await expect(page.locator('.card-title')).toHaveText('Moonlit Letters');
  await page.getByRole('searchbox',{name:'Find a game'}).fill('');
  await page.getByRole('button',{name:'Select Between the Tides',exact:true}).click();
  await expect(page.locator('#hero-title')).toHaveText('Between the Tides');
  await page.getByRole('button',{name:'Play game',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('does not launch an emulator');
  await page.getByRole('button',{name:'Got it',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.screenshot({path:testInfo.outputPath('renew-settings-preview.png'),fullPage:false});
  await page.getByRole('tab',{name:'Launch',exact:true}).click();
  await page.getByRole('switch',{name:'Start games fullscreen'}).uncheck();
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('tab',{name:'Launch',exact:true}).click();
  await expect(page.getByRole('switch',{name:'Start games fullscreen'})).not.toBeChecked();
  await page.getByRole('button',{name:'Explore the empty-library state'}).click();
  await expect(page.locator('.game-card')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'A new home for old favorites.'})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('renew-empty-preview.png'),fullPage:true});
  expect(errors).toEqual([]);
});

test('supported narrow window retains named navigation and no horizontal overflow',async({page},testInfo)=>{
  await page.setViewportSize({width:980,height:680});
  await page.goto('/?preview=1');
  await page.getByRole('button',{name:'Library',exact:true}).click();
  for(const name of ['Library','Favorites','Settings','Game Boy Advance','Game Boy Color','Game Boy']) await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Details for The Last Orchard'}).click();
  await page.getByRole('textbox',{name:'Display name'}).fill('A'.repeat(160));
  await page.getByRole('button',{name:'Save name'}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await expect(page.locator('#hero-title')).toHaveAccessibleName('A'.repeat(160));
  await expect(page.locator('#hero-title')).toHaveAttribute('title','A'.repeat(160));
  await expect(page.locator('.card-title').first()).toHaveAccessibleName('A'.repeat(160));
  for (const [selector, lines] of [['#hero-title',3],['.cover-wordmark',3],['.card-title',2]]) {
    const box = await page.locator(selector).first().evaluate(element => ({height:element.getBoundingClientRect().height,lineHeight:parseFloat(getComputedStyle(element).lineHeight),scrollHeight:element.scrollHeight}));
    expect(box.height).toBeLessThanOrEqual(box.lineHeight*lines+2);
    expect(box.scrollHeight).toBeGreaterThan(box.height);
  }
  const art = await page.locator('.game-art-button').first().boundingBox();
  const badge = await page.locator('.card-favorite').first().boundingBox();
  expect(badge.y).toBeGreaterThanOrEqual(art.y);
  expect(badge.y+badge.height).toBeLessThan(art.y+art.height);
  // The app dismisses notifications after 5 seconds; leave room for browser scheduling.
  await expect(page.locator('#toast')).toBeHidden({timeout:10000});
  await page.screenshot({path:testInfo.outputPath('renew-narrow-preview.png'),fullPage:true});
});

test('preview never silently replaces a missing desktop connection',async({page})=>{
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Renew couldn’t open your library'})).toBeVisible();
  await expect(page.locator('.game-card')).toHaveCount(0);
});

test('art-led console menu collapses, keeps keyboard focus and remembers the choice',async({page},testInfo)=>{
  await page.goto('/?preview=1');
  await page.getByRole('button',{name:'Library',exact:true}).click();
  const toggle=page.getByRole('button',{name:'Expand navigation menu',exact:true});
  await expect(toggle).toHaveAttribute('aria-expanded','false');
  await toggle.focus();await toggle.press('Enter');
  const collapse=page.getByRole('button',{name:'Collapse navigation menu',exact:true});
  await expect(collapse).toBeFocused();await expect(collapse).toHaveAttribute('aria-expanded','true');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('renew-menu-expanded.png'),fullPage:true});
  await page.reload();await expect(page.getByRole('button',{name:'Collapse navigation menu',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Collapse navigation menu',exact:true}).click();
  await page.screenshot({path:testInfo.outputPath('renew-menu-collapsed.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('browser add, details, favorites, sort, views, invalid title and removal controls',async({page})=>{
  await page.goto('/?preview=1');
  await page.getByRole('button',{name:'Library',exact:true}).click();
  const chooserPromise=page.waitForEvent('filechooser');
  await page.getByRole('button',{name:'Add games from quick actions',exact:true}).click();
  const chooser=await chooserPromise;
  await chooser.setFiles({name:'CI library fixture.gba',mimeType:'application/octet-stream',buffer:Buffer.alloc(192)});
  await expect(page.locator('.game-card')).toHaveCount(7);
  await page.getByRole('button',{name:'Details for CI library fixture',exact:true}).click();
  await page.getByRole('textbox',{name:'Display name'}).fill('');
  await page.getByRole('button',{name:'Save name',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.getByRole('textbox',{name:'Display name'}).evaluate(element=>element.validity.valid)).toBe(false);
  await page.getByRole('textbox',{name:'Display name'}).fill('A verified preview import');
  await page.getByRole('button',{name:'Save name',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button',{name:'Select A verified preview import',exact:true}).click();
  await page.getByRole('button',{name:'Add to favorites',exact:true}).click();
  await page.getByRole('button',{name:'Favorites',exact:true}).click();
  await expect(page.locator('.game-card')).toHaveCount(3);
  await page.getByRole('combobox',{name:'Sort games'}).selectOption('title');
  await page.getByRole('button',{name:'List view',exact:true}).click();
  await expect(page.locator('.game-grid')).toHaveClass(/list-layout/);
  await page.getByRole('button',{name:'Grid view',exact:true}).click();
  await expect(page.locator('.game-grid')).not.toHaveClass(/list-layout/);
  await page.getByRole('button',{name:'Details for A verified preview import',exact:true}).click();
  await page.getByRole('button',{name:'Remove',exact:true}).click();
  await page.getByRole('button',{name:'Keep game',exact:true}).click();
  await expect(page.locator('.game-card')).toHaveCount(3);
  await page.getByRole('button',{name:'Details for A verified preview import',exact:true}).click();
  await page.getByRole('button',{name:'Remove',exact:true}).click();
  await page.getByRole('button',{name:'Remove from library',exact:true}).click();
  await expect(page.locator('.game-card')).toHaveCount(2);
  await expect(page.getByRole('button',{name:'Add games',exact:true})).toBeFocused();
});

test('filtered selection and empty search keep artwork, hero and launch aligned', async ({page}, testInfo) => {
  await page.goto('/?preview=1');
  await page.getByRole('button',{name:'Library',exact:true}).click();
  await page.getByRole('searchbox',{name:'Find a game'}).fill('moon');
  await expect(page.locator('#hero-title')).toHaveText('Moonlit Letters');
  await expect(page.getByRole('button',{name:'Select Moonlit Letters',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.scene img')).toHaveAttribute('src','./art/violet-v1.png');
  await page.getByRole('searchbox',{name:'Find a game'}).fill('not in this library');
  await expect(page.getByRole('heading',{name:'No games in this view.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Play game',exact:true})).toHaveCount(0);
  await page.getByRole('searchbox',{name:'Find a game'}).press('Enter');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.screenshot({path:testInfo.outputPath('renew-no-results.png'),fullPage:true});
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();
  await expect(page.locator('#hero-title')).toHaveText('The Last Orchard');
});

test('console settings category rail, keyboard navigation and repeated dismissal', async ({page}, testInfo) => {
  await page.goto('/?preview=1');
  await page.getByRole('button',{name:'Library',exact:true}).click();
  const settings = page.getByRole('button',{name:'Settings',exact:true});
  await settings.click();
  await expect(page.getByRole('tabpanel',{name:'Emulator',exact:true})).toBeVisible();
  await expect(page.getByRole('tabpanel',{name:'Launch',exact:true})).not.toBeVisible();
  await page.getByRole('tab',{name:'Emulator',exact:true}).focus();
  await page.getByRole('tab',{name:'Emulator',exact:true}).press('ArrowDown');
  await expect(page.getByRole('tab',{name:'Launch',exact:true})).toBeFocused();
  await expect(page.getByRole('tabpanel',{name:'Launch',exact:true})).toBeVisible();
  await page.getByRole('switch',{name:'Come back to Renew',exact:true}).uncheck();
  await page.screenshot({path:testInfo.outputPath('renew-settings-launch.png'),fullPage:false});
  await page.getByRole('button',{name:'Close settings',exact:true}).click();
  await expect(settings).toBeFocused();
  await settings.click();
  await page.getByRole('tab',{name:'Launch',exact:true}).click();
  await expect(page.getByRole('switch',{name:'Come back to Renew',exact:true})).not.toBeChecked();
  await page.getByRole('dialog').press('Escape');
  await expect(settings).toBeFocused();
  await settings.click();
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(settings).toBeFocused();
});
