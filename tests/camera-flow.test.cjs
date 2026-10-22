const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
  .match(/<script>([\s\S]*?)<\/script>/)[1];
const turn = () => new Promise(resolve => setImmediate(resolve));

function processingContext() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { setAttribute() {}, hidden: true });
    return nodes.get(id);
  };
  const calls = [];
  const c = {
    originalImg: null, processedCanvas: null, bgBusy: false, pendingAutoProcess: false,
    loadToken: 0, zoom: { value: 100 }, quality: { value: 90 }, zoomVal: {}, qVal: {},
    statusEl: node('status'), document: { querySelector: node, getElementById: node },
    URL: { revokeObjectURL() {} }, queueMicrotask, setTimeout, clearTimeout, console,
    Image: class { set src(url) { this.url = url; queueMicrotask(() => this.onload()); } },
    setStatus(message) { calls.push(['status', message]); },
    recenter() { calls.push(['render', c.processedCanvas]); },
    fitFace() {}, findFace: async () => { calls.push(['face']); return null; },
    createWhiteBackgroundVersion: async image => { calls.push(['background', image.url]); return { image }; },
  };
  vm.createContext(c);
  for (const [start, end] of [
    ['function setBackgroundBusy', 'async function findFace'],
    ['async function autoProcess', 'async function applyBackgroundOnly'],
    ['function loadPhoto', "file.addEventListener('change'"],
  ]) vm.runInContext(script.slice(script.indexOf(start), script.indexOf(end)), c);
  return { c, calls };
}

test('camera photo starts background removal before face detection', async () => {
  const { c, calls } = processingContext();
  c.loadPhoto('blob:camera');
  await turn();
  assert.equal(c.processedCanvas.image.url, 'blob:camera');
  assert(calls.findIndex(x => x[0] === 'background') < calls.findIndex(x => x[0] === 'face'));
  assert.equal(c.bgBusy, false);
});

test('new captures during processing automatically process only the latest photo', async () => {
  const { c, calls } = processingContext();
  let finishOld;
  c.originalImg = { url: 'old' };
  c.createWhiteBackgroundVersion = image => {
    calls.push(['background', image.url]);
    if (image.url === 'old') return new Promise(resolve => { finishOld = resolve; });
    return Promise.resolve({ image });
  };
  const previous = c.autoProcess();
  c.loadPhoto('blob:camera-one');
  await turn();
  c.loadPhoto('blob:camera-two');
  await turn();
  assert.equal(c.pendingAutoProcess, true);
  finishOld({ image: { url: 'old' } });
  await previous;
  await turn();
  assert.deepEqual(calls.filter(x => x[0] === 'background').map(x => x[1]), ['old', 'blob:camera-two']);
  assert.equal(c.processedCanvas.image.url, 'blob:camera-two');
  assert.equal(c.bgBusy, false);
});

test('camera capture waits for a frame and preserves aspect ratio and mirroring', () => {
  let capture, loaded, stopped = false;
  const operations = [];
  const snap = {
    getContext: () => ({
      translate: (...args) => operations.push(['translate', ...args]),
      scale: (...args) => operations.push(['scale', ...args]),
      drawImage: () => operations.push(['draw']),
    }),
    toBlob(callback) { assert(stopped); callback({ type: 'image/jpeg' }); },
  };
  const c = {
    cameraStream: {}, cameraFacing: 'user',
    cameraView: { videoWidth: 4000, videoHeight: 3000, readyState: 0 },
    captureButton: { addEventListener: (name, callback) => { capture = callback; } },
    document: { createElement: () => snap },
    URL: { createObjectURL: () => 'blob:snapshot' },
    loadPhoto: url => { loaded = url; }, setStatus() {}, stopCamera: () => { stopped = true; },
  };
  vm.createContext(c);
  vm.runInContext(script.slice(script.indexOf("captureButton.addEventListener('click'"), script.indexOf("window.addEventListener('pagehide'")), c);
  capture();
  assert.equal(loaded, undefined);
  c.cameraView.readyState = 2;
  capture();
  assert.equal(snap.width, 1600);
  assert.equal(snap.height, 1200);
  assert.deepEqual(operations.slice(0, 2), [['translate', 1600, 0], ['scale', -1, 1]]);
  assert.equal(loaded, 'blob:snapshot');
});
