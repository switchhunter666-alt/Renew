// Real Electron on the Windows CI desktop. This does not run mGBA or automate native file pickers.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');

test('Windows Electron boots its real preload, persists settings and displays native service errors', {
  skip: process.platform !== 'win32', timeout: 120000,
}, async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'renew-native-smoke-'));
  const artifactDirectory = path.resolve('artifacts/native');
  await fs.mkdir(artifactDirectory, { recursive: true });
  const profile = path.join(temporary, 'profile');
  await fs.mkdir(profile);
  const bootstrap = path.join(temporary, 'launch.cjs');
  await fs.writeFile(bootstrap, `const {app} = require('electron'); app.setPath('userData', ${JSON.stringify(profile)}); require(${JSON.stringify(path.resolve('desktop/main.cjs'))});`);
  let application;
  t.after(async () => {
    if (application) await application.close().catch(() => {});
    await fs.rm(temporary, { recursive: true, force: true });
  });
  const launch = async () => {
    application = await electron.launch({ args: [bootstrap], cwd: process.cwd(), timeout: 30000 });
    const page = await application.firstWindow({ timeout: 30000 });
    await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
    return page;
  };
  let page = await launch();
  const dataPath = await application.evaluate(({ app }) => app.getPath('userData'));
  const relative = path.relative(temporary, dataPath);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'All test state must remain inside the temporary app-data root.');
  assert.equal(await page.evaluate(() => typeof window.renewAPI?.getState), 'function');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.locator('.preview-pill').count(), 0);
  assert.equal(await page.locator('.game-card').count(), 0);
  await page.getByRole('button', { name: 'Maximize or restore', exact: true }).click();
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(true);
  await page.getByRole('button', { name: 'Maximize or restore', exact: true }).click();
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(false);
  await page.getByRole('button', { name: 'Minimize', exact: true }).click();
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(true);
  // Restore this test-owned window to continue; this is not a taskbar interaction claim.
  await application.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.restore(); win.show(); win.focus(); });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Launch', exact: true }).click();
  await page.getByRole('switch', { name: 'Start games fullscreen' }).uncheck();
  await expect(page.getByRole('switch', { name: 'Start games fullscreen' })).toBeEnabled();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.screenshot({ path: path.join(artifactDirectory, 'renew-windows-empty.png') });
  await application.close(); application = null;
  const stateFile = path.join(dataPath, 'library.json');
  const saved = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  assert.equal(saved.settings.fullscreen, false, 'Real IPC saved the setting to disk.');

  // A clearly named inert fixture exercises the library UI. It is not a playable game.
  const rom = path.join(temporary, 'Launch-check fixture.gba');
  await fs.writeFile(rom, Buffer.alloc(192));
  saved.games = [{ id: 'native-fixture', title: 'Launch-check fixture', path: rom, system: 'GBA',
    favorite: false, playSeconds: 0, lastPlayed: null, addedAt: new Date().toISOString(), art: 'aurora' }];
  await fs.writeFile(stateFile, JSON.stringify(saved));
  page = await launch();
  await expect(page.locator('.game-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Details for Launch-check fixture', exact: true }).click();
  await page.getByRole('textbox', { name: 'Display name' }).fill('Renamed launch-check fixture');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('.card-title')).toHaveText('Renamed launch-check fixture');
  await page.getByRole('button', { name: 'Play game', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Choose your mGBA executable');
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  await page.screenshot({ path: path.join(artifactDirectory, 'renew-windows-library-fixture.png') });
  const closed = application.waitForEvent('close');
  await page.getByRole('button', { name: 'Close Renew', exact: true }).click();
  await closed; application = null;
  const after = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  assert.equal(after.games[0].title, 'Renamed launch-check fixture');
  assert.equal(after.games[0].playSeconds, 0, 'No emulator was launched or gameplay credited.');
  assert.equal(after.settings.fullscreen, false);
});
