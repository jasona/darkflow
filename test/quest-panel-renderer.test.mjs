import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {},
};
globalThis.document = {
  hidden: false,
  addEventListener() {},
  removeEventListener() {},
  createElement() {
    return {
      style: {},
      classList: { add() {}, remove() {}, toggle() {} },
      appendChild() {},
      setAttribute() {},
      addEventListener() {},
      removeEventListener() {},
    };
  },
};
globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
  matchMedia() {
    return { matches: false, addEventListener() {}, removeEventListener() {} };
  },
};

const { panelRenderers } = await import('../public/js/panel-renderers.js');

test('quest pane omits completed quests from the accepted quest list', () => {
  const bodyEl = { innerHTML: '' };

  panelRenderers.quests(bodyEl, {
    list: [
      {
        name: 'Open Quest',
        status: 'started',
        current: 1,
        total: 3,
        objectives: [
          { name: 'Do the thing', status: 'started', current: 1, required: 3 },
        ],
      },
      {
        name: 'Finished Quest',
        status: 'finished',
        current: 3,
        total: 3,
        objectives: [
          { name: 'Done thing', status: 'finished', current: 3, required: 3 },
        ],
      },
      {
        name: 'Complete Quest',
        status: 'complete',
        current: 1,
        total: 1,
      },
      {
        name: 'Completed Quest',
        status: 'completed',
        current: 1,
        total: 1,
      },
    ],
  });

  assert.match(bodyEl.innerHTML, /Open Quest/);
  assert.doesNotMatch(bodyEl.innerHTML, /Finished Quest/);
  assert.doesNotMatch(bodyEl.innerHTML, /Complete Quest/);
  assert.doesNotMatch(bodyEl.innerHTML, /Completed Quest/);
});

test('quest pane shows empty state when all quests are completed', () => {
  const bodyEl = { innerHTML: '' };

  panelRenderers.quests(bodyEl, {
    list: [
      { name: 'Finished Quest', status: 'finished', current: 1, total: 1 },
    ],
  });

  assert.match(bodyEl.innerHTML, /No active quests/);
  assert.doesNotMatch(bodyEl.innerHTML, /Finished Quest/);
});

test('quest pane identifies quests ready for waysteward turn-in', () => {
  const bodyEl = { innerHTML: '' };

  panelRenderers.quests(bodyEl, {
    list: [{
      name: 'Finished Work', status: 'Ready to Turn In',
      readyToTurnIn: true, giverName: 'Black Sap Grove',
      current: 3, total: 3,
    }],
  });

  assert.match(bodyEl.innerHTML, /Finished Work/);
  assert.match(bodyEl.innerHTML, /Ready to turn in at Black Sap Grove waysteward/);
});
