'use strict';
const { fileURLToPath } = require('node:url');

// Chromium and Node may serialize the same file path differently (for example
// Windows short paths containing ~ versus %7E). Compare the decoded path of the
// one fixed document, never a suffix, scheme alone, case-folded URL or directory.
function isTrustedFileURL(value, entryPath, platform = process.platform) {
  if (typeof value !== 'string' || !value.startsWith('file:///')) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'file:' || url.hostname || url.username || url.password ||
        url.search || url.hash || url.href.includes('?') || url.href.includes('#')) return false;
    return fileURLToPath(url, { windows: platform === 'win32' }) === entryPath;
  } catch { return false; }
}
module.exports = { isTrustedFileURL };
