'use strict';
const os = require('node:os');

// Intentionally narrow and read-only. No user, hostname, paths, environment,
// network, identifiers, brand detection, subprocesses or device controls.
function collectDeviceInfo({app, runtime = process, system = os} = {}) {
  const field = (source, read) => {
    try {
      const value = read();
      return {value: typeof value === 'string' && value.length > 0 && value.length <= 120 && !/[\u0000-\u001f\u007f]/.test(value) ? value : null, source,
        status: typeof value === 'string' && value.length > 0 && value.length <= 120 && !/[\u0000-\u001f\u007f]/.test(value) ? 'reported' : 'unavailable'};
    } catch { return {value: null, source, status: 'unavailable'}; }
  };
  return {
    version: 1,
    runtimePlatform: field('process.platform', () => runtime.platform),
    runtimeArchitecture: field('process.arch', () => runtime.arch),
    reportedSystemVersion: field('os.release()', () => system.release()),
    renewVersion: field('app.getVersion()', () => app.getVersion()),
    electronVersion: field('process.versions.electron', () => runtime.versions.electron),
  };
}
module.exports = {collectDeviceInfo};
