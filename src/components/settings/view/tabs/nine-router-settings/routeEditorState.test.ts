import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addRouteTarget,
  isValidRouteName,
  moveRouteTarget,
  removeRouteTarget,
  serializeRouteTargets,
} from './routeEditorState.js';

test('route targets append once and preserve the existing order', () => {
  assert.deepEqual(addRouteTarget(['model-a'], 'model-b'), ['model-a', 'model-b']);
  assert.deepEqual(addRouteTarget(['model-a'], 'model-a'), ['model-a']);
  assert.deepEqual(addRouteTarget(['model-a'], ''), ['model-a']);
});

test('route targets can be removed without mutating the source list', () => {
  const targets = ['model-a', 'model-b', 'model-c'];

  assert.deepEqual(removeRouteTarget(targets, 1), ['model-a', 'model-c']);
  assert.deepEqual(targets, ['model-a', 'model-b', 'model-c']);
  assert.deepEqual(removeRouteTarget(targets, -1), targets);
  assert.deepEqual(removeRouteTarget(targets, 3), targets);
});

test('route targets move one position while respecting first and last bounds', () => {
  assert.deepEqual(moveRouteTarget(['a', 'b', 'c'], 1, -1), ['b', 'a', 'c']);
  assert.deepEqual(moveRouteTarget(['a', 'b', 'c'], 1, 1), ['a', 'c', 'b']);
  assert.deepEqual(moveRouteTarget(['a', 'b', 'c'], 0, -1), ['a', 'b', 'c']);
  assert.deepEqual(moveRouteTarget(['a', 'b', 'c'], 2, 1), ['a', 'b', 'c']);
});

test('route target serialization returns a stable ordered copy', () => {
  const targets = ['provider/model-z', 'provider/model-a', 'provider/model-m'];
  const serialized = serializeRouteTargets(targets);

  assert.deepEqual(serialized, targets);
  assert.notEqual(serialized, targets);
});

test('route names match the inspected 9router character contract', () => {
  for (const name of ['quality-first', 'fast_route', 'route.v2', 'Route42']) {
    assert.equal(isValidRouteName(name), true, name);
  }
  for (const name of ['', 'contains space', 'slash/name', '路由']) {
    assert.equal(isValidRouteName(name), false, name);
  }
});
