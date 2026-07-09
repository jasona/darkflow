const CANONICAL_PACKAGES = new Map([
  ['core.supports.set', 'Core.Supports.Set'],
  ['core.supports.add', 'Core.Supports.Add'],
  ['core.supports.remove', 'Core.Supports.Remove'],
  ['char.vitals', 'Char.Vitals'],
  ['char.status', 'Char.Status'],
  ['char.statusvars', 'Char.StatusVars'],
  ['char.stats', 'Char.Stats'],
  ['char.realstats', 'Char.RealStats'],
  ['char.items.list', 'Char.Items.List'],
  ['char.items.add', 'Char.Items.Add'],
  ['char.items.remove', 'Char.Items.Remove'],
  ['char.items.update', 'Char.Items.Update'],
  ['room.info', 'Room.Info'],
  ['room.players', 'Room.Players'],
  ['room.addplayer', 'Room.AddPlayer'],
  ['room.removeplayer', 'Room.RemovePlayer'],
  ['comm.channel', 'Comm.Channel'],
  ['comm.channel.text', 'Comm.Channel.Text'],
  ['comm.channel.list', 'Comm.Channel.List'],
  ['comm.channel.players', 'Comm.Channel.Players'],
  ['comm.channel.start', 'Comm.Channel.Start'],
  ['comm.channel.end', 'Comm.Channel.End'],
  ['group', 'Group'],
  ['game', 'Game'],
  ['core.ping', 'Core.Ping'],
  ['darkwind.lag.status', 'Darkwind.Lag.Status'],
  ['darkwind.xpmon', 'Darkwind.XPMon'],
  ['darkwind.mapdata2.current', 'Darkwind.MapData2.Current'],
  ['darkwind.mapdata2.update', 'Darkwind.MapData2.Update'],
  ['darkwind.mapdata2.area', 'Darkwind.MapData2.Area'],
  ['darkwind.mapdata2.browsearea', 'Darkwind.MapData2.BrowseArea'],
  ['darkwind.mapdata2.reset', 'Darkwind.MapData2.Reset'],
  ['darkwind.mapdata2.error', 'Darkwind.MapData2.Error'],
  ['darkwind.mapdata2.sync', 'Darkwind.MapData2.Sync'],
  ['darkwind.mapdata2.browse', 'Darkwind.MapData2.Browse'],
]);

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function firstDefined(source, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
  }
  return undefined;
}

export function canonicalPackageName(packageName) {
  const raw = typeof packageName === 'string' ? packageName.trim() : '';
  return CANONICAL_PACKAGES.get(raw.toLowerCase()) || raw;
}

export function normalizeSupportsPayload(payload) {
  if (Array.isArray(payload)) {
    return payload.map((item) => {
      if (typeof item !== 'string') return item;
      const parts = item.trim().split(/\s+/);
      if (!parts[0]) return item;
      const canonical = canonicalPackageName(parts[0]);
      return canonical + (parts[1] ? ' ' + parts[1] : '');
    });
  }
  if (!isObject(payload)) return payload;
  const out = {};
  for (const [name, version] of Object.entries(payload)) {
    out[canonicalPackageName(name)] = version;
  }
  return out;
}

function normalizeVitals(data) {
  if (!isObject(data)) return data;
  const out = { ...data };
  if (out.maxhp === undefined && out.mhp !== undefined) out.maxhp = out.mhp;
  if (out.mhp === undefined && out.maxhp !== undefined) out.mhp = out.maxhp;

  const mana = firstDefined(out, ['sp', 'mana', 'mp']);
  const maxMana = firstDefined(out, ['maxsp', 'mmana', 'maxmana', 'maxmp', 'mmp']);
  if (out.sp === undefined && mana !== undefined) out.sp = mana;
  if (out.maxsp === undefined && maxMana !== undefined) out.maxsp = maxMana;
  if (out.mana === undefined && mana !== undefined) out.mana = mana;
  if (out.mmana === undefined && maxMana !== undefined) out.mmana = maxMana;

  const move = firstDefined(out, ['fp', 'move']);
  const maxMove = firstDefined(out, ['maxfp', 'mmove', 'maxmove']);
  if (out.fp === undefined && move !== undefined) out.fp = move;
  if (out.maxfp === undefined && maxMove !== undefined) out.maxfp = maxMove;
  if (out.move === undefined && move !== undefined) out.move = move;
  if (out.mmove === undefined && maxMove !== undefined) out.mmove = maxMove;

  if (out.string === undefined && out.hp !== undefined && out.maxhp !== undefined) {
    const parts = ['HP:' + out.hp + '/' + out.maxhp];
    if (out.sp !== undefined && out.maxsp !== undefined) parts.push('SP:' + out.sp + '/' + out.maxsp);
    if (out.fp !== undefined && out.maxfp !== undefined) parts.push('MV:' + out.fp + '/' + out.maxfp);
    out.string = parts.join(' ');
  }
  return out;
}

function normalizeRoomInfo(data) {
  if (!isObject(data)) return data;
  const out = { ...data };
  if (out.environment === undefined && out.terrain !== undefined) out.environment = out.terrain;
  if (out.environment === undefined && out.env !== undefined) out.environment = out.env;
  if (out.terrain === undefined && out.environment !== undefined) out.terrain = out.environment;
  if (isObject(out.coords)) {
    out.coord_x = out.coords.x;
    out.coord_y = out.coords.y;
    out.coord_z = out.coords.z;
  }
  if (isObject(out.exits)) {
    const exits = {};
    const exitStates = {};
    for (const [dir, dest] of Object.entries(out.exits)) {
      exits[dir] = dest;
      if (typeof dest === 'string' && !/^-?\d+$/.test(dest)) exitStates[dir] = dest;
    }
    out.exits = exits;
    if (Object.keys(exitStates).length) out.exit_states = exitStates;
  }
  return out;
}

function normalizeChannelMessage(data) {
  if (!isObject(data)) return { text: String(data || '') };
  const out = { ...data };
  if (out.channel === undefined && out.chan !== undefined) out.channel = out.chan;
  if (out.chan === undefined && out.channel !== undefined) out.chan = out.channel;
  if (out.talker === undefined && out.player !== undefined) out.talker = out.player;
  if (out.player === undefined && out.talker !== undefined) out.player = out.talker;
  if (out.text === undefined && out.msg !== undefined) out.text = out.msg;
  if (out.msg === undefined && out.text !== undefined) out.msg = out.text;
  return out;
}

function normalizeGroup(data) {
  if (!isObject(data) || !Array.isArray(data.members)) return data;
  return {
    ...data,
    members: data.members.map((member) => {
      if (!isObject(member)) return member;
      return {
        ...member,
        info: isObject(member.info) ? normalizeVitals(member.info) : member.info,
      };
    }),
  };
}

export function normalizeGmcpFrame(packageName, data) {
  const canonical = canonicalPackageName(packageName);
  switch (canonical) {
  case 'Core.Supports.Set':
  case 'Core.Supports.Add':
  case 'Core.Supports.Remove':
    return { packageName: canonical, data: normalizeSupportsPayload(data) };
  case 'Char.Vitals':
    return { packageName: canonical, data: normalizeVitals(data) };
  case 'Room.Info':
    return { packageName: canonical, data: normalizeRoomInfo(data) };
  case 'Comm.Channel':
  case 'Comm.Channel.Text':
    return { packageName: canonical, data: normalizeChannelMessage(data) };
  case 'Group':
    return { packageName: canonical, data: normalizeGroup(data) };
  default:
    return { packageName: canonical, data };
  }
}
