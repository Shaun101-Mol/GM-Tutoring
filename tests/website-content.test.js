const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('website should not contain demo wording', () => {
  const normalized = `${appJs}\n${indexHtml}`.toLowerCase();
  assert.doesNotMatch(normalized, /demo/);
});

test('admin layout should expose a logout option', () => {
  assert.match(indexHtml, /data-action="logout"/i);
});

