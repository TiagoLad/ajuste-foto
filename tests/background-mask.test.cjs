const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const context = {};
vm.createContext(context);
vm.runInContext(script.slice(
  script.indexOf('function getBackgroundMaskTensor'),
  script.indexOf('async function createWhiteBackgroundVersion'),
), context);

function prediction(values, type = 'float32') {
  return { output_image: { type, dims: [1, 1, 2, 2], data: values } };
}

test('accepts the actual ONNX output name and confident portrait mask', () => {
  const result = prediction([-12, -8, 10, 19]);
  assert.equal(context.validateBackgroundPrediction(result), result.output_image);
});

test('rejects the washed-out GPU output reproduced with a real portrait', () => {
  assert.throws(
    () => context.validateBackgroundPrediction(prediction([-3.72, -2.99, -1.24, -2.8])),
    /confiança suficiente/,
  );
});

test('rejects low precision and invalid numeric values', () => {
  assert.throws(() => context.validateBackgroundPrediction(prediction([-8, 8, 0, 1], 'float16')), /float32/);
  assert.throws(() => context.validateBackgroundPrediction(prediction([-8, NaN, 8, 1])), /inválida/);
});

test('invalid GPU result releases output and input tensors before retry', async () => {
  let inputDisposed = false, outputDisposed = false;
  const result = prediction([-3, -2, -1, -2]);
  result.output_image.dispose = () => { outputDisposed = true; };
  const engine = {
    processor: async () => ({ pixel_values: { dispose() { inputDisposed = true; } } }),
    model: async () => result,
  };
  await assert.rejects(() => context.inferBackground(engine, {}), /confiança suficiente/);
  assert(inputDisposed);
  assert(outputDisposed);
});

test('valid inference preserves its output until composition and releases input', async () => {
  let inputDisposed = false, outputDisposed = false;
  const result = prediction([-10, -9, 15, 16]);
  result.output_image.dispose = () => { outputDisposed = true; };
  const engine = {
    processor: async () => ({ pixel_values: { dispose() { inputDisposed = true; } } }),
    model: async () => result,
  };
  assert.equal(await context.inferBackground(engine, {}), result);
  assert(inputDisposed);
  assert.equal(outputDisposed, false);
});
