const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const asset of ['app.js', 'styles.css', 'logo.svg', 'favicon.svg', 'favicon.ico', 'apple-touch-icon.png']) {
  test(`${asset} uses its current content hash as the cache version`, () => {
    const expected = createHash('sha256').update(fs.readFileSync(path.join(root, asset))).digest('hex').slice(0, 12);
    assert(html.includes(`="${asset}?v=${expected}"`), 'Run atualizar-versoes.ps1 before publishing');
  });
}
