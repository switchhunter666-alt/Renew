'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { createInterface } = require('node:readline');
const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');
const { LauncherService } = require('../../desktop/services.cjs');
const { makeSmokeRom } = require('./fixtures/renew-smoke-rom.cjs');

const ASSET = 'https://github.com/mgba-emu/mgba/releases/download/0.10.5/mGBA-0.10.5-win64.7z';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = data => createHash('sha256').update(data).digest('hex');

function startProbe() {
  const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
    path.join(__dirname, 'windows-probe.ps1')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let pending, failure, stderr = '';
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-8000); });
  const rejectPending = error => { failure = error; if (pending) { pending.reject(error); pending = null; } };
  child.once('error', rejectPending);
  child.once('exit', code => rejectPending(new Error(`Windows probe exited (${code}): ${stderr}`)));
  createInterface({ input: child.stdout }).on('line', line => {
    if (!pending) return;
    const current = pending; pending = null;
    try {
      const value = JSON.parse(line);
      if (value.error) throw new Error(value.error);
      current.resolve(value);
    } catch (error) { current.reject(error); }
  });
  return {
    async request(payload) {
      if (failure) throw failure;
      assert.ok(!pending, 'Only one native probe request may be outstanding.');
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending = null; child.kill(); reject(new Error('Windows probe timed out.')); }, 15000);
        pending = { resolve: value => { clearTimeout(timer); resolve(value); },
          reject: error => { clearTimeout(timer); reject(error); } };
        child.stdin.write(`${JSON.stringify(payload)}\n`);
      });
    },
    stop() { child.stdin.end('{"op":"quit"}\n'); child.kill(); },
  };
}
function usableDesktop(sample) {
  return sample.interactive && sample.sessionId > 0 && sample.desktopReadable &&
    sample.inputDesktop.toLowerCase() === 'default' && sample.foregroundPid > 0;
}
function fullscreen(window) {
  return window.visible && !window.minimized && !window.caption &&
    ['left', 'top', 'right', 'bottom'].every(edge => Math.abs(window.rect[edge] - window.monitor[edge]) <= 2);
}
function observedColor(pixels) {
  for (let channel = 0; channel < 3; channel++) {
    if (pixels.filter(pixel => pixel[channel] >= 200 &&
      pixel.every((value, index) => index === channel || value <= 60)).length >= 7) return ['red', 'green', 'blue'][channel];
  }
  return null;
}

test('real mGBA: Play hands off fullscreen, authored ROM advances, closing returns to Renew', {
  skip: process.platform !== 'win32' ? 'Windows-only native integration; not measured here.' : false,
  timeout: 180000,
}, async t => {
  const artifactDirectory = path.resolve('artifacts/native/mgba');
  await fs.mkdir(artifactDirectory, { recursive: true });
  for (const name of await fs.readdir(artifactDirectory)) {
    if (/^(?:result\.json|frame-\d+\.png|renew-(?:before|returned)\.png)$/.test(name)) {
      await fs.rm(path.join(artifactDirectory, name));
    }
  }
  const evidence = { status: 'RUNNING', commit: process.env.GITHUB_SHA || null, os: os.release(),
    platform: process.platform, architecture: process.arch, mgbaVersion: '0.10.5', asset: ASSET,
    archiveSha256: process.env.RENEW_MGBA_ARCHIVE_SHA256 || null, samples: [], checks: {},
    exclusions: ['physical PC', 'audio', 'controller/input', 'native file pickers', 'packaged executable'] };
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'renew-mgba-'));
  let application, probe, executable, renewPid;
  t.after(async () => {
    // Kill only this test's unique copied emulator path if graceful exit did not finish.
    if (probe && executable) {
      try { evidence.cleanup = await probe.request({ op: 'cleanup', exe: executable }); }
      catch (error) { evidence.cleanupError = error.message; }
    }
    if (application) await application.close().catch(error => {
      evidence.closeError = error.message; application.process().kill();
    });
    if (probe) probe.stop();
    evidence.finishedAt = new Date().toISOString();
    if (evidence.status === 'RUNNING' || evidence.cleanupError || evidence.closeError) evidence.status = 'FAIL';
    await fs.writeFile(path.join(artifactDirectory, 'result.json'), JSON.stringify(evidence, null, 2));
    // Remove only our own temporary tree. Retain it when cleanup was unconfirmed.
    if (!evidence.cleanupError && !evidence.closeError) {
      await fs.rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
    }
    assert.ok(!evidence.cleanupError && !evidence.closeError, 'Test-owned process cleanup must be confirmed.');
  });
  try {
    assert.ok(process.env.RENEW_MGBA_EXE, 'Set RENEW_MGBA_EXE to the official extracted mGBA 0.10.5 executable; see docs/NATIVE_TEST.md.');
    const source = await fs.realpath(process.env.RENEW_MGBA_EXE);
    assert.match(path.basename(source), /^mgba\.exe$/i);
    const copy = path.join(temporary, 'official mGBA');
    await fs.cp(path.dirname(source), copy, { recursive: true });
    executable = path.join(copy, path.basename(source));
    evidence.executableSha256 = sha256(await fs.readFile(executable));
    await fs.writeFile(path.join(copy, 'portable.ini'), '');
    // Portable, test-owned config only. Do not alter desktop/session/focus policies.
    await fs.writeFile(path.join(copy, 'config.ini'), 'useBios=0\nskipBios=1\nshowFps=1\ndynamicTitle=1\nshowFilename=0\n');
    const rom = path.join(temporary, 'Renew smoke animation.gba');
    const bytes = makeSmokeRom();
    await fs.writeFile(rom, bytes);
    evidence.rom = { title: 'RENEW SMOKE', size: bytes.length, sha256: sha256(bytes),
      expectedFrames: ['red', 'green', 'blue'], provenance: 'Original logo-free test fixture generated from source.' };
    evidence.sourceSha256 = {};
    for (const file of ['desktop/main.cjs', 'desktop/preload.cjs', 'desktop/services.cjs',
      'desktop/library-store.cjs', 'desktop/mgba-session.cjs', 'src/app.js',
      'tests/native/mgba-integration.test.cjs', 'tests/native/windows-probe.ps1', 'tests/native/fixtures/renew-smoke-rom.cjs']) {
      evidence.sourceSha256[file] = sha256(await fs.readFile(file));
    }
    const profile = path.join(temporary, 'profile');
    await fs.mkdir(profile);
    // Use the real service for setup; dialogs are outside this test's coverage.
    const seed = new LauncherService({ statePath: path.join(profile, 'library.json') });
    await seed.initialize();
    await seed.setEmulator(executable);
    await seed.importGames([rom]);
    await seed.updateSettings({ fullscreen: true, returnToLauncher: true });
    const bootstrap = path.join(temporary, 'launch.cjs');
    await fs.writeFile(bootstrap, `const {app} = require('electron'); app.setPath('userData', ${JSON.stringify(profile)}); require(${JSON.stringify(path.resolve('desktop/main.cjs'))});`);
    application = await electron.launch({ args: [bootstrap], cwd: process.cwd(), timeout: 30000 });
    renewPid = application.process().pid;
    const page = await application.firstWindow({ timeout: 30000 });
    await expect(page.locator('.game-card')).toHaveCount(1);
    probe = startProbe();
    const sample = capture => probe.request({ op: 'probe', exe: executable, renewPid, capture });
    let before = await sample();
    // Observe natural startup, without focus()/SetForegroundWindow or simulated OS activation.
    for (let attempt = 0; attempt < 5 && usableDesktop(before) && before.foregroundPid !== renewPid; attempt++) {
      await sleep(500); before = await sample();
    }
    evidence.beforePlay = before;
    if (!usableDesktop(before) || before.foregroundPid !== renewPid) {
      evidence.status = 'BLOCKED';
      evidence.reason = !usableDesktop(before) ? 'No usable interactive Default foreground desktop.' :
        'Renew was not the foreground window before Play; a user-like handoff baseline was unavailable.';
      t.skip(evidence.reason); return;
    }
    await page.screenshot({ path: path.join(artifactDirectory, 'renew-before.png') });
    await page.getByRole('button', { name: 'Play game', exact: true }).click();
    await expect.poll(async () => (await page.evaluate(() => window.renewAPI.getState())).session?.status,
      { timeout: 15000 }).toBe('running');
    evidence.checks.realSessionRunning = true;
    const colors = new Set();
    let launched;
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const shot = path.join(artifactDirectory, `frame-${evidence.samples.length}.png`);
      const current = await sample(shot);
      evidence.samples.push(current);
      if (!usableDesktop(current) || current.captureError) {
        evidence.status = 'BLOCKED'; evidence.reason = current.captureError ? `Screen pixels unavailable: ${current.captureError}` :
          'The interactive foreground desktop became unavailable during playback.';
        break;
      }
      assert.ok(current.emulators.length <= 1, 'Exactly one test-owned emulator may be launched.');
      const window = current.emulators[0];
      if (window) {
        launched = window;
        assert.equal(window.parentPid, renewPid, 'mGBA must be spawned by the actual Electron main process.');
        assert.ok(window.commandLine.includes(rom), 'The actual child command line must contain the exact authored ROM path.');
        if (window.title.includes('RENEW SMOKE') && window.title.includes('0.10.5') && fullscreen(window) &&
          current.foregroundPid === window.pid && current.renew.minimized && current.capture) {
          const color = observedColor(current.capture.pixels);
          if (color) colors.add(color);
        }
      }
      if (colors.size === 3) break;
      await sleep(220);
    }
    evidence.observedColors = [...colors];
    if (evidence.status !== 'BLOCKED') {
      assert.ok(launched, 'A real test-owned mGBA window must appear.');
      assert.equal(colors.size, 3, 'Require actual ROM title, fullscreen monitor coverage, mGBA foreground, Renew minimized and all three expected screen colors.');
      evidence.checks.fullscreenForegroundFrames = true;
    }
    // A normal WM_CLOSE asks this owned mGBA window to exit; no process kill is used as pass evidence.
    await probe.request({ op: 'close', exe: executable });
    await expect.poll(async () => (await page.evaluate(() => window.renewAPI.getState())).session,
      { timeout: 15000 }).toBe(null);
    const state = await page.evaluate(() => window.renewAPI.getState());
    assert.equal(state.error, null, 'The real child must exit cleanly.');
    assert.ok(state.games[0].playSeconds >= 1, 'Elapsed session time must be recorded.');
    let after = await sample();
    for (let attempt = 0; attempt < 10 && usableDesktop(after) && after.foregroundPid !== renewPid; attempt++) {
      await sleep(300); after = await sample();
    }
    evidence.afterClose = after;
    assert.equal(after.emulators.length, 0, 'mGBA must actually exit.');
    if (!usableDesktop(after)) {
      evidence.status = 'BLOCKED'; evidence.reason = 'Foreground desktop unavailable after emulator close.';
    }
    if (evidence.status === 'BLOCKED') { t.skip(evidence.reason); return; }
    assert.equal(after.foregroundPid, renewPid, 'Renew must regain OS foreground after mGBA exits.');
    assert.ok(after.renew.visible && !after.renew.minimized, 'Renew must be visible and restored.');
    await page.screenshot({ path: path.join(artifactDirectory, 'renew-returned.png') });
    await application.close(); application = null;
    const persisted = JSON.parse(await fs.readFile(path.join(profile, 'library.json'), 'utf8'));
    assert.equal(persisted.games[0].playSeconds, state.games[0].playSeconds);
    evidence.checks.cleanExitReturnAndPersistence = true;
    evidence.playSeconds = state.games[0].playSeconds;
    evidence.status = 'PASS';
  } catch (error) {
    evidence.status = 'FAIL'; evidence.error = error.stack; throw error;
  }
});
