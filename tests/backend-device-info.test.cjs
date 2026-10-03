'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {collectDeviceInfo} = require('../desktop/device-info.cjs');
const fixture = () => ({app: {getVersion: () => '0.1.0'}, runtime: {platform: 'win32', arch: 'x64', versions: {electron: '44.5.1'}}, system: {release: () => '10.0.26100'}});

test('device collector returns only five bounded sourced runtime facts, never identifies hardware', () => {
  const input = fixture(); input.runtime.env = {SECRET: 'must not appear'}; input.system.hostname = () => {throw new Error('Never call');};
  const info = collectDeviceInfo(input);
  assert.deepEqual(Object.keys(info), ['version', 'runtimePlatform', 'runtimeArchitecture', 'reportedSystemVersion', 'renewVersion', 'electronVersion']);
  assert.equal(info.version, 1);
  assert.deepEqual(info.runtimePlatform, {value: 'win32', status: 'reported', source: 'process.platform'});
  assert.deepEqual(info.runtimeArchitecture, {value: 'x64', status: 'reported', source: 'process.arch'});
  assert.deepEqual(info.reportedSystemVersion, {value: '10.0.26100', status: 'reported', source: 'os.release()'});
  assert.deepEqual(info.renewVersion, {value: '0.1.0', status: 'reported', source: 'app.getVersion()'});
  assert.deepEqual(info.electronVersion, {value: '44.5.1', status: 'reported', source: 'process.versions.electron'});
  assert.doesNotMatch(JSON.stringify(info), /must not appear|hostname|serial|hardware|model|Windows|Steam|Deck|ROG/);
});

test('device collector keeps unknown platform and architecture literal instead of guessing a brand or host', () => {
  const input = fixture(); input.runtime.platform = 'future-os'; input.runtime.arch = 'mystery';
  const info = collectDeviceInfo(input);
  assert.equal(info.runtimePlatform.value, 'future-os'); assert.equal(info.runtimeArchitecture.value, 'mystery');
});

test('device collector reports unavailable for invalid, oversized and failed fields without leaking errors', () => {
  for (const value of [null, undefined, {}, 1, '', 'x'.repeat(121), 'version\nsecret', '\u0000']) {
    const input = fixture(); input.runtime.platform = value; input.runtime.arch = value;
    input.system.release = () => value; input.app.getVersion = () => value; input.runtime.versions.electron = value;
    const info = collectDeviceInfo(input);
    for (const field of Object.values(info).filter(item => typeof item === 'object')) { assert.equal(field.value, null); assert.equal(field.status, 'unavailable'); }
  }
  const input = fixture(); input.app.getVersion = () => { throw new Error('C:/Users/private-user/secret'); };
  input.system.release = () => { throw new Error('secret environment'); };
  delete input.runtime.versions;
  const info = collectDeviceInfo(input);
  assert.equal(info.runtimePlatform.status, 'reported'); assert.equal(info.electronVersion.status, 'unavailable');
  assert.doesNotMatch(JSON.stringify(info), /private-user|secret/);
});

test('device reads are fresh and cannot mutate earlier snapshots or collector input', () => {
  const input = fixture(); const first = collectDeviceInfo(input); first.runtimePlatform.value = 'changed';
  input.system.release = () => 'new-release'; const second = collectDeviceInfo(input);
  assert.equal(second.runtimePlatform.value, 'win32'); assert.equal(second.reportedSystemVersion.value, 'new-release');
  assert.equal(first.reportedSystemVersion.value, '10.0.26100');
});
