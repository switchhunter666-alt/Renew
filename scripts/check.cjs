const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
let failed = false;
for (const directory of ['src', 'desktop', 'scripts', 'tests']) {
  for (const file of fs.readdirSync(directory).filter(name => /\.(?:c?js)$/.test(name))) {
    const result = spawnSync(process.execPath, ['--check', path.join(directory, file)], { encoding: 'utf8' });
    if (result.status !== 0) { failed = true; console.error(result.stderr); }
  }
}
if (failed) process.exitCode = 1;
else console.log('JavaScript syntax checks passed.');
