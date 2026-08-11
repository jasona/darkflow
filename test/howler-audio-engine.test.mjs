import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { HowlerAudioEngine } from '../public/js/howler-audio-engine.js';

const root = new URL('../', import.meta.url);

function createRuntime({ webAudio = true } = {}) {
  let nextId = 1;
  const instances = [];
  const howler = {
    usingWebAudio: webAudio,
    ctx: webAudio ? {
      state: 'suspended',
      async resume() { this.state = 'running'; },
    } : null,
    volumeCalls: [],
    volume(value) { this.volumeCalls.push(value); },
  };

  class FakeHowl {
    constructor(options) {
      this.options = options;
      this.listeners = [];
      this.volumeCalls = [];
      this.loopCalls = [];
      this.stopCalls = [];
      instances.push(this);
    }

    play() {
      const id = nextId++;
      queueMicrotask(() => {
        this.options.onplay?.(id);
        this.emit('play', id);
      });
      return id;
    }

    volume(value, id) {
      this.volumeCalls.push({ value, id });
      return this;
    }

    loop(value, id) {
      this.loopCalls.push({ value, id });
      return this;
    }

    stop(id) {
      this.stopCalls.push(id);
      this.emit('stop', id);
      return this;
    }

    once(event, callback, id) {
      this.listeners.push({ event, callback, id, once: true });
      return this;
    }

    off(event, callback, id) {
      this.listeners = this.listeners.filter((listener) => !(
        listener.event === event
        && (!callback || listener.callback === callback)
        && (id === undefined || listener.id === id)
      ));
      return this;
    }

    emit(event, id, error) {
      const matching = this.listeners.filter((listener) => (
        listener.event === event && (listener.id === undefined || listener.id === id)
      ));
      this.listeners = this.listeners.filter((listener) => !matching.includes(listener));
      for (const listener of matching) listener.callback(id, error);
    }
  }

  return {
    Howl: FakeHowl,
    Howler: howler,
    clearTimeout,
    setTimeout,
    instances,
  };
}

test('creates Howler core sounds and preserves independent playback IDs', async () => {
  const runtime = createRuntime();
  const engine = new HowlerAudioEngine(runtime);
  const handle = engine.create('/assets/sounds/combat-hit.mp3');

  const firstId = engine.play(handle, { volume: 0.4 });
  const secondId = engine.play(handle, { volume: 0.8, loop: true });
  await Promise.resolve();

  assert.notEqual(firstId, secondId);
  assert.deepEqual(handle.howl.options.src, ['/assets/sounds/combat-hit.mp3']);
  assert.deepEqual(handle.howl.volumeCalls, [
    { value: 0.4, id: firstId },
    { value: 0.8, id: secondId },
  ]);
  assert.deepEqual(handle.howl.loopCalls, [
    { value: false, id: firstId },
    { value: true, id: secondId },
  ]);
  assert.equal(engine.isUnlocked(), true);
});

test('uses the exposed Web Audio context for a trusted unlock', async () => {
  const runtime = createRuntime();
  const engine = new HowlerAudioEngine(runtime);
  let unlockEvents = 0;
  engine.onUnlock(() => { unlockEvents += 1; });

  assert.equal(await engine.unlock(), true);
  assert.equal(runtime.Howler.ctx.state, 'running');
  assert.equal(engine.isUnlocked(), true);
  assert.equal(unlockEvents, 1);
  assert.equal(runtime.instances[0].options.html5, false);
});

test('sets master volume through Howler without modifying source volume', () => {
  const runtime = createRuntime();
  const engine = new HowlerAudioEngine(runtime);

  engine.setGlobalVolume(0.35);

  assert.deepEqual(runtime.Howler.volumeCalls, [0.35]);
});

test('loads the pinned local Howler core before the Darkflow module graph', () => {
  const packageJson = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  const indexHtml = readFileSync(new URL('client/index.html', root), 'utf8');
  const soundManager = readFileSync(new URL('public/js/sound-manager.js', root), 'utf8');

  assert.equal(packageJson.dependencies.howler, '2.2.4');
  assert.ok(
    indexHtml.indexOf('/vendor/howler.core.min.js') <
      indexHtml.indexOf('/app/bootstrap.ts'),
  );
  assert.doesNotMatch(indexHtml, /js\/app\.js/);
  assert.doesNotMatch(soundManager, /new\s+Audio\s*\(/);
});
