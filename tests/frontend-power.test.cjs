const {test, afterEach} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
let dom, serial=0;
const enabled = {version:1,enabled:true,commandPalette:true};
const fixtureGames = () => Array.from({length:10},(_,i)=>({id:`g${i}`,title:`Game ${i}`,system:i%2?'GB':'GBA',favorite:false,playSeconds:0,lastPlayed:null,art:['aurora','ocean','ember','violet'][i%4]}));
const fixtureInfo = () => ({version:1,runtimePlatform:{value:'win32',status:'reported',source:'process.platform'},runtimeArchitecture:{value:'x64',status:'reported',source:'process.arch'},reportedSystemVersion:{value:'10.0.26100',status:'reported',source:'os.release()'},renewVersion:{value:'0.1.0',status:'reported',source:'app.getVersion()'},electronVersion:{value:'44.5.1',status:'reported',source:'process.versions.electron'}});
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
async function setup(options={}) {
  dom?.window.close(); dom=new JSDOM('<body><div id="app"></div><div id="announcer"></div><dialog id="dialog"></dialog><div id="toast" hidden></div>',{url:'http://localhost/',pretendToBeVisual:true});
  global.window=dom.window;global.document=dom.window.document;global.CSS={escape:value=>String(value).replace(/[^a-zA-Z0-9_-]/g,c=>`\\${c}`)};
  const dialog=document.querySelector('#dialog');dialog.showModal=function(){this.setAttribute('open','');};dialog.close=function(){this.removeAttribute('open');};
  if(options.power!==undefined)window.localStorage.setItem('renew.power.v1',typeof options.power==='string'?options.power:JSON.stringify(options.power));
  window.localStorage.setItem('renew.view.sidebar.v1','expanded');
  if(options.blockStorage)Object.defineProperty(window,'localStorage',{get(){throw new Error('Denied');}});
  const state={games:structuredClone(options.games??fixtureGames()),session:options.session??null,settings:{emulatorPath:'C:\\mGBA.exe',fullscreen:true,returnToLauncher:true}};
  const copy=()=>structuredClone(state);const calls=[];let handler;
  const context={state,copy,calls,emit:patch=>{Object.assign(state,patch);handler(copy());}};
  const methods={getState:async()=>copy(),getDeviceInfo:async()=>fixtureInfo(),launchGame:async id=>{state.session={gameId:id,status:'launching'};return copy();},importGames:async()=>copy(),chooseEmulator:async()=>copy(),updateSettings:async patch=>{Object.assign(state.settings,patch);return copy();},updateGame:async(id,patch)=>{Object.assign(state.games.find(g=>g.id===id),patch);return copy();},windowControl:()=>{}};
  window.renewAPI={preview:Boolean(options.preview),onSession:fn=>{handler=fn;return()=>{};},...Object.fromEntries(Object.entries(methods).map(([name,method])=>[name,(...args)=>{calls.push({name,args});return options.methods?.[name]?options.methods[name](context,...args):method(...args);}]))};
  await import(`../src/app.js?power=${++serial}`);return context;
}
afterEach(()=>dom?.window.close());
const node=selector=>{const element=document.querySelector(selector);assert.ok(element,selector);return element;};
const click=selector=>node(selector).click();
const key=(value,options={},target=document.activeElement)=>target.dispatchEvent(new window.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true,...options}));
const shortcut=options=>key('k',{ctrlKey:true,...options});
const close=()=>node('#dialog').dispatchEvent(new window.Event('cancel',{cancelable:true}));
const calls=(context,name)=>context.calls.filter(call=>call.name===name);
const input=value=>{const search=node('#palette-search');search.focus();search.value=value;search.dispatchEvent(new window.Event('input',{bubbles:true}));};
const change=(selector,value)=>{const control=node(selector);control.checked=value;control.dispatchEvent(new window.Event('change',{bubbles:true}));};
const settings=()=>{click('[data-focus="settings"]');click('#settings-tab-power');};
const open=()=>{node('[data-focus="palette"]').focus();click('[data-focus="palette"]');};

test('Power user starts entirely off without native device reads, palette markup or shortcut interception',async()=>{
  const context=await setup();assert.equal(document.querySelector('[data-action="palette"]'),null);assert.equal(shortcut(),true);assert.equal(node('#dialog').open,false);
  settings();assert.equal(node('#power-enabled').checked,false);assert.equal(node('#power-palette').checked,false);assert.equal(node('#power-palette').disabled,true);assert.equal(node('#read-device').disabled,true);
  assert.equal(calls(context,'getDeviceInfo').length,0);assert.equal(calls(context,'updateSettings').length,0);
});

test('Power user master remembers its inactive subchoice and reset preserves library, settings and sidebar',async()=>{
  const context=await setup();const initial=context.copy();settings();change('#power-enabled',true);assert.equal(node('#power-palette').checked,false);
  change('#power-palette',true);assert.ok(document.querySelector('[data-action="palette"]'));
  change('#power-enabled',false);assert.equal(node('#power-palette').checked,true);assert.equal(node('#power-palette').disabled,true);assert.equal(document.querySelector('[data-action="palette"]'),null);
  assert.deepEqual(JSON.parse(window.localStorage.getItem('renew.power.v1')),{version:1,enabled:false,commandPalette:true});
  change('#power-enabled',true);assert.ok(document.querySelector('[data-action="palette"]'));click('#reset-power');
  assert.equal(node('#power-enabled').checked,false);assert.equal(node('#power-palette').checked,false);assert.equal(window.localStorage.getItem('renew.power.v1'),null);
  assert.equal(window.localStorage.getItem('renew.view.sidebar.v1'),'expanded');assert.deepEqual(context.copy(),initial);assert.equal(calls(context,'updateSettings').length,0);
});

test('saved opt-in reloads; malformed or unsupported preferences fail closed; storage errors are session-only notices',async()=>{
  await setup({power:enabled});assert.ok(document.querySelector('[data-action="palette"]'));
  for(const power of ['broken','{"version":9,"enabled":true,"commandPalette":true}','{"version":1,"enabled":"true","commandPalette":true}']){await setup({power});assert.equal(document.querySelector('[data-action="palette"]'),null);}
  await setup({blockStorage:true});settings();change('#power-enabled',true);change('#power-palette',true);assert.ok(document.querySelector('[data-action="palette"]'));assert.match(node('#toast').textContent,/session.*could not save/i);
  click('#reset-power');assert.match(node('#toast').textContent,/reset for this session/);assert.equal(document.querySelector('[data-action="palette"]'),null);
});

test('Ctrl+K respects editing, existing dialogs, modifiers, IME and repeat; enabled plain shortcut focuses search',async()=>{
  await setup({power:enabled});
  for(const options of [{repeat:true},{isComposing:true},{altKey:true},{metaKey:true},{shiftKey:true}]){shortcut(options);assert.equal(node('#dialog').open,false);}
  node('#search').focus();shortcut();assert.equal(node('#dialog').open,false);
  node('[data-focus="settings"]').focus();click('[data-focus="settings"]');shortcut();assert.equal(node('#dialog').className,'console-settings');close();
  node('[data-focus="palette"]').focus();assert.equal(shortcut(),false);assert.equal(node('#dialog').className,'command-palette');assert.equal(document.activeElement.id,'palette-search');
  shortcut();assert.equal(node('#dialog').className,'command-palette');close();assert.equal(document.activeElement.dataset.focus,'palette');
});

test('palette search is bounded and escaped, arrow navigation is native-button based, Enter navigates without launch',async()=>{
  const context=await setup({power:enabled,games:[...fixtureGames(),{...fixtureGames()[0],id:'unsafe',title:'<img src=x onerror=bad>'}]});open();
  assert.equal(document.querySelectorAll('[data-power-command]').length,12);input('img');assert.equal(node('.palette-command').textContent.includes('<img'),true);assert.equal(node('#palette-results').querySelector('img'),null);
  input('Go to Home');key('ArrowDown');assert.equal(document.activeElement.dataset.powerCommand,'home');key('Enter');assert.equal(node('#dialog').open,false);assert.equal(document.activeElement.id,'collection-title');assert.equal(calls(context,'launchGame').length,0);
  open();input('not a real command');key('Enter');assert.equal(node('#dialog').open,true);assert.match(node('#palette-results').textContent,/No matching commands/);
});

test('palette consumes repeat and IME Enter without activating or leaking into the body launch shortcut',async()=>{
  const context=await setup({power:enabled});open();input('Play Game 9');
  key('Enter',{repeat:true});key('Enter',{isComposing:true});key('Enter',{ctrlKey:true});assert.equal(calls(context,'launchGame').length,0);assert.equal(node('#dialog').open,true);
  input('Open Library');key('Enter');assert.equal(node('#dialog').open,false);assert.equal(calls(context,'launchGame').length,0);assert.equal(document.activeElement.id,'collection-title');key('Enter');assert.equal(calls(context,'launchGame').length,0);
});

test('Pick unplayed chooses beyond the Home cap, clears filters and selects a visible Library card without launching',async()=>{
  const context=await setup({power:enabled});click('[data-focus="filter-GB"]');
  const random=Math.random;Math.random=()=>.99999;
  try{open();input('Pick an unplayed');key('Enter');}finally{Math.random=random;}
  assert.equal(node('h1').textContent,'Library');assert.equal(node('#hero-title').textContent,'Game 9');assert.equal(document.activeElement.dataset.focus,'select-g9');
  assert.equal(document.querySelectorAll('.game-card').length,10);assert.equal(node('[data-focus="filter-all"]').getAttribute('aria-pressed'),'true');assert.equal(calls(context,'launchGame').length,0);
});

test('palette game Play can find a result beyond the initial cap and shares the actual pending/session guard',async()=>{
  const pending=deferred();const context=await setup({power:enabled,methods:{launchGame:()=>pending.promise}});open();input('Play Game 9');key('Enter');
  assert.equal(calls(context,'launchGame').length,1);assert.equal(calls(context,'launchGame')[0].args[0],'g9');assert.equal(node('#hero-title').textContent,'Game 9');
  open();input('Play Game 1');assert.equal(node('[data-power-command="play:g1"]').disabled,true);key('Enter');assert.equal(calls(context,'launchGame').length,1);
  context.emit({session:{gameId:'g9',status:'launching'}});pending.resolve(context.copy());await settle();assert.equal(node('[data-power-command="play:g1"]').disabled,true);
  for(const status of ['running','paused']){context.emit({session:{gameId:'g9',status}});assert.equal(node('[data-power-command="play:g1"]').disabled,true);key('Enter');}
  assert.equal(calls(context,'launchGame').length,1);context.emit({session:null});assert.equal(node('[data-power-command="play:g1"]').disabled,false);
});

test('palette refresh removes stale games and focuses search when an active command disappears',async()=>{
  const context=await setup({power:enabled});open();input('Play Game 9');key('ArrowDown');assert.equal(document.activeElement.dataset.powerCommand,'play:g9');
  context.emit({games:context.state.games.filter(g=>g.id!=='g9')});assert.equal(document.querySelector('[data-power-command="play:g9"]'),null);assert.equal(document.activeElement.id,'palette-search');key('Enter');assert.equal(calls(context,'launchGame').length,0);
});

test('a failed palette launch uses the existing error dialog and does not fabricate history',async()=>{
  const context=await setup({power:enabled,methods:{launchGame:async()=>{throw new Error('Choose mGBA first.');}}});open();input('Play Game 8');key('Enter');await settle();
  assert.match(node('#dialog').textContent,/Choose mGBA first/);assert.equal(node('#dialog').className,'');assert.equal(context.state.games[8].playSeconds,0);assert.equal(context.state.games[8].lastPlayed,null);
  close();assert.equal(document.activeElement.dataset.focus,'hero-play');assert.equal(calls(context,'launchGame').length,1);
});

test('palette Add games shares the picker path; pending import blocks another picker and Play',async()=>{
  const pending=deferred();const context=await setup({power:enabled,methods:{importGames:()=>pending.promise}});open();input('Add games');key('Enter');assert.equal(calls(context,'importGames').length,1);
  open();input('Add games');assert.equal(node('[data-power-command="import"]').disabled,true);key('Enter');assert.equal(calls(context,'importGames').length,1);
  input('Play');assert.ok([...document.querySelectorAll('[data-power-command]')].filter(b=>b.dataset.powerCommand.startsWith('play:')).every(b=>b.disabled));
  pending.resolve(context.copy());await settle();assert.ok([...document.querySelectorAll('[data-power-command]')].some(b=>!b.disabled));
});

test('This device reads only on demand, renders sourced runtime facts and labels unknown hardware honestly',async()=>{
  const context=await setup({power:enabled});settings();assert.equal(calls(context,'getDeviceInfo').length,0);click('#read-device');await settle();
  assert.equal(calls(context,'getDeviceInfo').length,1);assert.deepEqual(calls(context,'getDeviceInfo')[0].args,[]);
  assert.match(node('#device-info').textContent,/Runtime platform.*win32/s);assert.match(node('#device-info').textContent,/Source: process.platform/);assert.match(node('#device-info').textContent,/Not identified/);assert.match(node('#device-info').textContent,/Wine/);
  close();settings();assert.match(node('#device-info').textContent,/No information has been read/);assert.equal(calls(context,'getDeviceInfo').length,1);
});

test('This device command opens the actual settings panel and runs exactly one demand read',async()=>{
  const context=await setup({power:enabled});open();input('This device');key('Enter');await settle();assert.equal(node('#settings-panel-power').hidden,false);assert.equal(calls(context,'getDeviceInfo').length,1);assert.match(node('#device-info').textContent,/44.5.1/);
});

test('preview information is explicitly unavailable and never calls a supplied native information method',async()=>{
  const context=await setup({power:enabled,preview:true});settings();click('#read-device');await settle();assert.match(node('#device-info').textContent,/Unavailable in the visual preview/);assert.equal(calls(context,'getDeviceInfo').length,0);assert.equal(node('#read-device').disabled,false);
});

test('device pending read coalesces clicks and a dismissed response cannot touch a newer dialog',async()=>{
  const pending=deferred();const context=await setup({power:enabled,methods:{getDeviceInfo:()=>pending.promise}});settings();click('#read-device');click('#read-device');assert.equal(calls(context,'getDeviceInfo').length,1);assert.equal(node('#read-device').disabled,true);
  close();click('[aria-label="Edit selected game details"]');const content=node('#dialog').innerHTML;pending.resolve(fixtureInfo());await settle();assert.equal(node('#dialog').innerHTML,content);
});

test('device tab switching discards pending results and allows a new read without stale overwrites',async()=>{
  const first=deferred(),second=deferred();let count=0;
  await setup({power:enabled,methods:{getDeviceInfo:()=>++count===1?first.promise:second.promise}});settings();click('#read-device');click('#settings-tab-launch');click('#settings-tab-power');assert.equal(node('#read-device').disabled,false);click('#read-device');
  second.resolve({...fixtureInfo(),renewVersion:{value:'new-result',status:'reported'}});await settle();first.resolve(fixtureInfo());await settle();assert.match(node('#device-info').textContent,/new-result/);assert.doesNotMatch(node('#device-info').textContent,/0.1.0/);
});

test('master off and reset clear device facts and invalidate pending reads',async()=>{
  for(const reset of [false,true]){const pending=deferred();await setup({power:enabled,methods:{getDeviceInfo:()=>pending.promise}});settings();click('#read-device');if(reset)click('#reset-power');else change('#power-enabled',false);pending.resolve(fixtureInfo());await settle();assert.match(node('#device-info').textContent,/No information has been read/);assert.equal(node('#read-device').disabled,true);assert.equal(document.querySelector('[data-action="palette"]'),null);}
});

test('device failures are recoverable and do not expose raw error details',async()=>{
  let count=0;await setup({power:enabled,methods:{getDeviceInfo:async()=>{if(++count===1)throw new Error('C:/Users/private/secret');return fixtureInfo();}}});settings();click('#read-device');await settle();assert.match(node('#device-info').textContent,/unavailable/);assert.doesNotMatch(node('#device-info').textContent,/private|secret/);assert.equal(node('#read-device').disabled,false);click('#read-device');await settle();assert.match(node('#device-info').textContent,/win32/);
});
