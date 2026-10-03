'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const {isTrustedFileURL} = require('../desktop/trusted-file-url.cjs');

for (const platform of ['win32','linux']) {
  const root = platform === 'win32' ? 'C:\\Users\\RUNNER~1\\app\\resources\\app.asar\\' : '/home/test~user/app/resources/app.asar/';
  const separator = platform === 'win32' ? '\\' : '/';
  for (const segment of ['src','space name','hash#name','percent%name','unicodé日本']) {
    test(`trusted document accepts equivalent percent encoding: ${platform} ${segment}`,()=>{
      const entry = `${root}${segment}${separator}index.html`;
      const encoded = pathToFileURL(entry,{windows:platform==='win32'}).href;
      assert.equal(isTrustedFileURL(encoded,entry,platform),true);
      assert.equal(isTrustedFileURL(encoded.replace(/%7E/gi,'~'),entry,platform),true);
      assert.equal(isTrustedFileURL(encoded.replace('~','%7E'),entry,platform),true);
      assert.equal(isTrustedFileURL(encoded+'#section',entry,platform),false);
      assert.equal(isTrustedFileURL(encoded+'?preview=1',entry,platform),false);
      assert.equal(isTrustedFileURL(encoded+'?',entry,platform),false);
      assert.equal(isTrustedFileURL(encoded.replace('index.html','other.html'),entry,platform),false);
      assert.equal(isTrustedFileURL(encoded.replace('index.html','index.html.evil'),entry,platform),false);
    });
  }
}
test('trusted file comparison rejects malformed, non-file and foreign authority URLs',()=>{
  const entry='C:\\Users\\RUNNER~1\\app\\resources\\app.asar\\src\\index.html';
  for(const url of [null,undefined,{},'', 'not a URL','https://example.test/index.html','data:text/html,hello',
    'file://server/share/index.html','file://localhost/C:/Users/RUNNER~1/app/resources/app.asar/src/index.html',
    'file:///C:/Users/RUNNER~1/app/resources/app.asar/src%2Findex.html',
    'file:///C:/Users/RUNNER~1/app/resources/app.asar/src%5Cindex.html',
    'file:///C:/Users/RUNNER~1/app/resources/app.asar/src/%ZZindex.html',
    'file:///C:/Users/OTHER/app/resources/app.asar/src/index.html',
    'file:///c:/Users/RUNNER~1/app/resources/app.asar/src/index.html']){
    assert.equal(isTrustedFileURL(url,entry,'win32'),false,String(url));
  }
});
