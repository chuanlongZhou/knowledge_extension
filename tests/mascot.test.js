import test from 'node:test';
import assert from 'node:assert/strict';
import { MASCOTS, normalizeMascot, nextMascot } from '../extension/lib/mascot.js';

test('mascot preferences accept known assets and intervals; fixed, random and cycle have distinct behavior', () => {
  assert.deepEqual(normalizeMascot(null), { mode: 'fixed', selected: 'original', interval: 30 });
  assert.deepEqual(
    normalizeMascot({ mode: 'unknown', selected: 'https://evil.test/x', interval: 1 }),
    normalizeMascot(),
  );
  const fixed = normalizeMascot({ selected: 'black-cat' });
  assert.equal(nextMascot(fixed, 'original'), 'black-cat');
  const cycle = normalizeMascot({ mode: 'cycle' });
  let previous = MASCOTS[0].id;
  const seen = [];
  for (let i = 0; i < MASCOTS.length; i++) {
    previous = nextMascot(cycle, previous);
    seen.push(previous);
  }
  assert.equal(new Set(seen).size, MASCOTS.length);
  assert.equal(previous, MASCOTS[0].id);
  const random = normalizeMascot({ mode: 'random', interval: 10 });
  for (const asset of MASCOTS)
    for (const sample of [0, 0.2, 0.5, 0.999])
      assert.notEqual(
        nextMascot(random, asset.id, () => sample),
        asset.id,
      );
});
