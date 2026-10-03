'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { writeFileSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright');
const { expect } = require('@playwright/test');
const { verifyPackagedUI } = require('./packaged-ui.cjs');
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

// The NSIS portable wrapper need not forward child stderr, so attach by temporary
// loopback-only ports rather than scraping debugger URLs from the wrapper pipe.
// No source bootstrap, preload replacement or app-module injection is used.
async function launchPortable({executablePath, profile, cwd, env, evidence, checkpoint}) {
  const allocatePort = () => new Promise((resolve, reject) => {
    const server = require('node:net').createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const port=server.address().port; server.close(error=>error?reject(error):resolve(port)); });
  });
  const nodePort = await allocatePort(), chromePort = await allocatePort();
  assert.notEqual(nodePort, chromePort);
  const args = [`--inspect=127.0.0.1:${nodePort}`, '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${chromePort}`, `--user-data-dir=${profile}`];
  env={...env}; delete env.NODE_OPTIONS; delete env.ELECTRON_RUN_AS_NODE;
  const wrapper = spawn(executablePath, args, {cwd, env, windowsHide:false, stdio:['ignore','pipe','pipe']});
  let wrapperError;
  wrapper.on('error', error => { wrapperError = error; });
  let output = '';
  for (const stream of [wrapper.stdout, wrapper.stderr]) stream.on('data', chunk => { output=(output+chunk.toString()).slice(-12000); });
  const attempt = {wrapperPid:wrapper.pid, executablePath, args, transport:'temporary-loopback-CDP-and-Node-inspector'};
  (evidence.launchAttempts ||= []).push(attempt); checkpoint('portable:spawned');
  let browser, ws;
  try {
    const deadline=Date.now()+45000;
    let nodeEndpoint, chromeEndpoint;
    while (Date.now()<deadline) {
      if (wrapperError) throw wrapperError;
      if (wrapper.exitCode !== null) throw new Error(`Portable wrapper exited before attachment: ${wrapper.exitCode}`);
      try {
        const targets=await fetch(`http://127.0.0.1:${nodePort}/json/list`, {signal:AbortSignal.timeout(1000)}).then(r=>r.json());
        const version=await fetch(`http://127.0.0.1:${chromePort}/json/version`, {signal:AbortSignal.timeout(1000)}).then(r=>r.json());
        if (targets.length===1 && targets[0].webSocketDebuggerUrl && version.webSocketDebuggerUrl) { nodeEndpoint=targets[0].webSocketDebuggerUrl; chromeEndpoint=version.webSocketDebuggerUrl; break; }
      } catch { /* Wait for this portable's extraction and runtime startup. */ }
      await sleep(200);
    }
    assert.ok(nodeEndpoint, 'The spawned portable must expose both temporary loopback debugging endpoints.');
    const nodeURL=new URL(nodeEndpoint);
    assert.ok(['127.0.0.1','localhost'].includes(nodeURL.hostname));
    assert.equal(Number(nodeURL.port),nodePort);
    const chromeURL=new URL(chromeEndpoint);
    assert.ok(['127.0.0.1','localhost'].includes(chromeURL.hostname));
    assert.equal(Number(chromeURL.port),chromePort);
    assert.equal(nodeURL.protocol,'ws:'); assert.equal(chromeURL.protocol,'ws:');
    ws=new WebSocket(nodeEndpoint);
    await bounded(new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',()=>reject(new Error('Node inspector socket failed.')),{once:true});}),5000,'Inspector connect');
    let counter=0;
    const pending=new Map();
    ws.addEventListener('message',event=>{
      const message=JSON.parse(event.data);
      const task=pending.get(message.id); if(!task)return; pending.delete(message.id);
      if(message.error)task.reject(new Error(message.error.message));else task.resolve(message.result);
    });
    ws.addEventListener('close',()=>{for(const task of pending.values())task.reject(new Error('Inspector disconnected.'));pending.clear();});
    const rpc=async(method,params)=>{
      const id=++counter;
      const request=new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
      try{return await bounded(request,10000,`Inspector ${method}`);}finally{pending.delete(id);}
    };
    await rpc('Runtime.enable',{});
    const evaluate=async(fn,arg)=>{
      const result=await rpc('Runtime.evaluate',{expression:`(${fn.toString()})(require('electron'),${JSON.stringify(arg) ?? 'undefined'})`,
        includeCommandLineAPI:true,awaitPromise:true,returnByValue:true});
      if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    browser=await chromium.connectOverCDP(chromeEndpoint,{timeout:15000});
    const context=browser.contexts()[0];
    assert.ok(context,'The actual packaged browser context must exist.');
    attempt.attached=true; attempt.wrapperOutput=output; checkpoint('portable:attached');
    return {
      process:()=>wrapper, context:()=>context, evaluate,
      forceClose:async()=>{
        evidence.forcedCleanup=true; evidence.status='FAIL';
        ws.close(); await bounded(browser.close(),3000,'CDP detach').catch(()=>{});
        if(wrapper.exitCode===null){
          await execFileAsync('taskkill.exe',['/PID',String(wrapper.pid),'/T','/F'],{timeout:10000,windowsHide:true});
          attempt.forcedTreeCleanup=true;
        }
      },
      firstWindow:async()=>context.pages()[0] || context.waitForEvent('page',{timeout:30000}),
      close:async()=>{
        const exited=wrapper.exitCode!==null ? Promise.resolve() : new Promise(resolve=>wrapper.once('exit',resolve));
        await evaluate(({app})=>{app.quit();return true;}).catch(error=>{if(wrapper.exitCode===null && ws.readyState===WebSocket.OPEN)throw error;});
        // Node waits for an attached inspector to detach before exiting.
        ws.close();
        await bounded(exited,8000,'Portable wrapper exit');
        await browser.close();
      },
    };
  } catch(error) {
    attempt.error=error.message; attempt.wrapperOutput=output;
    checkpoint('portable:attachment-error');
    ws?.close(); if(browser) await bounded(browser.close(),3000,'Failed-attach CDP detach').catch(()=>{});
    // Only the exact child process tree spawned above may be terminated on error.
    // This is failed-test cleanup and is never accepted as clean exit evidence.
    if(wrapper.pid && wrapper.exitCode===null){
      evidence.forcedCleanup=true;
      try { await execFileAsync('taskkill.exe',['/PID',String(wrapper.pid),'/T','/F'],{timeout:10000,windowsHide:true}); attempt.forcedTreeCleanup=true; }
      catch(cleanupError){attempt.cleanupError=cleanupError.message; evidence.cleanupError=cleanupError.message;}
    }
    checkpoint('portable:attachment-failed-cleanup');
    throw error;
  }
}

test('Windows portable: packaged UI, authored ROM, fullscreen and clean return', {
  skip: process.platform !== 'win32' ? 'Windows-only native integration; not measured here.' : false,
  timeout: 300000,
}, async t => {
  const artifactDirectory = path.resolve('artifacts/packaged');
  await fs.mkdir(artifactDirectory, { recursive: true });
  for (const name of await fs.readdir(artifactDirectory)) {
    if (/^(?:result\.json|frame-(?:\d+|close-timeout)\.png|renew-(?:before|returned)\.png|packaged-(?:empty|home|library|device-info|palette|failure)\.png)$/.test(name)) {
      await fs.rm(path.join(artifactDirectory, name));
    }
  }
  const isCandidate=process.env.RENEW_PACKAGE_KIND==='candidate';
  const target=isCandidate ? {kind:'candidate',sourceCommit:process.env.GITHUB_SHA || null} :
    {kind:'released',sourceCommit:'af421c2be2baa73830e254102ebb0b90188e1a99',releaseTag:'v0.1.0-preview.1',
      zipSha256:'bc7603bd37555c5017c3bc0cf8379d3d6d4b2d4e21ceafce23b9219995d9522e'};
  const evidence = { status: 'RUNNING', harnessCommit: process.env.GITHUB_SHA || null, target,
    os: os.release(),
    platform: process.platform, architecture: process.arch, mgbaVersion: '0.10.5', asset: ASSET,
    archiveSha256: process.env.RENEW_MGBA_ARCHIVE_SHA256 || null, samples: [], checks: {},
    exclusions: ['physical PC', 'audio', 'audio synchronization', 'real-time frame pacing',
      'default OpenGL display', 'controller/input', 'native file pickers', 'commercial-game compatibility', 'SmartScreen/MOTW handling', 'physical device identification'] };
  const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'renew-packaged-')));
  let application, executable, renewPid, profile, page;
  const pageErrors = [];
  const releaseExe = process.env.RENEW_RELEASE_EXE;
  const expectedExeHash = isCandidate ? process.env.RENEW_EXPECTED_EXE_SHA256 : '30ff74860e7bd3808b8e09f8fb51047651f50855f7d9fa6203fd9742e9cdd1c4';
  const expectedAsarHash = isCandidate ? process.env.RENEW_EXPECTED_ASAR_SHA256 : 'dde2994d917993cabe7451c76e65370c6f6c6c6bf7558f688ea526035f838285';
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
        // If inspector detachment made the graceful retry impossible, terminate
        // only this still-owned portable wrapper's process tree and keep FAIL.
        try { await bounded(application.forceClose(),12000,'Owned portable tree cleanup'); }
        catch (cleanupError) { evidence.cleanupError=cleanupError.message; }
        for (let attempt=0;attempt<20 && processExists(renewPid);attempt++) await sleep(250);
        evidence.electronStillRunning=processExists(renewPid);
        if(evidence.electronStillRunning) evidence.cleanupError='Packaged main process exit could not be confirmed.';
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
    // Portable, test-owned config only. Qt's software display avoids depending
    // on an accelerated OpenGL driver in the hosted Windows VM. This does not
    // alter Renew's launch path or the user's mGBA/desktop configuration.
    // Audio consumption can stall the emulation thread on hosted VMs. This
    // pixel/foreground gate is deliberately unsynchronized; it does not test
    // audio or real-time frame pacing. Keep every RGB observation mandatory.
    const coreConfig = 'useBios=0\nskipBios=1\nshowFps=1\ndynamicTitle=1\nshowFilename=0\naudioSync=0\nvideoSync=0\n';
    const qtConfig = '[General]\ndisplayDriver=0\n';
    await fs.writeFile(path.join(copy, 'config.ini'), coreConfig);
    await fs.writeFile(path.join(copy, 'qt.ini'), qtConfig);
    evidence.emulatorConfiguration = { displayDriver: 'Qt software (0)',
      audioSync: false, videoSync: false,
      scope: 'Isolated portable test copy only; audio synchronization, real-time pacing and default OpenGL display are not qualified.',
      configIniSha256: sha256(coreConfig), qtIniSha256: sha256(qtConfig) };
    const romPath = path.join(temporary, 'Renew smoke animation.gba');
    const bytes = makeSmokeRom();
    await fs.writeFile(romPath, bytes);
    const rom = await fs.realpath(romPath);
    evidence.testPaths.rom = { constructed: romPath, canonical: rom };
    evidence.rom = { title: 'RENEW SMOKE', size: bytes.length, sha256: sha256(bytes),
      expectedFrames: ['red', 'green', 'blue'], provenance: 'Original logo-free test fixture generated from source.' };
    evidence.harnessSha256 = {};
    for (const file of ['tests/native/packaged-release.test.cjs', 'tests/native/packaged-ui.cjs',
      'tests/native/windows-probe.ps1', 'tests/native/fixtures/renew-smoke-rom.cjs']) {
      evidence.harnessSha256[file] = sha256(await fs.readFile(file));
    }
    assert.ok(releaseExe, 'Set RENEW_RELEASE_EXE to the hash-bound outer portable.');
    assert.match(expectedExeHash || '',/^[a-f0-9]{64}$/); assert.match(expectedAsarHash || '',/^[a-f0-9]{64}$/);
    evidence.target={...target,expectedExeSha256:expectedExeHash,expectedAsarSha256:expectedAsarHash};
    assert.equal(sha256(await fs.readFile(releaseExe)), expectedExeHash, 'The launched EXE must match the exact target artifact receipt.');
    const sourceManifest={};
    if(isCandidate){
      for(const directory of ['desktop','src']) for(const name of await fs.readdir(directory,{recursive:true})){
        const file=path.join(directory,name); if(!(await fs.stat(file)).isFile())continue;
        sourceManifest[file.split(path.sep).join('/')]=sha256(await fs.readFile(file));
      }
      evidence.expectedPackagedFiles=sourceManifest;
    }
    const appData = path.join(temporary, 'appdata');
    const localAppData = path.join(temporary, 'localappdata');
    const portableTemp=path.join(temporary,'Portable ~ # % 日本');
    await fs.mkdir(appData); await fs.mkdir(localAppData); await fs.mkdir(portableTemp);
    profile = path.join(appData, 'Renew');
    await fs.mkdir(profile);
    const assertOwnedPath = candidate => {
      const relative = path.relative(temporary, candidate);
      assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'App data must stay in the test temporary root.');
    };
    const launchPackaged = async () => {
      checkpoint('portable:launch');
      application = await launchPortable({executablePath:releaseExe, profile, cwd:temporary,
        env:{...process.env, APPDATA:appData, LOCALAPPDATA:localAppData, TEMP:portableTemp, TMP:portableTemp}, evidence, checkpoint});
      application.context().setDefaultTimeout(12000);
      page = await application.firstWindow({timeout: 30000});
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.waitForLoadState('domcontentloaded');
      const identity = await application.evaluate(({app, BrowserWindow}) => ({
        isPackaged: app.isPackaged, appPath: app.getAppPath(), userData: app.getPath('userData'),
        exePath: process.execPath, resourcesPath: process.resourcesPath, argv: process.argv,
        version: app.getVersion(), electron: process.versions.electron, platform: process.platform,
        pid: process.pid, parentPid:process.ppid, url: BrowserWindow.getAllWindows()[0].webContents.getURL(),
        preloadIntrospection: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().preload || null,
        packagedPreload: (()=>{const p=require('node:path').join(app.getAppPath(),'desktop','preload.cjs');
          return {path:p,normalizedSha256:require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync(p,'utf8').replace(/\r\n/g,'\n')).digest('hex')};})(),
        securityPreferences: (()=>{const p=BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
          return {sandbox:p.sandbox,contextIsolation:p.contextIsolation,nodeIntegration:p.nodeIntegration,webSecurity:p.webSecurity};})(),
        portableExecutable: process.env.PORTABLE_EXECUTABLE_FILE || null,
        expectedEntryURL: require('node:url').pathToFileURL(require('node:path').join(app.getAppPath(),'src','index.html')).href,
        mainFrameURL: BrowserWindow.getAllWindows()[0].webContents.mainFrame.url,
        mainFrameRoutingId: BrowserWindow.getAllWindows()[0].webContents.mainFrame.routingId,
        webContentsId: BrowserWindow.getAllWindows()[0].webContents.id,
        modulePaths: Object.keys(require.cache).filter(file=>/[\\/]desktop[\\/](?:main|preload)\.cjs$/.test(file)),
        pathDiagnosis: (()=>{
          const paths=require('node:path'), urls=require('node:url'), fs=require('node:fs');
          const main=Object.keys(require.cache).find(file=>/[\\/]desktop[\\/]main\.cjs$/.test(file));
          const entry=main ? paths.join(paths.dirname(main),'..','src','index.html') : null;
          const actual=BrowserWindow.getAllWindows()[0].webContents.mainFrame.url;
          const result={loadedMain:main,entryPath:entry,entryURL:entry ? urls.pathToFileURL(entry).href : null,actualURL:actual};
          for(const [name,value] of [['entryRealPath',entry],['actualRealPath',actual.startsWith('file:') ? urls.fileURLToPath(actual) : null]]){
            try{result[name]=value ? fs.realpathSync(value) : null;}catch(error){result[name+'Error']=error.message;}
          }
          return result;
        })(),
      }));
      renewPid = identity.pid;
      assertOwnedPath(await fs.realpath(identity.userData));
      profile = identity.userData;
      const asarHash = sha256(await fs.readFile(identity.appPath));
      const runningExeHash = sha256(await fs.readFile(identity.exePath));
      (evidence.packagedLaunches ||= []).push({...identity, asarSha256: asarHash, runningExeSha256: runningExeHash,
        renderer:await page.evaluate(()=>({url:location.href,apiType:typeof window.renewAPI?.getState,text:document.body.innerText.slice(0,2000)}))});
      checkpoint('portable:identity');
      assert.equal(page.url(),identity.mainFrameURL,'CDP page must match the exact Node-owned packaged renderer URL.');
      assert.equal(await page.evaluate(()=>location.href),identity.mainFrameURL);
      if(isCandidate){
        const actualFiles=await application.evaluate(({app},files)=>{
          const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),actual={};
          for(const file of files){try{actual[file]=crypto.createHash('sha256').update(fs.readFileSync(path.join(app.getAppPath(),...file.split('/')))).digest('hex');}
            catch(error){actual[file]={error:error.message};}}
          return actual;
        },Object.keys(sourceManifest));
        evidence.packagedLaunches.at(-1).sourceFiles=actualFiles; checkpoint('portable:source-binding');
        assert.deepEqual(actualFiles,sourceManifest,'Every running production source/resource byte must match this checkout.');
      }
      assert.equal(identity.isPackaged, true);
      assert.equal(identity.parentPid, application.process().pid, 'Packaged process must be the exact spawned portable wrapper child.');
      assert.equal((await fs.realpath(identity.portableExecutable)).toLowerCase(), (await fs.realpath(releaseExe)).toLowerCase());
      assert.equal(identity.platform, 'win32');
      assert.equal(identity.version, '0.1.0');
      assert.equal(identity.electron, '44.5.1');
      assert.equal(path.basename(identity.exePath).toLowerCase(), 'renew.exe');
      assert.equal(identity.appPath, path.join(identity.resourcesPath, 'app.asar'));
      assert.equal(asarHash, expectedAsarHash, 'Running app.asar must match the exact target artifact receipt.');
      assert.equal(identity.packagedPreload.path, path.join(identity.appPath, 'desktop', 'preload.cjs'));
      assert.equal(identity.packagedPreload.normalizedSha256,sha256((await fs.readFile('desktop/preload.cjs','utf8')).replace(/\r\n/g,'\n')));
      assert.deepEqual(identity.securityPreferences,{sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true});
      assert.equal(require('node:url').fileURLToPath(identity.url),path.join(identity.appPath,'src','index.html'));
      assert.equal(new URL(identity.url).search,''); assert.equal(new URL(identity.url).hash,'');
      assert.ok(!identity.argv.some(arg => /(?:launch|bootstrap)\.cjs|node_modules[\\/]electron|--require|^-r$/.test(arg)), 'No source bootstrap fallback may be present.');
      assert.equal(await page.evaluate(() => typeof window.renewAPI?.getState), 'function');
      assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
      await expect(page.locator('.preview-pill')).toHaveCount(0);
      await expect(page.getByRole('heading', {name:'Home',exact:true})).toBeVisible({timeout:15000});
      return identity;
    };
    await launchPackaged();
    await expect(page.locator('.game-card')).toHaveCount(0);
    await page.screenshot({path:path.join(artifactDirectory,'packaged-empty.png')});
    evidence.checks.emptyPackagedStartup = true;
    await bounded(application.close(), 10000, 'Empty packaged app close'); application = null;
    // Supported schema only, written while the test app is closed. This is explicit data
    // seeding, not native file-picker coverage, and it does not import a source service.
    const rom2Path = path.join(temporary, 'Second authored sample.gba');
    await fs.writeFile(rom2Path, bytes);
    const rom2 = await fs.realpath(rom2Path);
    const document = {schemaVersion:1, settings:{emulatorPath:executable, fullscreen:true, returnToLauncher:true}, games:[
      {id:'packaged-smoke', title:'Renew smoke animation', path:rom, system:'GBA', favorite:false, playSeconds:0, lastPlayed:null, addedAt:'2026-10-03T00:01:00.000Z', art:'aurora'},
      {id:'packaged-second', title:'Second authored sample', path:rom2, system:'GBA', favorite:false, playSeconds:0, lastPlayed:null, addedAt:'2026-10-03T00:00:00.000Z', art:'ocean'}
    ]};
    await fs.writeFile(path.join(profile,'library.json'), JSON.stringify(document));
    evidence.seeding = {method:'Supported schemaVersion 1 library.json written while closed', games:2, proprietaryData:false, nativeFilePickers:false};
    checkpoint('fixture:ready');
    await launchPackaged();
    await verifyPackagedUI({application, page, profile, artifactDirectory, evidence, checkpoint, rom2,
      restart: async () => {
        await bounded(application.close(), 10000, 'Enabled Power preference restart'); application = null;
        await launchPackaged();
        return {application, page};
      }
    });
    assert.deepEqual(pageErrors, [], 'No renderer exceptions during packaged UI checks.');
    checkpoint('ui:complete');
    await bounded(application.close(), 10000, 'Packaged app persistence restart'); application = null;
    await launchPackaged();
    await expect(page.getByRole('button', {name:'Open command palette',exact:true})).toHaveCount(0);
    const persistentState = await page.evaluate(() => window.renewAPI.getState());
    assert.equal(persistentState.games.length, 1);
    assert.equal(persistentState.games[0].favorite, true);
    assert.equal(persistentState.games[0].title, 'Verified authored animation');
    assert.equal(persistentState.settings.fullscreen, true);
    assert.equal(persistentState.settings.returnToLauncher, true);
    evidence.checks.restartPersistence = true;
    const wrapperPid = application.process().pid;
    application.context().setDefaultTimeout(10000);
    checkpoint('electron:connected');
    await page.getByRole('button', {name:'Library',exact:true}).click();
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
    evidence.closeRequest = await runProbe({ op: 'close', exe: executable,
      emulatorPid: launched?.pid, emulatorHandle: launched?.handle });
    checkpoint('emulator:close-posted');
    try {
      await expect.poll(async () => (await page.evaluate(() => window.renewAPI.getState())).session,
        { timeout: 15000 }).toBe(null);
    } catch (error) {
      // Preserve the actual post-close window and session before any cleanup.
      // A successful PostMessage only means WM_CLOSE was queued, not that the
      // emulator exited or Renew regained foreground.
      try {
        evidence.afterCloseTimeout = await sample(path.join(artifactDirectory, 'frame-close-timeout.png'));
        evidence.sessionAfterCloseTimeout = (await page.evaluate(() => window.renewAPI.getState())).session;
      } catch (diagnosticError) { evidence.closeTimeoutDiagnosticError = diagnosticError.message; }
      checkpoint('emulator:close-timeout');
      throw error;
    }
    const state = await page.evaluate(() => window.renewAPI.getState());
    assert.deepEqual(pageErrors, [], 'Packaged renderer remained exception-free.');
    evidence.rendererErrors = pageErrors;
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
    evidence.status = 'FAIL'; evidence.error = error.stack; checkpoint('verification:error');
    if (page && !page.isClosed()) await page.screenshot({path:path.join(artifactDirectory,'packaged-failure.png'), timeout:5000}).catch(() => {});
    throw error;
  }
});
