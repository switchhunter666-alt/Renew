const { test } = require('node:test');
const assert = require('node:assert/strict');
const model = import('../src/model.js');
test('all user-originated HTML text and attributes are escaped', async () => {
  const {escapeHTML} = await model;
  assert.equal(escapeHTML('<img src=x onerror="bad"> & \'x\''), '&lt;img src=x onerror=&quot;bad&quot;&gt; &amp; &#39;x&#39;');
});
test('recent sort understands desktop ISO dates and preview numeric dates', async () => {
  const {selectGames} = await model;
  const games = [{id:'old',title:'Alpha',addedAt:'2025-01-01T00:00:00.000Z'}, {id:'new',title:'Zulu',addedAt:'2026-10-02T00:00:00.000Z'}];
  assert.deepEqual(selectGames(games).map(game => game.id), ['new','old']);
  assert.equal(selectGames([{...games[0],addedAt:100}, {...games[1],addedAt:200}])[0].id,'new');
  assert.deepEqual(games.map(game => game.id), ['old','new']);
});
test('search, system and favorite filters compose without mutating input', async () => {
  const {selectGames} = await model;
  const games = [{id:'a',title:'Green World',system:'GBA',favorite:true}, {id:'b',title:'Green Moon',system:'GB',favorite:true}, {id:'c',title:'Other',system:'GBA',favorite:false}];
  assert.deepEqual(selectGames(games,{query:' GREEN ',system:'GBA',view:'favorites'}).map(g=>g.id), ['a']);
  assert.equal(games.length,3);
  assert.deepEqual(selectGames(games,{query:'nothing'}),[]);
});
test('time formatting is accurate at boundaries and never fabricates play time', async () => {
  const {formatTime}=await model;
  assert.equal(formatTime(0),'Not played yet');
  assert.equal(formatTime(1),'Less than a minute');
  assert.equal(formatTime(59),'Less than a minute');
  assert.equal(formatTime(60),'1 min played');
  assert.equal(formatTime(3660),'1h 1m played');
  assert.equal(formatTime(NaN),'Not played yet');
});
test('original art selection is deterministic and bounded', async () => {
  const {artForId}=await model;
  assert.equal(artForId('same'),artForId('same'));
  assert.ok(['aurora','ember','ocean','violet'].includes(artForId('../../other')));
});
