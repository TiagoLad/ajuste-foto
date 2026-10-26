const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const script = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function context() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { dataset: {}, removeAttribute() {}, focus() {} });
    return nodes.get(id);
  };
  const c = {
    document: { body: { dataset: {} }, querySelector: node, getElementById: node, querySelectorAll: () => [] },
    originalImg: null, processedCanvas: null, previewReady: false, bgBusy: false,
    loadToken: 1, renderToken: 2, pendingAutoProcess: true, backgroundCache: new WeakMap(),
    scale: 2, minScale: 1, dx: 10, dy: 20, drag: {}, comparingEnhancement: true,
    file: node('file'), zoom: node('zoom'), quality: node('quality'), zoomVal: {}, qVal: {},
    enhance: node('enhance'), enhanceStrength: node('enhanceStrength'), preview: node('preview'), details: {},
    stopCamera() {}, updateEnhancementControls() {}, paint() {}, setStatus() {},
    URL: { revokeObjectURL(url) { c.revoked = url; } },
  };
  vm.createContext(c);
  vm.runInContext(script.slice(script.indexOf('function syncPhotoUi'), script.indexOf('function setBackgroundBusy')), c);
  return c;
}

test('download requires a photo and a completed preview outside processing', () => {
  const c = context();
  for (const [photo, previewReady, bgBusy, state, disabled] of [
    [null, false, false, 'empty', true],
    [{}, false, false, 'editing', true],
    [{}, true, true, 'processing', true],
    [{}, true, false, 'ready', false],
  ]) {
    Object.assign(c, { originalImg: photo, previewReady, bgBusy });
    c.syncPhotoUi();
    assert.equal(c.document.body.dataset.photoState, state);
    assert.equal(c.document.querySelector('#download').disabled, disabled);
  }
});

test('new image clears the previous photo, revokes its preview and invalidates pending renders', () => {
  const c = context();
  c.originalImg = {}; c.previewReady = true; c.preview.dataset.url = 'blob:previous';
  c.resetPhoto();
  assert.equal(c.originalImg, null);
  assert.equal(c.revoked, 'blob:previous');
  assert.equal(c.renderToken, 3);
  assert.equal(c.loadToken, 2);
  assert.equal(c.pendingAutoProcess, false);
  assert.equal(c.document.body.dataset.photoState, 'empty');
  assert.equal(c.document.querySelector('#download').disabled, true);
  assert.equal(c.zoom.disabled, true);
  assert.equal(c.enhance.checked, false);
});

test('new image preserves a photo while processing is active', () => {
  const c = context();
  const photo = c.originalImg = {};
  c.bgBusy = true;
  c.resetPhoto();
  assert.equal(c.originalImg, photo);
  assert.equal(c.renderToken, 2);
});

test('direction controls update crop coordinates and render, respecting processing lock', () => {
  const c = { dx: -50, dy: -50, bgBusy: false, currentSource: () => ({}), constrain() {}, paint() {}, schedule() { c.renders++; }, renders: 0 };
  vm.createContext(c);
  vm.runInContext(script.slice(script.indexOf('function movePhoto'), script.indexOf("for(const button of document.querySelectorAll('[data-move]'))button.addEventListener")), c);
  c.movePhoto('right', 10); c.movePhoto('up', 20);
  assert.equal(c.dx, -40); assert.equal(c.dy, -70); assert.equal(c.renders, 2);
  c.bgBusy = true; c.movePhoto('left', 10);
  assert.equal(c.dx, -40); assert.equal(c.renders, 2);
});
