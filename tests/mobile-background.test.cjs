const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
  .match(/<script>([\s\S]*?)<\/script>/)[1];

function setup(responses = ['done']) {
  const workers = [], revoked = [];
  const c = {
    navigator: {}, useNativeCamera: () => true,
    window: { addEventListener() {} },
    backgroundCache: new WeakMap(),
    Blob: class {},
    URL: { createObjectURL: () => 'blob:worker-' + workers.length, revokeObjectURL: url => revoked.push(url) },
    Uint8ClampedArray, ImageData: class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } },
    setTimeout, clearTimeout,
    loadBgApi: () => { throw new Error('Mobile must not load BiRefNet'); },
    document: {
      createElement() {
        const ctx = { drawImage() {}, putImageData() {}, fillRect() {},
          getImageData: () => ({ data: new Uint8ClampedArray(16) }) };
        return { getContext: () => ctx };
      },
    },
    Worker: class {
      constructor() { this.listeners = {}; workers.push(this); }
      addEventListener(name, callback) { this.listeners[name] = callback; }
      removeEventListener(name) { delete this.listeners[name]; }
      terminate() { this.terminated = true; }
      postMessage(request) {
        const kind = responses.shift() || 'done';
        queueMicrotask(() => this.listeners.message({ data: kind === 'error'
          ? { id: request.id, kind, message: 'Aborted(). Build with -sASSERTIONS for more info.' }
          : { id: request.id, kind, width: 2, height: 2, pixels: new Uint8ClampedArray(16).buffer } }));
      }
    },
  };
  vm.createContext(c);
  vm.runInContext(script.slice(script.indexOf('function shouldUseLightweightBackground'), script.indexOf('async function autoProcess')), c);
  return { c, workers, revoked };
}

test('touch devices and low-memory computers select the lightweight model', () => {
  const { c } = setup();
  assert(c.shouldUseLightweightBackground());
  c.useNativeCamera = () => false;
  c.navigator.deviceMemory = 4;
  assert(c.shouldUseLightweightBackground());
  c.navigator.deviceMemory = 8;
  assert.equal(c.shouldUseLightweightBackground(), false);
});

test('mobile processing skips BiRefNet and reuses the completed result', async () => {
  const { c, workers } = setup();
  const image = { naturalWidth: 2, naturalHeight: 2 };
  const first = await c.createWhiteBackgroundVersion(image);
  assert.equal(await c.createWhiteBackgroundVersion(image), first);
  assert.equal(workers.length, 1);
  const ctx = first.getContext('2d');
  assert.equal(ctx.fillStyle, '#ffffff');
  assert.equal(ctx.globalCompositeOperation, 'source-over');
});

test('WASM abort destroys the worker and the next attempt starts fresh', async () => {
  const { c, workers, revoked } = setup(['error', 'done']);
  const image = { naturalWidth: 2, naturalHeight: 2 };
  await assert.rejects(() => c.createWhiteBackgroundVersion(image), /sem memória/);
  assert.equal(workers[0].terminated, true);
  assert.equal(revoked.length, 1);
  const result = await c.createWhiteBackgroundVersion(image);
  assert(result);
  assert.equal(workers.length, 2);
});
