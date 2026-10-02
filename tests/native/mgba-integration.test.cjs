'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { writeFileSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash } = require('node:crypto');
const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');
const { LauncherService } = require('../../desktop/services.cjs');
const { makeSmokeRom } = require('./fixtures/renew-smoke-rom.cjs');

const ASSET = 'https://github.com/mgba-emu/mgba/releases/download/0.10.5/mGBA-0.10.5-win64.7z';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = data => createHash('sha256').update(data).digest('hex');
async function bounded(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms.`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
function processExists(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

const execFileAsync = promisify(execFile);
async function runProbe(payload) {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  let stdout, stderr;
  try {
    ({ stdout, stderr } = await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive',
      '-File', path.join(__dirname, 'windows-probe.ps1'), '-RequestBase64', encoded],
    { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024, encoding: 'utf8' }));
  } catch (error) {
    throw new Error(`Windows probe ${payload.op} failed: ${error.message}\nstderr: ${error.stderr || '(empty)'}\nstdout: ${error.stdout || '(empty)'}`);
  }
  try {
    const value = JSON.parse(stdout.trim());
    if (value.error) throw new Error(value.error);
    return { ...value, probePhases: stderr.trim() };
  } catch (error) { throw new Error(`Windows probe ${payload.op}: ${error.message}\nstderr: ${stderr}`); }
}
function usableDesktop(sample) {
  return sample.interactive && sample.sessionId > 0 && sample.desktopReadable &&
    sample.inputDesktop.toLowerCase() === 'default' && sample.foregroundPid > 0;
}
function renewForeground(sample, identity) {
  return sample.renew.valid && sample.renew.ownerPid === identity.mainPid &&
    sample.renew.handle === identity.handle && sample.foregroundHandle === identity.handle &&
    sample.foregroundPid === identity.mainPid && sample.renew.visible && !sample.renew.minimized;
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
  let application, executable, renewPid, profile;
  const checkpoint = phase => {
    evidence.phase = phase;
    (evidence.journal ||= []).push({ phase, time: new Date().toISOString() });
    writeFileSync(path.join(artifactDirectory, 'result.json'), JSON.stringify(evidence, null, 2));
  };
  checkpoint('setup:start');
  t.after(async () => {
    if (evidence.status === 'RUNNING') evidence.status = 'FAIL';
    checkpoint('cleanup:start');
    // Kill only this test's unique copied emulator path if graceful exit did not finish.
    if (executable) {
      try {
        evidence.cleanup = await runProbe({ op: 'cleanup', exe: executable });
        if (evidence.cleanup.count) { evidence.forcedCleanup = true; evidence.status = 'FAIL'; }
      }
      catch (error) { evidence.cleanupError = error.message; }
    }
    checkpoint('cleanup:emulator-finished');
    if (application) {
      const wrapper = application.process();
      try { await bounded(application.close(), 8000, 'Electron cleanup close'); }
      catch (error) {
        evidence.closeError = error.message; evidence.forcedCleanup = true; evidence.status = 'FAIL';
        checkpoint('cleanup:electron-force-exit');
        try {
          const expected = { pid: renewPid, profile };
          const owned = await bounded(application.evaluate(({ app }, expected) => {
            if (process.pid !== expected.pid || app.getPath('userData') !== expected.profile) {
              throw new Error('Refusing force exit: Electron identity/profile mismatch.');
            }
            return { pid: process.pid, profile: app.getPath('userData') };
          }, expected), 3000, 'Electron ownership check');
          evidence.forcedElectronIdentity = owned;
          checkpoint('cleanup:electron-exit-requested');
          await bounded(application.evaluate(({ app }, expected) => {
            if (process.pid !== expected.pid || app.getPath('userData') !== expected.profile) {
              throw new Error('Refusing force exit: Electron identity/profile mismatch.');
            }
            app.exit(1);
          }, expected), 3000, 'Owned Electron exit').catch(exitError => {
            evidence.exitTransportMessage = exitError.message;
          });
        } catch (exitError) { evidence.forceExitError = exitError.message; }
        for (let attempt = 0; attempt < 10 && processExists(renewPid); attempt++) await sleep(250);
        evidence.electronStillRunning = processExists(renewPid);
        // The launcher wrapper is separately owned; killing it alone is not proof of app exit.
        if (wrapper.exitCode === null) wrapper.kill();
        for (const stream of wrapper.stdio || []) stream?.destroy?.();
        wrapper.unref();
      }
      application = null;
    }
    evidence.finishedAt = new Date().toISOString();
    if (evidence.status === 'RUNNING' || evidence.cleanupError || evidence.closeError || evidence.forcedCleanup) evidence.status = 'FAIL';
    checkpoint('cleanup:finished');
    // Remove only our own temporary tree. Retain it when cleanup was unconfirmed.
    if (!evidence.cleanupError && !evidence.closeError) {
      try {
        await bounded(fs.rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }), 5000, 'Temporary cleanup');
      } catch (error) {
        evidence.status = 'FAIL'; evidence.fileCleanupError = error.message; checkpoint('cleanup:file-error'); throw error;
      }
    }
    assert.ok(!evidence.cleanupError && !evidence.closeError && !evidence.forcedCleanup,
      'Cleanup must finish without forced termination; forced cleanup is never pass evidence.');
  });
  try {
    assert.ok(process.env.RENEW_MGBA_EXE, 'Set RENEW_MGBA_EXE to the official extracted mGBA 0.10.5 executable; see docs/NATIVE_TEST.md.');
    const source = await fs.realpath(process.env.RENEW_MGBA_EXE);
    assert.match(path.basename(source), /^mgba\.exe$/i);
    const copy = path.join(temporary, 'official mGBA');
    await fs.cp(path.dirname(source), copy, { recursive: true });
    const executablePath = path.join(copy, path.basename(source));
    executable = await fs.realpath(executablePath);
    evidence.testPaths = { executable: { constructed: executablePath, canonical: executable } };
    evidence.executableSha256 = sha256(await fs.readFile(executable));
    await fs.writeFile(path.join(copy, 'portable.ini'), '');
    // Portable, test-owned config only. Do not alter desktop/session/focus policies.
    await fs.writeFile(path.join(copy, 'config.ini'), 'useBios=0\nskipBios=1\nshowFps=1\ndynamicTitle=1\nshowFilename=0\n');
    const romPath = path.join(temporary, 'Renew smoke animation.gba');
    const bytes = makeSmokeRom();
    await fs.writeFile(romPath, bytes);
    const rom = await fs.realpath(romPath);
    evidence.testPaths.rom = { constructed: romPath, canonical: rom };
    evidence.rom = { title: 'RENEW SMOKE', size: bytes.length, sha256: sha256(bytes),
      expectedFrames: ['red', 'green', 'blue'], provenance: 'Original logo-free test fixture generated from source.' };
    evidence.sourceSha256 = {};
    for (const file of ['desktop/main.cjs', 'desktop/preload.cjs', 'desktop/services.cjs',
      'desktop/library-store.cjs', 'desktop/mgba-session.cjs', 'src/app.js',
      'tests/native/mgba-integration.test.cjs', 'tests/native/windows-probe.ps1', 'tests/native/fixtures/renew-smoke-rom.cjs']) {
      evidence.sourceSha256[file] = sha256(await fs.readFile(file));
    }
    profile = path.join(temporary, 'profile');
    await fs.mkdir(profile);
    profile = await fs.realpath(profile);
    checkpoint('fixture:ready');
    // Use the real service for setup; dialogs are outside this test's coverage.
    const seed = new LauncherService({ statePath: path.join(profile, 'library.json') });
    await seed.initialize();
    await seed.setEmulator(executable);
    await seed.importGames([rom]);
    await seed.updateSettings({ fullscreen: true, returnToLauncher: true });
    const bootstrap = path.join(temporary, 'launch.cjs');
    await fs.writeFile(bootstrap, `const {app} = require('electron'); app.setPath('userData', ${JSON.stringify(profile)}); require(${JSON.stringify(path.resolve('desktop/main.cjs'))});`);
    checkpoint('electron:launch');
    application = await electron.launch({ args: [bootstrap], cwd: process.cwd(), timeout: 30000 });
    const wrapperPid = application.process().pid;
    application.context().setDefaultTimeout(10000);
    checkpoint('electron:connected');
    const page = await application.firstWindow({ timeout: 30000 });
    await expect(page.locator('.game-card')).toHaveCount(1);
    const electronIdentity = () => application.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      if (windows.length !== 1) throw new Error('Expected exactly one Renew BrowserWindow.');
      const window = windows[0], native = window.getNativeWindowHandle();
      return { mainPid: process.pid, browserWindowId: window.id,
        handle: native.length === 8 ? native.readBigInt64LE().toString() : native.readInt32LE().toString(),
        visible: window.isVisible(), minimized: window.isMinimized() };
    });
    let identity = await electronIdentity();
    evidence.electronStartup = [identity];
    // Await the app's own ready-to-show/show path; observing does not activate it.
    for (let attempt = 0; attempt < 20 && !identity.visible; attempt++) {
      await sleep(250); identity = await electronIdentity(); evidence.electronStartup.push(identity);
    }
    evidence.renewIdentity = { wrapperPid, ...identity };
    checkpoint('electron:identity');
    renewPid = identity.mainPid;
    const sample = capture => runProbe({ op: 'probe', exe: executable, renewPid,
      renewHandle: identity.handle, wrapperPid, capture });
    let before = await sample();
    evidence.beforePlaySamples = [before];
    // Observe natural startup, without focus()/SetForegroundWindow or simulated OS activation.
    for (let attempt = 0; attempt < 5 && usableDesktop(before) && !renewForeground(before, identity); attempt++) {
      await sleep(500); before = await sample(); evidence.beforePlaySamples.push(before);
    }
    evidence.beforePlay = before;
    checkpoint('foreground:baseline');
    assert.ok(before.renew.valid, 'Electron native HWND must identify a live window.');
    assert.equal(before.renew.ownerPid, renewPid, 'The HWND owner must equal the Electron main-process PID.');
    if (!usableDesktop(before) || !renewForeground(before, identity)) {
      evidence.status = 'BLOCKED';
      evidence.reason = !usableDesktop(before) ? 'No usable interactive Default foreground desktop.' :
        'Renew was not the foreground window before Play; a user-like handoff baseline was unavailable.';
      t.skip(evidence.reason); return;
    }
    await page.screenshot({ path: path.join(artifactDirectory, 'renew-before.png') });
    checkpoint('play:requested');
    await page.getByRole('button', { name: 'Play game', exact: true }).click();
    await expect.poll(async () => (await page.evaluate(() => window.renewAPI.getState())).session?.status,
      { timeout: 15000 }).toBe('running');
    Object.assign(evidence.checks, { realSessionRunning: true, romIdentity: false,
      fullscreenForeground: false, frameProgress: false, cleanExitReturnAndPersistence: false });
    checkpoint('play:session-running');
    const colors = new Set();
    let launched;
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const shot = path.join(artifactDirectory, `frame-${evidence.samples.length}.png`);
      const current = await sample(shot);
      evidence.samples.push(current);
      checkpoint('play:sample');
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
        if (window.title.includes('RENEW SMOKE') && window.title.includes('0.10.5')) {
          evidence.checks.romIdentity = true;
          if (fullscreen(window) && current.foregroundPid === window.pid && current.renew.minimized) {
            evidence.checks.fullscreenForeground = true;
            const color = current.capture && observedColor(current.capture.pixels);
            if (color) colors.add(color);
          }
        }
      }
      if (colors.size === 3) break;
      await sleep(220);
    }
    evidence.observedColors = [...colors];
    evidence.checks.frameProgress = colors.size === 3;
    evidence.checks.fullscreenForegroundFrames = colors.size === 3;
    if (evidence.status !== 'BLOCKED') {
      assert.ok(launched, 'A real test-owned mGBA window must appear.');
      if (colors.size !== 3) evidence.playbackFailure =
        'Expected all three ROM colors during verified fullscreen/foreground playback.';
    }
    checkpoint('play:observations-complete');
    // A normal WM_CLOSE asks this owned mGBA window to exit; no process kill is used as pass evidence.
    checkpoint('emulator:close-requested');
    await runProbe({ op: 'close', exe: executable });
    await expect.poll(async () => (await page.evaluate(() => window.renewAPI.getState())).session,
      { timeout: 15000 }).toBe(null);
    const state = await page.evaluate(() => window.renewAPI.getState());
    checkpoint('emulator:session-finished');
    assert.equal(state.error, null, 'The real child must exit cleanly.');
    assert.ok(state.games[0].playSeconds >= 1, 'Elapsed session time must be recorded.');
    let after = await sample();
    for (let attempt = 0; attempt < 10 && usableDesktop(after) && !renewForeground(after, identity); attempt++) {
      await sleep(300); after = await sample();
    }
    evidence.afterClose = after;
    checkpoint('foreground:return');
    assert.equal(after.emulators.length, 0, 'mGBA must actually exit.');
    if (!usableDesktop(after)) {
      evidence.status = 'BLOCKED'; evidence.reason = 'Foreground desktop unavailable after emulator close.';
    }
    if (evidence.status === 'BLOCKED') {
      if (evidence.playbackFailure) assert.fail(evidence.playbackFailure);
      t.skip(evidence.reason); return;
    }
    assert.ok(renewForeground(after, identity), 'The exact Renew HWND must regain OS foreground after mGBA exits.');
    assert.ok(after.renew.visible && !after.renew.minimized, 'Renew must be visible and restored.');
    await page.screenshot({ path: path.join(artifactDirectory, 'renew-returned.png') });
    checkpoint('electron:close-requested');
    await bounded(application.close(), 8000, 'Electron final close'); application = null;
    const persisted = JSON.parse(await fs.readFile(path.join(profile, 'library.json'), 'utf8'));
    assert.equal(persisted.games[0].playSeconds, state.games[0].playSeconds);
    evidence.checks.cleanExitReturnAndPersistence = true;
    evidence.playSeconds = state.games[0].playSeconds;
    checkpoint('return:verified');
    // Keep the full gate strict, but collect normal close/return evidence before a color failure.
    assert.equal(colors.size, 3, evidence.playbackFailure || 'All three expected ROM colors must be observed.');
    evidence.status = 'PASS';
    checkpoint('verification:passed-before-cleanup');
  } catch (error) {
    evidence.status = 'FAIL'; evidence.error = error.stack; checkpoint('verification:error'); throw error;
  }
});
