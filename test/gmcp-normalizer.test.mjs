import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalPackageName,
  normalizeGmcpFrame,
  normalizeSupportsPayload,
} from '../public/js/gmcp-normalizer.js';

test('canonicalizes common GMCP package names case-insensitively', () => {
  assert.equal(canonicalPackageName('room.info'), 'Room.Info');
  assert.equal(canonicalPackageName('CHAR.VITALS'), 'Char.Vitals');
  assert.equal(canonicalPackageName('Comm.Channel'), 'Comm.Channel');
  assert.equal(canonicalPackageName('darkwind.xpmon'), 'Darkwind.XPMon');
  assert.equal(canonicalPackageName('darkwind.session.recovered'), 'Darkwind.Session.Recovered');
  assert.equal(canonicalPackageName('darkwind.visual.events'), 'Darkwind.Visual.Events');
  assert.equal(canonicalPackageName('DARKWIND.VISUAL.STATE'), 'Darkwind.Visual.State');
  assert.equal(canonicalPackageName('darkwind.visual.preview'), 'Darkwind.Visual.Preview');
  assert.equal(canonicalPackageName('darkwind.mapdata2.error'), 'Darkwind.MapData2.Error');
});

test('normalizes supports payload package names', () => {
  assert.deepEqual(normalizeSupportsPayload(['room.info 1', 'COMM.CHANNEL 1']), [
    'Room.Info 1',
    'Comm.Channel 1',
  ]);
  assert.deepEqual(normalizeSupportsPayload({ 'char.vitals': '1' }), {
    'Char.Vitals': '1',
  });
});

test('normalizes Aardwolf-style vitals aliases', () => {
  const frame = normalizeGmcpFrame('char.vitals', {
    hp: 415,
    mhp: 1479,
    mana: 151,
    mmana: 1121,
    move: 375,
    mmove: 541,
  });

  assert.equal(frame.packageName, 'Char.Vitals');
  assert.equal(frame.data.maxhp, 1479);
  assert.equal(frame.data.sp, 151);
  assert.equal(frame.data.maxsp, 1121);
  assert.equal(frame.data.fp, 375);
  assert.equal(frame.data.maxfp, 541);
  assert.equal(frame.data.string, 'HP:415/1479 SP:151/1121 MV:375/541');
});

test('normalizes root Comm.Channel messages', () => {
  const frame = normalizeGmcpFrame('comm.channel', {
    chan: 'gossip',
    player: 'Imfat',
    msg: 'yep',
  });

  assert.equal(frame.packageName, 'Comm.Channel');
  assert.equal(frame.data.channel, 'gossip');
  assert.equal(frame.data.talker, 'Imfat');
  assert.equal(frame.data.text, 'yep');
});

test('normalizes Room.Info terrain and non-room exit states', () => {
  const frame = normalizeGmcpFrame('ROOM.INFO', {
    num: 17122,
    name: 'At the foot of a pile of rocks',
    terrain: 'Forest',
    exits: { north: 17121, down: 'closed' },
    coords: { x: 0, y: 1, z: -1 },
  });

  assert.equal(frame.packageName, 'Room.Info');
  assert.equal(frame.data.environment, 'Forest');
  assert.deepEqual(frame.data.exit_states, { down: 'closed' });
  assert.equal(frame.data.coord_x, 0);
  assert.equal(frame.data.coord_y, 1);
  assert.equal(frame.data.coord_z, -1);
});
