const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
let dom, serial = 0;
const settle = async () => { for(let i=0;i<5;i++) await new Promise(resolve=>setImmediate(resolve)); };
function deferred() { let resolve,reject; const promise=new Promise((r,j)=>{resolve=r;reject=j});return {promise,resolve,reject}; }
async function setup(overrides={}) {
  dom = new JSDOM('<!doctype html><html><body><div id="app"></div><div id="announcer"></div><dialog id="dialog"></dialog><div id="toast" hidden></div></body></html>', {url:'http://localhost/',pretendToBeVisual:true});
  global.window=dom.window; global.document=dom.window.document;
  global.CSS={escape:value=>String(value).replace(/[^a-zA-Z0-9_-]/g,char=>`\\${char}`)};
  const dialog=document.querySelector('#dialog');
  // jsdom verifies DOM state, not native Chromium top-layer/focus behavior.
  dialog.showModal=function(){this.setAttribute('open','')};
  dialog.close=function(){this.removeAttribute('open')};
  let state={games:[
    {id:'a',title:'Green World',system:'GBA',favorite:true,playSeconds:65,lastPlayed:'2026-10-01T00:00:00.000Z',addedAt:'2026-09-01T00:00:00.000Z',art:'aurora',path:'C:\\Games\\Green World.gba'},
    {id:'b',title:'Blue Moon',system:'GB',favorite:false,playSeconds:0,lastPlayed:null,addedAt:'2026-10-02T00:00:00.000Z',art:'ocean',path:'C:\\Games\\Blue Moon.gb'}
  ],settings:{emulatorPath:'C:\\Emulators\\mGBA.exe',fullscreen:true,returnToLauncher:true},session:null,warning:null,error:null};
  const copy=()=>structuredClone(state); let sessionHandler;
  const api={getState:async()=>copy(),onSession:fn=>{sessionHandler=fn;return ()=>{}},chooseEmulator:async()=>copy(),importGames:async()=>copy(),
    updateSettings:async patch=>{Object.assign(state.settings,patch);return copy()},
    updateGame:async(id,patch)=>{Object.assign(state.games.find(game=>game.id===id),patch);return copy()},
    removeGame:async id=>{state.games=state.games.filter(game=>game.id!==id);return copy()},
    launchGame:async id=>{state.session={gameId:id,status:'running'};return copy()},windowControl:()=>{},...overrides};
  window.renewAPI=api;
  await import(`../src/app.js?test=${++serial}`);
  return {api,dialog,copy,emit:patch=>{Object.assign(state,patch);sessionHandler(copy())}};
}
afterEach(()=>{dom?.window.close();});
const click=selector=>{const node=document.querySelector(selector);assert.ok(node,`exists: ${selector}`);node.click();};
test('desktop starts with accessible controls and no fictional sample content', async()=>{
  await setup();
  assert.equal(document.querySelector('[data-focus="nav-library"]').getAttribute('aria-label'),'Library');
  assert.equal(document.querySelector('[data-focus="settings"]').getAttribute('aria-label'),'Settings');
  assert.equal(document.querySelector('[data-focus="system-GBA"]').getAttribute('aria-label'),'Game Boy Advance');
  assert.equal(document.querySelectorAll('.game-card').length,2);
  assert.ok(!document.body.textContent.includes('INTERACTIVE PREVIEW'));
  assert.ok(!document.body.textContent.includes('The Verdant Trail'));
});
test('search remains focused across rerender and clears without losing library data', async()=>{
  await setup(); const search=document.querySelector('#search');search.focus();search.value='blue';search.dispatchEvent(new window.Event('input'));
  assert.equal(document.querySelectorAll('.game-card').length,1);
  assert.equal(document.activeElement.id,'search');
  assert.equal(document.querySelector('.card-title').textContent,'Blue Moon');
  document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape'}));
  assert.equal(document.querySelectorAll('.game-card').length,2);
});
test('favorites and system filters compose, and empty-state recovery works',async()=>{
  await setup();click('[data-view="favorites"]');assert.equal(document.querySelectorAll('.game-card').length,1);
  click('[data-focus="filter-GB"]');assert.ok(document.querySelector('.empty-collection'));
  click('[data-action="reset-filters"]');assert.equal(document.querySelectorAll('.game-card').length,1);
  click('[data-view="library"]');assert.equal(document.querySelectorAll('.game-card').length,2);
});
test('details escape markup, save titles and require explicit removal confirmation',async()=>{
  await setup();click('[data-focus="details-a"]');
  const input=document.querySelector('#game-title');input.value='<img src=x onerror="alert(1)">';click('#save-title');await settle();
  assert.ok(document.querySelector('[data-focus="title-a"]').textContent.includes('<img'));
  assert.equal(document.querySelector('img[src="x"]'),null);
  click('[data-focus="details-a"]');click('#remove-game');click('[data-close]');
  assert.equal(document.querySelectorAll('.game-card').length,2);
  click('[data-focus="details-a"]');click('#remove-game');click('#confirm-remove');await settle();
  assert.equal(document.querySelectorAll('.game-card').length,1);
  assert.ok(!document.querySelector('[data-focus="details-a"]'));
});
test('late successful emulator choice cannot reopen a dismissed settings dialog',async()=>{
  const task=deferred();const context=await setup({chooseEmulator:()=>task.promise});
  click('[data-action="settings"]');click('#choose-emulator');click('[data-close]');
  assert.equal(context.dialog.open,false);
  task.resolve(context.copy());await settle();assert.equal(context.dialog.open,false);
});
test('late title save cannot close a newer dialog',async()=>{
  const task=deferred();const context=await setup({updateGame:()=>task.promise});
  click('[data-focus="details-a"]');click('#save-title');click('[data-close]');
  click('[data-action="settings"]');assert.ok(document.querySelector('#choose-emulator'));
  task.resolve(context.copy());await settle();
  assert.equal(context.dialog.open,true);assert.ok(document.querySelector('#choose-emulator'));
});
test('late failed emulator choice leaves dismissal intact and surfaces a toast',async()=>{
  const task=deferred();const context=await setup({chooseEmulator:()=>task.promise});
  click('[data-action="settings"]');click('#choose-emulator');click('[data-close]');task.reject(new Error('Test picker failed'));await settle();
  assert.equal(context.dialog.open,false);assert.match(document.querySelector('#toast').textContent,/Test picker failed/);
});
test('repeated launch clicks coalesce and session updates disable the play action',async()=>{
  const task=deferred();let calls=0;const context=await setup({launchGame:()=>{calls++;return task.promise}});
  click('[data-action="play"]');click('[data-action="play"]');assert.equal(calls,1);
  const state=context.copy();state.session={gameId:'a',status:'running'};task.resolve(state);await settle();
  assert.equal(document.querySelector('[data-action="play"]').disabled,true);
  context.emit({session:null});assert.equal(document.querySelector('[data-action="play"]').disabled,false);
});
test('settings update is persisted through the API and dialog Escape restores trigger focus',async()=>{
  await setup();const trigger=document.querySelector('[data-action="settings"]');trigger.focus();trigger.click();
  const field=document.querySelector('#fullscreen');field.checked=false;field.dispatchEvent(new window.Event('change'));await settle();
  document.querySelector('#dialog').dispatchEvent(new window.Event('cancel',{cancelable:true}));
  assert.equal(document.querySelector('#dialog').open,false);
  assert.equal(document.activeElement.dataset.focus,'settings');
  click('[data-action="settings"]');assert.equal(document.querySelector('#fullscreen').checked,false);
});
test('favorite toggle preserves an unsaved display-name draft',async()=>{
  await setup();click('[data-focus="details-a"]');
  document.querySelector('#game-title').value='My unsaved custom title';
  click('#detail-favorite');await settle();
  assert.equal(document.querySelector('#game-title').value,'My unsaved custom title');
  assert.equal(document.activeElement.id,'detail-favorite');
});
test('saving visibly locks the current form while leaving dismissal available',async()=>{
  const task=deferred();const context=await setup({updateGame:()=>task.promise});
  click('[data-focus="details-a"]');document.querySelector('#game-title').value='First';click('#save-title');
  assert.equal(document.querySelector('#game-title').disabled,true);
  assert.equal(document.querySelector('#save-title').disabled,true);
  assert.equal(document.querySelector('#detail-favorite').disabled,true);
  assert.equal(document.querySelector('[data-close]').disabled,false);
  assert.equal(context.dialog.getAttribute('aria-busy'),'true');
  task.resolve(context.copy());await settle();assert.equal(context.dialog.open,false);
});
test('a reopened settings dialog reconciles a late successful setting save',async()=>{
  const task=deferred();const context=await setup({updateSettings:()=>task.promise});
  click('[data-action="settings"]');const toggle=document.querySelector('#fullscreen');toggle.checked=false;toggle.dispatchEvent(new window.Event('change'));
  click('[data-close]');click('[data-action="settings"]');
  assert.equal(document.querySelector('#fullscreen').disabled,true);
  const result=context.copy();result.settings.fullscreen=false;task.resolve(result);await settle();
  assert.equal(document.querySelector('#fullscreen').checked,false);
  assert.equal(document.querySelector('#fullscreen').disabled,false);
});
test('a different details dialog reflects a pending mutation rather than dropping its Save silently',async()=>{
  const task=deferred();let calls=0;const context=await setup({updateGame:()=>{calls++;return task.promise}});
  click('[data-focus="details-a"]');click('#save-title');click('[data-close]');click('[data-focus="details-b"]');
  assert.equal(document.querySelector('#save-title').disabled,true);
  assert.equal(document.querySelector('#game-title').disabled,true);
  assert.equal(context.dialog.getAttribute('aria-busy'),'true');
  click('#save-title');assert.equal(calls,1);
  task.resolve(context.copy());await settle();
  assert.equal(document.querySelector('#save-title').disabled,false);
  assert.equal(document.querySelector('#dialog-title').textContent,'Blue Moon');
  assert.equal(context.dialog.open,true);
});
test('removing the originating card returns keyboard focus to Add games',async()=>{
  await setup();document.querySelector('[data-focus="details-a"]').focus();click('[data-focus="details-a"]');click('#remove-game');click('#confirm-remove');await settle();
  assert.equal(document.activeElement.dataset.focus,'import');
});
test('a failed title save preserves the draft and offers a retry in the same dialog',async()=>{
  let attempts=0;await setup({updateGame:async()=>{attempts++;throw new Error('Disk is full. Try again after freeing space.')}});
  click('[data-focus="details-a"]');document.querySelector('#game-title').value='Keep my draft';click('#save-title');await settle();
  assert.equal(document.querySelector('#dialog').open,true);
  assert.equal(document.querySelector('#game-title').value,'Keep my draft');
  assert.equal(document.querySelector('#save-title').disabled,false);
  assert.match(document.querySelector('[data-operation-error]').textContent,/Disk is full/);
  click('#save-title');await settle();assert.equal(attempts,2);
  assert.equal(document.querySelectorAll('[data-operation-error]').length,1);
  assert.equal(document.querySelector('#game-title').value,'Keep my draft');
});
test('reopening the same game during a successful rename reconciles its untouched input',async()=>{
  const task=deferred();const context=await setup({updateGame:()=>task.promise});
  click('[data-focus="details-a"]');document.querySelector('#game-title').value='Renamed Green World';click('#save-title');click('[data-close]');click('[data-focus="details-a"]');
  const result=context.copy();result.games[0].title='Renamed Green World';task.resolve(result);await settle();
  assert.equal(document.querySelector('#game-title').value,'Renamed Green World');
  assert.equal(document.querySelector('#dialog-title').textContent,'Renamed Green World');
});
test('a reopened details dialog reflects a late favorite response and toggles from current state',async()=>{
  const task=deferred();const calls=[];let result;
  const context=await setup({updateGame:async(id,patch)=>{calls.push(patch);if(calls.length===1)return task.promise;result.games.find(g=>g.id===id).favorite=patch.favorite;return structuredClone(result)}});
  click('[data-focus="details-b"]');click('#detail-favorite');click('[data-close]');click('[data-focus="details-b"]');
  result=context.copy();result.games[1].favorite=true;task.resolve(structuredClone(result));await settle();
  assert.match(document.querySelector('#detail-favorite').textContent,/Unfavorite/);
  click('#detail-favorite');await settle();
  assert.deepEqual(calls,[{favorite:true},{favorite:false}]);
  assert.match(document.querySelector('#detail-favorite').textContent,/Favorite/);
});
test('navigation collapse is named, keyboard-focusable and persists its presentation-only choice',async()=>{
  await setup();const toggle=document.querySelector('[data-action="toggle-menu"]');toggle.focus();
  assert.equal(toggle.getAttribute('aria-expanded'),'false');assert.ok(document.querySelector('#app').classList.contains('menu-collapsed'));
  toggle.click();
  assert.equal(document.querySelector('[data-action="toggle-menu"]').getAttribute('aria-expanded'),'true');
  assert.equal(document.activeElement.dataset.focus,'menu-toggle');
  assert.equal(window.localStorage.getItem('renew.view.sidebar.v1'),'expanded');
  click('[data-action="toggle-menu"]');assert.equal(window.localStorage.getItem('renew.view.sidebar.v1'),'collapsed');
  assert.equal(document.querySelector('[data-focus="nav-library"]').getAttribute('title'),'Library');
});
test('library row keeps its scroll position through selection rerenders',async()=>{
  await setup();document.querySelector('.game-grid').scrollLeft=240;click('[data-focus="select-b"]');
  assert.equal(document.querySelector('.game-grid').scrollLeft,240);
});
test('the decorative Enter hint is hidden from the Play button accessible name',async()=>{
  await setup();assert.equal(document.querySelector('.key-hint').getAttribute('aria-hidden'),'true');
});
