const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const script = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
new vm.Script(script);
const context = { Uint8ClampedArray, Float32Array };
vm.createContext(context);
vm.runInContext(script.slice(script.indexOf('function enhancePhotoPixels'), script.indexOf('function updateEnhancementControls')), context);

test('zero strength is reversible and never mutates source pixels', () => {
  const source = new Uint8ClampedArray([50, 80, 100, 255, 255, 255, 255, 255]);
  const copy = source.slice();
  assert.deepEqual(context.enhancePhotoPixels(source, 2, 1, 0), copy);
  context.enhancePhotoPixels(source, 2, 1, 100);
  assert.deepEqual(source, copy);
});

test('pure white background and transparent pixels remain unchanged', () => {
  const source = new Uint8ClampedArray([255, 255, 255, 255, 70, 50, 40, 0]);
  assert.deepEqual(context.enhancePhotoPixels(source, 2, 1, 100), source);
});

test('shadow correction lifts a dark portrait without changing opacity', () => {
  const source = new Uint8ClampedArray([80, 80, 80, 255]);
  const result = context.enhancePhotoPixels(source, 1, 1, 100);
  assert(result[0] > 80 && result[0] < 100);
  assert.equal(result[3], 255);
});

test('image boundaries and strong edges produce valid bounded values', () => {
  const source = new Uint8ClampedArray([
    20, 20, 20, 255, 20, 20, 20, 255, 20, 20, 20, 255,
    20, 20, 20, 255, 200, 180, 170, 255, 255, 255, 255, 255,
    20, 20, 20, 255, 20, 20, 20, 255, 20, 20, 20, 255,
  ]);
  const result = context.enhancePhotoPixels(source, 3, 3, 100);
  assert.equal(result.length, source.length);
  assert.deepEqual(Array.from(result.slice(20, 24)), [255, 255, 255, 255]);
  for (let i = 3; i < result.length; i += 4) assert.equal(result[i], 255);
});

test('comparison view never exports the unenhanced preview', async () => {
  const operations = [];
  const c = {
    comparingEnhancement: true,
    paint(exporting = false) { operations.push(exporting ? 'enhanced' : 'comparison'); },
    canvas: { toBlob(callback, mime) { operations.push(mime); callback('jpg'); } },
  };
  vm.createContext(c);
  vm.runInContext(script.slice(script.indexOf('function blobJpeg'), script.indexOf('async function exportBlob')), c);
  assert.equal(await c.blobJpeg(.9), 'jpg');
  assert.deepEqual(operations, ['enhanced', 'image/jpeg', 'comparison']);
});
