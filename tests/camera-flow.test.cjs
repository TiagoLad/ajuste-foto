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

test('touch devices use the native camera file picker and desktops keep live capture', () => {
  let opened = 0, stopped = 0, live = 0;
  const c = {
    navigator: { maxTouchPoints: 1 },
    window: { matchMedia: () => ({ matches: true }) },
    cameraFile: { value: 'previous', click() { opened++; } },
    stopCamera() { stopped++; }, startCamera() { live++; },
    openCameraButton: { addEventListener() {} },
  };
  vm.createContext(c);
  vm.runInContext(script.slice(script.indexOf('function useNativeCamera'), script.indexOf('const browserCameraButton')), c);
  c.openPhotoCamera();
  assert.equal(opened, 1);
  assert.equal(stopped, 1);
  assert.equal(c.cameraFile.value, '');
  c.navigator.maxTouchPoints = 0;
  c.openPhotoCamera();
  assert.equal(live, 1);
  assert.equal(opened, 1);
});

test('native camera files with missing MIME type enter the same image pipeline', () => {
  let selected, status;
  const c = {
    stopCamera() {},
    loadPhoto(url) { selected = url; },
    setStatus(message) { status = message; },
    URL: { createObjectURL: file => 'blob:' + file.name },
  };
  vm.createContext(c);
  vm.runInContext(script.slice(script.indexOf('function loadSelectedPhoto'), script.indexOf("file.addEventListener('change'")), c);
  c.loadSelectedPhoto({ files: [{ name: 'camera.jpg', type: '' }] });
  assert.equal(selected, 'blob:camera.jpg');
  selected = null;
  c.loadSelectedPhoto({ files: [{ name: 'bad.txt', type: 'text/plain' }] });
  assert.equal(selected, null);
  assert.match(status, /imagem/);
});

test('large native camera photos are resized before background inference', async () => {
  const { c, calls } = processingContext();
  let resized;
  c.Image = class {
    set src(url) {
      this.url = url;
      this.naturalWidth = url === 'blob:large' ? 2880 : 1280;
      this.naturalHeight = url === 'blob:large' ? 3600 : 1600;
      queueMicrotask(() => this.onload());
    }
  };
  c.URL.createObjectURL = () => 'blob:scaled';
  c.document.createElement = () => {
    resized = {
      getContext: () => ({ fillRect() {}, drawImage() {} }),
      toBlob(callback) { queueMicrotask(() => callback({ type: 'image/jpeg' })); },
    };
    return resized;
  };
  c.loadPhoto('blob:large');
  await turn();
  assert.equal(resized.width, 1280);
  assert.equal(resized.height, 1600);
  assert.equal(c.processedCanvas.image.url, 'blob:scaled');
  assert.deepEqual(calls.filter(x => x[0] === 'background').map(x => x[1]), ['blob:scaled']);
});
