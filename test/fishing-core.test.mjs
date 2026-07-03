import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mulberry32,
  castPowerAt,
  createFightSim,
  computeAccuracy,
  PROGRESS_START,
} from '../public/js/fishing-core.mjs';

const PARAMS = {
  strength: 3,
  erratic: 1,
  stamina: 91,
  barSize: 15,
  progressRate: 9,
  drainRate: 11,
  tensionRise: 13,
  tensionDecay: 10,
  minFightMs: 7598,
};

function runSim(params, seed, holdFn, maxMs = 120000) {
  const sim = createFightSim(params, seed);
  let outcome = null;
  for (let t = 0; t < maxMs && !outcome; t += 16) {
    outcome = sim.step(16, holdFn(sim.getState(), t));
  }
  return { outcome, state: sim.getState() };
}

test('mulberry32 is deterministic', () => {
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
});

test('castPowerAt oscillates 0..100', () => {
  assert.equal(castPowerAt(0), 0);
  assert.equal(castPowerAt(600), 100);
  assert.equal(castPowerAt(1200), 0);
  for (let t = 0; t < 5000; t += 37) {
    const p = castPowerAt(t);
    assert.ok(p >= 0 && p <= 100, `power in range at ${t}`);
  }
});

test('sim is deterministic for identical inputs', () => {
  const a = createFightSim(PARAMS, 188054607);
  const b = createFightSim(PARAMS, 188054607);
  for (let i = 0; i < 2000; i++) {
    const held = i % 30 < 15;
    a.step(16, held);
    b.step(16, held);
  }
  assert.deepEqual(a.getState(), b.getState());
});

test('never holding drains progress to slack', () => {
  const { outcome, state } = runSim(PARAMS, 42, () => false);
  assert.equal(outcome, 'slack');
  assert.equal(state.progress, 0);
  // Starting progress buys about PROGRESS_START/drainRate seconds.
  assert.ok(state.elapsedMs < (PROGRESS_START / PARAMS.drainRate) * 1000 * 3);
});

test('tracking the fish wins the fight', () => {
  // Simple proportional controller: hold when the bar center is below the
  // fish. Against a slow common fish this should land the catch.
  const { outcome, state } = runSim(PARAMS, 188054607, (st) => st.barPos < st.fishPos);
  assert.equal(outcome, 'caught');
  assert.ok(state.progress >= 100);
  assert.ok(computeAccuracy(state) > 0.5, `accuracy ${computeAccuracy(state)}`);
  assert.ok(state.elapsedMs >= PARAMS.minFightMs, 'fight lasts past minFightMs');
});

test('a legendary fish defeats naive tracking via tension snap', () => {
  // Legendary profile: strength 10, erratic 10, tensionRise 10+strength.
  const params = {
    strength: 10, erratic: 10, stamina: 220, barSize: 10,
    progressRate: 9, drainRate: 11, tensionRise: 20, tensionDecay: 10,
  };
  // The same proportional controller that beats a common fish snaps the
  // line here - reeling against every run is fatal at the top tier.
  const { outcome, state } = runSim(params, 42, (st) => st.barPos < st.fishPos);
  assert.equal(outcome, 'snap');
  assert.equal(Math.round(state.tensionPeak), 100);
});

test('accuracy is bounded 0..1 and zero for empty state', () => {
  assert.equal(computeAccuracy(null), 0);
  assert.equal(computeAccuracy({ elapsedMs: 0, overlapMs: 0 }), 0);
  assert.equal(computeAccuracy({ elapsedMs: 100, overlapMs: 500 }), 1);
});

test('step caps runaway dt', () => {
  const sim = createFightSim(PARAMS, 9);
  sim.step(5000, true); // one huge frame must not explode the physics
  const st = sim.getState();
  assert.ok(st.barPos >= 0 && st.barPos <= 100);
  assert.ok(st.progress >= 0 && st.progress <= 100);
});
