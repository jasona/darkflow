// fishing-core.mjs - pure, DOM-free simulation for the fishing mini-game.
// Deterministic given (params, seed): the server supplies both in the
// Darkwind.Fishing.Fight message, the manager drives step() from rAF, and
// the outcome + accuracy are reported back for server-side validation.
//
// Track model: positions are 0..100 along a vertical track (0 = bottom).
// The fish wanders/runs toward targets; the player's bar rises while the
// input is held and falls otherwise. Overlap fills the catch progress and
// tires the fish; slack drains progress; reeling against a running fish
// spikes line tension.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Oscillating cast power: 0..100 triangle wave, ~1.2s period.
export function castPowerAt(tMs) {
  const period = 1200;
  const t = (tMs % period) / period;
  return Math.round((t < 0.5 ? t * 2 : (1 - t) * 2) * 100);
}

export const PROGRESS_START = 30;

export function createFightSim(params, seed) {
  const rand = mulberry32(seed);
  const strength = params.strength ?? 5;
  const erratic = params.erratic ?? 5;
  const barSize = params.barSize ?? 20;
  const progressRate = params.progressRate ?? 9;
  const drainRate = params.drainRate ?? 11;
  const tensionRise = params.tensionRise ?? 14;
  const tensionDecay = params.tensionDecay ?? 10;
  const staminaMax = Math.max(1, params.stamina ?? 100);

  const st = {
    fishPos: 55, fishVel: 0,
    barPos: 45, barVel: 0,
    tension: 0, tensionPeak: 0,
    progress: PROGRESS_START,
    stamina: staminaMax, staminaMax,
    running: false,
    elapsedMs: 0, overlapMs: 0,
    outcome: null,
  };

  let target = 55;
  let retargetIn = 0.6;
  let runFor = 0;
  let graceLeft = 0;

  function retarget() {
    target = 5 + rand() * 90;
    retargetIn = Math.max(0.35, 2.2 - erratic * 0.16) + rand() * 0.6;
    if (rand() < erratic / 14) {
      st.running = true;
      runFor = 0.5 + rand() * 0.8;
    }
  }

  function step(dtMs, held) {
    if (st.outcome) return st.outcome;
    const dt = Math.min(dtMs, 100) / 1000;
    const tired = Math.max(0.4, st.stamina / st.staminaMax);

    retargetIn -= dt;
    if (retargetIn <= 0) retarget();
    if (st.running) {
      runFor -= dt;
      if (runFor <= 0) st.running = false;
    }

    // Fish movement: velocity eases toward the target (no instant flips)
    // and slows as it arrives, so the fish is trackable between runs.
    const speed = (8 + strength * 5) * tired * (st.running ? 2.6 : 1);
    const dist = target - st.fishPos;
    const desired = Math.sign(dist) * speed * Math.min(1, Math.abs(dist) / 6);
    st.fishVel += (desired - st.fishVel) * Math.min(1, 6 * dt);
    st.fishPos += st.fishVel * dt;
    if (st.fishPos < 2) st.fishPos = 2;
    if (st.fishPos > 98) st.fishPos = 98;

    // Player bar: acceleration against strong drag. Drag caps the speed
    // (~87 up, ~79 down) and bleeds momentum the moment input changes, so
    // the bar is steerable instead of ballistic.
    st.barVel += (held ? 330 : -300) * dt;
    st.barVel /= 1 + 3.8 * dt;
    st.barPos += st.barVel * dt;
    if (st.barPos < barSize / 2) { st.barPos = barSize / 2; st.barVel *= -0.25; }
    if (st.barPos > 100 - barSize / 2) { st.barPos = 100 - barSize / 2; st.barVel *= -0.25; }

    // Overlap, progress, stamina. Losing the fish is forgiven for a short
    // grace window (coyote time) so human reaction lag drains nothing.
    const touching = Math.abs(st.barPos - st.fishPos) <= barSize / 2 + 3;
    if (touching) graceLeft = 0.3;
    else graceLeft = Math.max(0, graceLeft - dt);
    const overlap = touching || graceLeft > 0;
    if (overlap) {
      st.progress += progressRate * dt;
      st.stamina = Math.max(0, st.stamina - 6 * dt);
      st.overlapMs += dtMs;
    } else {
      st.progress -= drainRate * dt;
    }

    // Line tension.
    if (st.running && held) st.tension += tensionRise * 2.0 * dt;
    else if (st.running) st.tension += tensionRise * 0.6 * dt;
    else if (held && overlap) st.tension += tensionRise * 0.25 * dt;
    else st.tension -= tensionDecay * dt;
    if (st.tension < 0) st.tension = 0;
    if (st.tension > st.tensionPeak) st.tensionPeak = st.tension;

    st.elapsedMs += dtMs;

    if (st.progress >= 100) { st.progress = 100; st.outcome = 'caught'; }
    else if (st.progress <= 0) { st.progress = 0; st.outcome = 'slack'; }
    else if (st.tension >= 100) { st.tension = 100; st.outcome = 'snap'; }

    return st.outcome;
  }

  function getState() {
    return { ...st };
  }

  return { step, getState };
}

export function computeAccuracy(state) {
  if (!state || state.elapsedMs <= 0) return 0;
  return Math.max(0, Math.min(1, state.overlapMs / state.elapsedMs));
}
