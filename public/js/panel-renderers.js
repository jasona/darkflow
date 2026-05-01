import { state } from './state.js';
import { renderMap } from './map-renderer.js';
import { sendCommandText } from './input.js';

let roomImageModal = null;
let roomImageModalKeyHandler = null;

export function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes % 60;
    return hours + 'h ' + remMinutes + 'm';
  }
  if (minutes > 0) return minutes + 'm ' + secs + 's';
  return secs + 's';
}

function formatStatusTitle(title, name) {
  if (!title) return title;
  const displayName = name || '';
  return String(title).replace(/\$N/g, displayName).replace(/\s+/g, ' ').trim();
}

function formatInt(n) {
  return typeof n === 'number' ? n.toLocaleString('en-US') : n;
}

export function channelColor(channel) {
  let hash = 0;
  for (let i = 0; i < channel.length; i++) hash = ((hash << 5) - hash + channel.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return 'hsl(' + hue + ', 60%, 65%)';
}

export function vitalBarColor(pct) {
  if (pct > 60) return '#3fb950';
  if (pct > 30) return '#d29922';
  return '#f85149';
}

function divineGodLabel(god) {
  switch (String(god || '').toLowerCase()) {
    case 'mitra': return 'Mitra';
    case 'gaea': return 'Gaea';
    case 'set': return 'Set';
    default: return 'None';
  }
}

function divineModifierLabel(value) {
  const n = Number(value) || 0;
  if (n > 0) return '+' + n + '% charge';
  if (n < 0) return n + '% charge';
  return 'No charge modifier';
}

function closeRoomImageModal() {
  if (!roomImageModal) return;
  if (roomImageModalKeyHandler) {
    document.removeEventListener('keydown', roomImageModalKeyHandler);
    roomImageModalKeyHandler = null;
  }
  roomImageModal.remove();
  roomImageModal = null;
}

function openRoomImageModal(src, altText) {
  closeRoomImageModal();

  const overlay = document.createElement('div');
  overlay.className = 'dw-modal-overlay room-image-modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'dw-modal room-image-modal';

  const header = document.createElement('div');
  header.className = 'dw-modal-header';

  const title = document.createElement('span');
  title.className = 'dw-modal-title';
  title.textContent = altText || 'Room Image';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'dw-modal-close';
  closeBtn.innerHTML = '&#x2715;';
  closeBtn.addEventListener('click', closeRoomImageModal);

  const body = document.createElement('div');
  body.className = 'dw-modal-body room-image-modal-body';

  const img = document.createElement('img');
  img.className = 'room-image-modal-img';
  img.src = src;
  img.alt = altText || 'Room Image';
  img.draggable = false;

  header.appendChild(title);
  header.appendChild(closeBtn);
  body.appendChild(img);
  modal.appendChild(header);
  modal.appendChild(body);
  overlay.appendChild(modal);

  overlay.addEventListener('click', function(event) {
    if (event.target === overlay) {
      closeRoomImageModal();
    }
  });

  roomImageModalKeyHandler = function(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeRoomImageModal();
    }
  };
  document.addEventListener('keydown', roomImageModalKeyHandler);

  document.body.appendChild(overlay);
  roomImageModal = overlay;
}

export function renderVitalBar(bodyEl, label, cur, max) {
  let row = bodyEl.querySelector('.vitals-' + label.toLowerCase());
  const pct = max > 0 ? Math.round((cur / max) * 100) : 0;
  if (!row) {
    row = document.createElement('div');
    row.className = 'vitals-row vitals-' + label.toLowerCase();
    row.innerHTML =
      '<div class="vitals-label"><span>' + label + '</span><span class="vitals-val"></span></div>' +
      '<div class="vitals-bar"><div class="vitals-bar-fill"></div></div>';
    bodyEl.appendChild(row);
  }
  row.querySelector('.vitals-val').textContent = cur + ' / ' + max;
  const fill = row.querySelector('.vitals-bar-fill');
  fill.style.width = pct + '%';
  fill.style.backgroundColor = vitalBarColor(pct);
}

export const panelRenderers = {
  avatar(bodyEl, data) {
    const hasAvatar = !!(data && data.url);
    const src = hasAvatar ? data.url : '/assets/avatar-ghost.svg';
    const alt = (data && data.name) ? data.name : 'Avatar';
    const defaultClass = hasAvatar ? '' : ' avatar-default';
    const loadingClass = (data && data.loading) ? ' avatar-loading' : '';
    const zoomableClass = hasAvatar ? ' avatar-panel-image-zoomable' : '';
    let html = '<div class="avatar-panel-wrap">';
    html += '<img class="avatar-panel-image' + defaultClass + loadingClass + zoomableClass + '" src="' + escHtml(src) + '" alt="' + escHtml(alt) + '" draggable="false">';
    if (data && data.name) {
      html += '<div class="avatar-panel-name">' + escHtml(data.name) + '</div>';
    }
    html += '</div>';
    bodyEl.innerHTML = html;

    if (hasAvatar) {
      const img = bodyEl.querySelector('.avatar-panel-image');
      if (img) {
        img.addEventListener('click', function() {
          openRoomImageModal(data.url, alt);
        });
      }
    }
  },

  roomImage(bodyEl, data) {
    let alt;
    let loadingClass;
    let img;

    if (!data || !data.url) {
      bodyEl.innerHTML = '<div class="room-image-placeholder">Generating room image...</div>';
      return;
    }

    loadingClass = data.loading ? ' room-image-loading' : '';
    alt = data.name ? escHtml(data.name) : 'Room';
    bodyEl.innerHTML =
      '<div class="room-image-wrap">' +
        '<img class="room-image-img' + loadingClass + '" src="' + escHtml(data.url) + '" alt="' + alt + '" draggable="false">' +
      '</div>';

    img = bodyEl.querySelector('.room-image-img');
    if (!img) return;

    img.addEventListener('click', function() {
      openRoomImageModal(data.url, data.name || 'Room');
    });
  },

  vitals(bodyEl, data) {
    if (!data) return;
    if (bodyEl.querySelector('.placeholder')) bodyEl.innerHTML = '';
    renderVitalBar(bodyEl, 'HP', data.hp, data.maxhp);
    renderVitalBar(bodyEl, 'SP', data.sp, data.maxsp);
  },

  omens(bodyEl, data) {
    if (!data) {
      bodyEl.innerHTML = '<div class="placeholder">Waiting for omens...</div>';
      return;
    }

    const scale = data.pressure_scale || {};
    const holy = data.holy_hour || {};
    const eclipse = data.eclipse || {};
    const patron = data.patron ? divineGodLabel(data.patron) : 'None';
    const leader = data.leader ? divineGodLabel(data.leader) : 'No ascendant';
    const rank = data.rank_label || 'None';
    const summary = data.summary || 'The omens are quiet.';
    const gods = ['mitra', 'gaea', 'set'];
    let html = '<div class="omens-panel">';

    html += '<div class="omens-summary">' + escHtml(summary) + '</div>';
    html += '<div class="omens-status-grid">';
    html += '<div><span>Patron</span><strong class="omens-god-' + escHtml(String(data.patron || 'none').toLowerCase()) + '">' + escHtml(patron) + '</strong></div>';
    html += '<div><span>Standing</span><strong>' + escHtml(rank) + '</strong></div>';
    html += '<div><span>Charge</span><strong>' + escHtml(divineModifierLabel(data.modifier_pct)) + '</strong></div>';
    html += '<div><span>Ascendant</span><strong class="omens-god-' + escHtml(String(data.leader || 'none').toLowerCase()) + '">' + escHtml(leader) + '</strong></div>';
    html += '</div>';

    html += '<div class="omens-pressure">';
    for (const god of gods) {
      const pct = Math.max(0, Math.min(100, Number(scale[god]) || 0));
      html += '<div class="omens-pressure-row omens-god-' + god + '">' +
        '<div class="omens-pressure-label"><span>' + divineGodLabel(god) + '</span><span>' + (pct > 0 ? 'stirring' : 'silent') + '</span></div>' +
        '<div class="omens-pressure-bar"><div style="width:' + pct + '%"></div></div>' +
        '</div>';
    }
    html += '</div>';

    html += '<div class="omens-flags">';
    if (holy && holy.god) {
      html += '<span class="omens-chip omens-god-' + escHtml(String(holy.god).toLowerCase()) + '">Holy Hour: ' +
        escHtml(divineGodLabel(holy.god)) + '</span>';
    }
    if (eclipse && eclipse.active) {
      html += '<span class="omens-chip omens-eclipse">Set Eclipse: ' +
        escHtml(formatDuration(eclipse.seconds_left)) + '</span>';
    }
    if (!holy.god && !(eclipse && eclipse.active)) {
      html += '<span class="omens-muted">No active divine event.</span>';
    }
    html += '</div>';
    html += '</div>';
    bodyEl.innerHTML = html;
  },

  stats(bodyEl, data) {
    if (!data || !data.current) return;
    const cur = data.current;
    const base = data.base || {};
    const statNames = [
      ['STR', 'str', 'realstr'],
      ['INT', 'int', 'realint'],
      ['WIS', 'wis', 'realwis'],
      ['DEX', 'dex', 'realdex'],
      ['CON', 'con', 'realcon'],
      ['CHR', 'chr', 'realchr'],
    ];
    let html = '<table class="stats-table">';
    for (const [label, key, baseKey] of statNames) {
      const c = cur[key] || 0;
      const b = base[baseKey] !== undefined ? base[baseKey] : c;
      let cls = '';
      if (c > b) cls = ' class="stat-up"';
      else if (c < b) cls = ' class="stat-down"';
      html += '<tr><td>' + label + '</td><td' + cls + '>' + c + '</td><td style="color:#484f58">' + b + '</td></tr>';
    }
    html += '</table>';
    bodyEl.innerHTML = html;
  },

  status(bodyEl, data) {
    if (!data) return;
    const displayName = data.fullname || data.name;
    const fields = [
      ['Name', displayName],
      ['Race', data.race],
      ['Class', data.class],
      ['Level', data.level],
      ['XP', typeof data.xp === 'number'
        ? formatInt(data.xp) + (typeof data.nl === 'number' && data.nl > 0
          ? ' (' + formatInt(data.nl) + ' to next)'
          : '')
        : data.xp],
      ['Align', data.align],
      ['Title', formatStatusTitle(data.title, displayName)],
      ['Gender', data.gender],
    ];
    let html = '';
    for (const [k, v] of fields) {
      if (v !== undefined && v !== null && v !== '' && v !== 'None') {
        html += '<div class="status-row"><span class="status-key">' + escHtml(k) + '</span><span>' + escHtml(v) + '</span></div>';
      }
    }
    const badges = [];
    if (data.dead === 'Yes') badges.push('<span class="status-badge badge-dead">Dead</span>');
    if (data.drunk && data.drunk !== 'Sober' && data.drunk !== 'None') badges.push('<span class="status-badge badge-drunk">Drunk</span>');
    if (data.invis === 'Yes') badges.push('<span class="status-badge badge-invis">Invis</span>');
    if (data.sit === 'Yes') badges.push('<span class="status-badge badge-sitting">Sitting</span>');
    if (data.viking === 'Yes') badges.push('<span class="status-badge badge-viking">Viking</span>');
    if (badges.length) html += '<div class="status-badges">' + badges.join('') + '</div>';
    bodyEl.innerHTML = html;
  },

  worth(bodyEl, data) {
    if (!data) return;
    const gold = formatInt(data.gold || 0);
    const bank = formatInt(data.bank || 0);
    bodyEl.innerHTML =
      '<div class="status-row"><span class="status-key">Gold</span><span>' + gold + '</span></div>' +
      '<div class="status-row"><span class="status-key">Bank</span><span>' + bank + '</span></div>';
  },

  buffs(bodyEl, data) {
    if (!Array.isArray(data) || data.length === 0) {
      bodyEl.innerHTML = '<div class="placeholder">No active buffs</div>';
      return;
    }

    let html = '<div class="buff-list">';
    for (const item of data) {
      const kind = item.kind === 'debuff' ? 'debuff' : (item.kind === 'unknown' ? 'unknown' : 'buff');
      const duration = Number(item.duration) || 0;
      const expiresAt = Number(item.expiresAt) || 0;
      const remaining = duration > 0 && expiresAt > 0
        ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))
        : (Number(item.remaining) || 0);
      const pct = duration > 0
        ? Math.max(0, Math.min(100, Math.round((remaining / duration) * 100)))
        : 100;
      const titleParts = [];
      if (item.desc) titleParts.push(item.desc);
      if (duration > 0) titleParts.push(formatDuration(remaining) + ' remaining');
      const desc = titleParts.length ? ' title="' + escHtml(titleParts.join(' - ')) + '"' : '';
      html += '<div class="buff-entry buff-entry-' + kind + '" style="--buff-pct:' + pct + '%"' + desc + '>';
      html += '<span class="buff-entry-fill"></span>';
      html += '<span class="buff-entry-name">' + escHtml(item.name) + '</span>';
      if (duration > 0) {
        html += '<span class="buff-entry-time">' + escHtml(formatDuration(remaining)) + '</span>';
      }
      if (kind === 'debuff') {
        html += '<span class="buff-entry-kind">Debuff</span>';
      }
      html += '</div>';
    }
    html += '</div>';
    bodyEl.innerHTML = html;
  },

  room(bodyEl, data) {
    if (!data || !data.name) return;
    let html = '<div class="room-name">' + escHtml(data.name) + '</div>';
    if (data.area) html += '<div class="room-area">' + escHtml(data.area) + '</div>';
    if (data.environment) html += '<div class="room-env">' + escHtml(data.environment) + '</div>';

    const exits = (data.exits && typeof data.exits === 'object') ? data.exits : {};
    const compassDirs = ['northwest','north','northeast','west',null,'east','southwest','south','southeast'];
    const dirLabels = { northwest:'NW', north:'N', northeast:'NE', west:'W', east:'E', southwest:'SW', south:'S', southeast:'SE', up:'U', down:'D' };

    html += '<div class="exit-compass">';
    for (const dir of compassDirs) {
      if (dir === null) {
        html += '<div></div>';
      } else if (exits[dir] !== undefined) {
        html += '<button class="exit-btn" data-dir="' + dir + '">' + dirLabels[dir] + '</button>';
      } else {
        html += '<div class="exit-btn inactive"></div>';
      }
    }
    html += '</div>';

    if (exits.up !== undefined || exits.down !== undefined) {
      html += '<div class="exit-ud">';
      html += exits.up !== undefined
        ? '<button class="exit-btn" data-dir="up">U</button>'
        : '<div class="exit-btn inactive"></div>';
      html += exits.down !== undefined
        ? '<button class="exit-btn" data-dir="down">D</button>'
        : '<div class="exit-btn inactive"></div>';
      html += '</div>';
    }

    if (Array.isArray(data.players) && data.players.length) {
      html += '<div class="room-players">Players: ';
      html += data.players.map(p => '<span>' + escHtml(p.fullname || p.name) + '</span>').join(', ');
      html += '</div>';
    }

    bodyEl.innerHTML = html;

    bodyEl.querySelectorAll('.exit-btn[data-dir]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
        sendCommandText(btn.dataset.dir);
      });
    });
  },

  inventory(bodyEl, data) {
    if (!data || !Array.isArray(data) || data.length === 0) {
      bodyEl.innerHTML = '<div class="placeholder">Empty</div>';
      return;
    }

    // Preserve active tab
    const activeTab = bodyEl.querySelector('.inv-tab.active');
    const currentTab = activeTab ? activeTab.dataset.tab : 'all';

    // Parse slot from item name parenthetical
    const slotPattern = /\(([^)]+)\)\s*$/;
    const slotMap = {
      'worn on head': 'Head', 'worn around the neck': 'Neck',
      'worn over the shoulders': 'Shoulders', 'worn on body': 'Body',
      'worn on body and legs': 'Body+Legs', 'worn as a full suit of armour': 'FullSuit',
      'worn on hands': 'Hands', 'worn on legs': 'Legs', 'worn on feet': 'Feet',
      'worn on finger': 'Finger', 'used as shield': 'Shield',
      'main weapon': 'Main Weapon', 'secondary weapon': 'Off-hand',
      'used as light': 'Light',
    };

    function cleanName(name) {
      let n = name.replace(/^\*/, '').replace(slotPattern, '').trim();
      return n.charAt(0).toUpperCase() + n.slice(1);
    }

    function getSlot(name) {
      const m = name.match(slotPattern);
      return m ? (slotMap[m[1]] || null) : null;
    }

    // Categorize items
    const wielded = [], worn = [], containers = [], carried = [];
    const slots = {};

    for (const item of data) {
      const clean = cleanName(item.name);
      const slot = getSlot(item.name);
      const entry = { id: item.id, name: clean, attrib: item.attrib, slot: slot, raw: item.name };

      if (item.attrib === 'l') { wielded.push(entry); if (slot) slots[slot] = entry; }
      else if (item.attrib === 'w') { worn.push(entry); if (slot) slots[slot] = entry; }
      else if (item.attrib === 'c') containers.push(entry);
      else carried.push(entry);

      // Handle multi-slot items
      if (slot === 'Body+Legs') { slots['Body'] = entry; slots['Legs'] = entry; }
      if (slot === 'FullSuit') { ['Body','Legs','Head','Hands','Feet'].forEach(s => slots[s] = entry); }
    }

    wielded.sort((a, b) => a.name.localeCompare(b.name));
    worn.sort((a, b) => a.name.localeCompare(b.name));
    containers.sort((a, b) => a.name.localeCompare(b.name));
    carried.sort((a, b) => a.name.localeCompare(b.name));

    // Build tabs
    let html = '<div class="inv-tabs">';
    const tabs = [['all','All'],['worn','Worn'],['wielded','Wielded'],['carried','Carried']];
    for (const [id, label] of tabs) {
      html += '<button class="inv-tab' + (currentTab === id ? ' active' : '') + '" data-tab="' + id + '">' + label + '</button>';
    }
    html += '</div>';

    // All tab
    html += '<div class="inv-tab-content' + (currentTab === 'all' ? ' active' : '') + '" data-tab="all"><div class="inv-list">';
    if (wielded.length) {
      html += '<div class="inv-group-header">WIELDED</div>';
      for (const e of wielded) html += '<div class="inv-item">' + escHtml(e.name) + '</div>';
    }
    if (worn.length) {
      html += '<div class="inv-group-header">WORN</div>';
      for (const e of worn) html += '<div class="inv-item">' + escHtml(e.name) + '</div>';
    }
    if (containers.length) {
      html += '<div class="inv-group-header">CONTAINERS</div>';
      for (const e of containers) html += '<div class="inv-item">' + escHtml(e.name) + '</div>';
    }
    if (carried.length) {
      html += '<div class="inv-group-header">CARRIED</div>';
      for (const e of carried) html += '<div class="inv-item">' + escHtml(e.name) + '</div>';
    }
    html += '</div></div>';

    // Worn tab - paper doll
    html += '<div class="inv-tab-content' + (currentTab === 'worn' ? ' active' : '') + '" data-tab="worn">';
    html += '<div class="inv-paperdoll">';
    const dollSlots = [
      ['Head',null,'Head'],
      ['Neck',null,'Neck'],
      ['Shoulders',null,'Shoulders'],
      ['Body',null,'Body'],
      ['Hands','Shield','Hands / Shield'],
      ['Legs',null,'Legs'],
      ['Feet',null,'Feet'],
      ['Finger',null,'Finger'],
    ];
    for (const [left, right] of dollSlots) {
      if (right) {
        // Two-column row
        html += '<div class="inv-doll-row inv-doll-row-split">';
        html += renderSlot(left, slots[left]);
        html += renderSlot(right, slots[right]);
        html += '</div>';
      } else {
        html += '<div class="inv-doll-row">';
        html += renderSlot(left, slots[left]);
        html += '</div>';
      }
    }
    html += '</div></div>';

    // Wielded tab
    html += '<div class="inv-tab-content' + (currentTab === 'wielded' ? ' active' : '') + '" data-tab="wielded">';
    html += '<div class="inv-wield-list">';
    const wieldSlots = ['Main Weapon', 'Off-hand', 'Shield', 'Light'];
    for (const ws of wieldSlots) {
      const item = slots[ws];
      html += '<div class="inv-wield-slot">';
      html += '<span class="inv-wield-label">' + ws + '</span>';
      html += '<span class="' + (item ? 'inv-wield-item' : 'inv-wield-empty') + '">' + (item ? escHtml(item.name) : 'empty') + '</span>';
      html += '</div>';
    }
    html += '</div></div>';

    // Carried tab
    html += '<div class="inv-tab-content' + (currentTab === 'carried' ? ' active' : '') + '" data-tab="carried"><div class="inv-list">';
    if (containers.length) {
      html += '<div class="inv-group-header">CONTAINERS</div>';
      for (const e of containers) html += '<div class="inv-item">' + escHtml(e.name) + '</div>';
    }
    const carriedAll = carried;
    if (carriedAll.length) {
      if (containers.length) html += '<div class="inv-group-header">ITEMS</div>';
      for (const e of carriedAll) html += '<div class="inv-item">' + escHtml(e.name) + '</div>';
    }
    if (!containers.length && !carriedAll.length) {
      html += '<div class="placeholder">Nothing carried</div>';
    }
    html += '</div></div>';

    bodyEl.innerHTML = html;

    // Tab click handlers
    bodyEl.querySelectorAll('.inv-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        bodyEl.querySelectorAll('.inv-tab').forEach(t => t.classList.remove('active'));
        bodyEl.querySelectorAll('.inv-tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        const content = bodyEl.querySelector('.inv-tab-content[data-tab="' + tab.dataset.tab + '"]');
        if (content) content.classList.add('active');
      });
    });

    function renderSlot(label, item) {
      if (item) {
        return '<div class="inv-doll-slot inv-doll-filled"><div class="inv-doll-slot-label">' + label + '</div><div class="inv-doll-slot-item">' + escHtml(item.name) + '</div></div>';
      }
      return '<div class="inv-doll-slot inv-doll-empty"><div class="inv-doll-slot-label">' + label + '</div><div class="inv-doll-slot-item">empty</div></div>';
    }
  },

  enemy(bodyEl, data) {
    if (!data || !data.enemy_name || data.enemy_name === 'None' || data.enemy_name === '') {
      bodyEl.innerHTML = '<div class="panel-inactive placeholder">No target</div>';
      bodyEl._enemyState = null;
      return;
    }

    const prev = bodyEl._enemyState || {};
    const sameEnemy = prev.name === data.enemy_name;
    const sameImage = prev.image === (data.enemy_image || '');

    // Fast path: same enemy + same image — just update bars in place
    if (sameEnemy && sameImage) {
      renderVitalBar(bodyEl, 'HP', data.enemy_curhp, data.enemy_maxhp || 100);
      if (data.enemy_maxsp > 0) {
        renderVitalBar(bodyEl, 'SP', data.enemy_cursp, data.enemy_maxsp);
      }
      const hpStr = bodyEl.querySelector('.enemy-hp-string');
      if (hpStr && data.enemy_hp_string && data.enemy_hp_string !== 'None') {
        hpStr.textContent = data.enemy_hp_string;
      }
      return;
    }

    // Full rebuild
    bodyEl.innerHTML = '';
    bodyEl._enemyState = { name: data.enemy_name, image: data.enemy_image || '' };

    const row = document.createElement('div');
    row.className = 'enemy-row';

    // Left: image
    if (data.enemy_image) {
      const imgWrap = document.createElement('div');
      imgWrap.className = 'enemy-image';
      const img = document.createElement('img');
      img.src = data.enemy_image;
      img.alt = data.enemy_name;
      img.draggable = false;
      img.addEventListener('load', () => imgWrap.classList.add('enemy-image-loaded'));
      img.addEventListener('error', () => imgWrap.classList.add('enemy-image-error'));
      imgWrap.appendChild(img);
      row.appendChild(imgWrap);
    }

    // Right: name, hp string, vitals
    const info = document.createElement('div');
    info.className = 'enemy-info';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'enemy-name';
    nameDiv.textContent = data.enemy_name;
    info.appendChild(nameDiv);

    if (data.enemy_hp_string && data.enemy_hp_string !== 'None') {
      const hpStr = document.createElement('div');
      hpStr.className = 'enemy-hp-string';
      hpStr.textContent = data.enemy_hp_string;
      info.appendChild(hpStr);
    }

    renderVitalBar(info, 'HP', data.enemy_curhp, data.enemy_maxhp || 100);
    if (data.enemy_maxsp > 0) {
      renderVitalBar(info, 'SP', data.enemy_cursp, data.enemy_maxsp);
    }

    row.appendChild(info);
    bodyEl.appendChild(row);
  },

  group(bodyEl, data) {
    if (!data || data === '' || (typeof data === 'object' && (!data.members || data.members.length === 0))) {
      bodyEl.innerHTML = '<div class="placeholder">Not in a group</div>';
      return;
    }
    let html = '<div class="group-header">';
    html += '<strong>' + escHtml(data.groupname || 'Group') + '</strong>';
    if (data.leader) html += ' &middot; Leader: ' + escHtml(data.leader);
    if (data.count) html += ' &middot; ' + data.count + ' members';
    html += '</div>';

    if (Array.isArray(data.members)) {
      for (const m of data.members) {
        const info = m.info || {};
        const here = info.here === 'Yes';
        html += '<div class="group-member' + (here ? '' : ' group-member-away') + '">';
        html += '<span class="group-member-name">' + escHtml(m.name) + '</span>';
        html += ' <span style="color:#484f58">Lv' + (info.lvl || '?') + '</span>';
        const hpPct = info.maxhp > 0 ? Math.round((info.hp / info.maxhp) * 100) : 0;
        html += '<div class="group-mini-bar"><div class="group-mini-bar-fill" style="width:' + hpPct + '%;background:' + vitalBarColor(hpPct) + '"></div></div>';
        html += '</div>';
      }
    }
    bodyEl.innerHTML = html;
  },

  chat(bodyEl, data) {
    if (!data || !Array.isArray(data) || data.length === 0) {
      bodyEl.innerHTML = '<div class="placeholder">No messages</div>';
      return;
    }
    let log = bodyEl.querySelector('.chat-log');
    const wasAtBottom = log ? (log.scrollHeight - log.scrollTop - log.clientHeight) < 5 : true;

    if (!log) {
      log = document.createElement('div');
      log.className = 'chat-log';
      bodyEl.innerHTML = '';
      bodyEl.appendChild(log);
    }

    const existing = log.childNodes.length;
    const toRender = data.slice(existing);

    for (const msg of toRender) {
      const entry = document.createElement('div');
      entry.className = 'chat-entry';
      const ch = channelColor(msg.channel || '');
      const talker = msg.talker ? msg.talker.charAt(0).toUpperCase() + msg.talker.slice(1) : '';
      // Strip redundant prefix from text — the panel already shows channel and talker
      let text = msg.text || '';
      // Patterns: "[Channel] Name: text", "[Channel] (Role) Name: text", "Name shouts: text"
      const talkerEsc = (msg.talker || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (talkerEsc) {
        // Strip everything up to and including "TalkerName: " or "TalkerName shouts: "
        const re = new RegExp('^(\\[\\S+\\]\\s+)?(\\(\\w+\\)\\s+)?' + talkerEsc + '(\\s+\\w+)?:\\s*', 'i');
        text = text.replace(re, '');
      }
      entry.innerHTML = '<span class="chat-channel" style="color:' + ch + '">[' + escHtml(msg.channel) + ']</span> '
        + '<span class="chat-talker">' + escHtml(talker) + ':</span> '
        + escHtml(text);
      log.appendChild(entry);
    }

    while (log.childNodes.length > 200) log.removeChild(log.firstChild);

    if (wasAtBottom) log.scrollTop = log.scrollHeight;
  },

  map(bodyEl, _data) {
    renderMap(bodyEl);
  },

  quests(bodyEl, data) {
    if (!data) {
      bodyEl.innerHTML = '<div class="placeholder">No quest data</div>';
      return;
    }

    var html = '';
    var active = data.active;
    var list = data.list;

    // Active quest detail
    if (active && active.name) {
      html += '<div class="quest-active">';
      html += '<div class="quest-active-name">' + escHtml(active.name) + '</div>';
      if (active.description) {
        html += '<div class="quest-active-desc">' + escHtml(active.description) + '</div>';
      }
      if (Array.isArray(active.objectives)) {
        for (var i = 0; i < active.objectives.length; i++) {
          var obj = active.objectives[i];
          var pct = obj.required > 0 ? Math.round((obj.current / obj.required) * 100) : 0;
          if (pct > 100) pct = 100;
          var done = obj.status === 'finished';
          html += '<div class="quest-obj">';
          html += '<div class="quest-obj-name">' + (done ? '&#10003; ' : '') + escHtml(obj.name) + '</div>';
          html += '<div class="quest-obj-progress">';
          html += '<div class="quest-bar"><div class="quest-bar-fill' + (done ? ' quest-bar-done' : '') + '" style="width:' + pct + '%"></div></div>';
          html += '<span class="quest-obj-count">' + obj.current + '/' + obj.required + '</span>';
          html += '</div></div>';
        }
      }
      html += '</div>';
    }

    // Quest list
    if (Array.isArray(list) && list.length > 0) {
      html += '<div class="quest-list">';
      html += '<div class="quest-list-header">Quests</div>';
      for (var j = 0; j < list.length; j++) {
        var q = list[j];
        var isActive = q.active === 1;
        var cls = 'quest-list-item';
        if (isActive) cls += ' quest-list-active';
        if (q.status === 'Finished') cls += ' quest-list-done';
        var qPct = q.total > 0 ? Math.round((q.current / q.total) * 100) : 0;
        if (qPct > 100) qPct = 100;
        html += '<div class="' + cls + '">';
        html += '<div class="quest-list-name">' + escHtml(q.name) + '</div>';
        html += '<div class="quest-list-info">';
        html += '<span class="quest-list-status">' + escHtml(q.status) + '</span>';
        html += '<div class="quest-bar quest-bar-sm"><div class="quest-bar-fill' + (q.status === 'Finished' ? ' quest-bar-done' : '') + '" style="width:' + qPct + '%"></div></div>';
        html += '</div></div>';
      }
      html += '</div>';
    } else if (!active || !active.name) {
      html += '<div class="placeholder">No quests accepted</div>';
    }

    bodyEl.innerHTML = html;
  },

  achievements(bodyEl, data) {
    var html;
    var summary;
    var families;
    var nextUps;

    if (!data) {
      bodyEl.innerHTML = '<div class="placeholder">No achievement data</div>';
      return;
    }

    summary = data.summary || {};
    families = Array.isArray(data.families) ? data.families : [];
    nextUps = families
      .filter(family => family && family.nextTierThreshold)
      .map(family => {
        var currentValue = Number(family.currentValue) || 0;
        var nextThreshold = Number(family.nextTierThreshold) || 0;
        var progressPct = nextThreshold > 0 ? Math.round((currentValue / nextThreshold) * 100) : 0;
        if (progressPct > 100) progressPct = 100;
        if (progressPct < 0) progressPct = 0;
        return { family, progressPct, remaining: Math.max(nextThreshold - currentValue, 0) };
      })
      .sort((a, b) => {
        if (b.progressPct !== a.progressPct) return b.progressPct - a.progressPct;
        return a.remaining - b.remaining;
      })
      .slice(0, 3);

    html = '<div class="ach-summary">';
    html += '<div class="ach-summary-grid">';
    html += '<div class="ach-summary-item"><span class="ach-summary-label">Unlocked</span><span class="ach-summary-value">'
      + (summary.unlockedTierCount || 0) + '/' + (summary.totalTierCount || 0) + '</span></div>';
    html += '<div class="ach-summary-item"><span class="ach-summary-label">Completed</span><span class="ach-summary-value">'
      + (summary.completedFamilyCount || 0) + '/' + (summary.totalFamilyCount || 0) + '</span></div>';
    html += '<div class="ach-summary-item"><span class="ach-summary-label">Rank</span><span class="ach-summary-value">'
      + (summary.leaderboardRank || 'Unranked') + '</span></div>';
    html += '</div>';
    html += '<div class="ach-equipped">Equipped: '
      + escHtml(summary.equippedTitle && summary.equippedTitle.title
        ? summary.equippedTitle.title
        : 'None')
      + '</div>';
    html += '<div class="ach-panel-note">Use <code>achievements</code> to open the full journal.</div>';
    html += '</div>';

    if (!nextUps.length) {
      html += '<div class="placeholder">No achievement milestones in progress.</div>';
      bodyEl.innerHTML = html;
      return;
    }

    html += '<div class="ach-section">';
    html += '<div class="ach-section-title">Closest Milestones</div>';

    for (var i = 0; i < nextUps.length; i++) {
      var item = nextUps[i];
      var fam = item.family;
      var currentValue = Number(fam.currentValue) || 0;
      var nextThreshold = Number(fam.nextTierThreshold) || 0;

      html += '<div class="ach-compact-item">';
      html += '<div class="ach-compact-head">';
      html += '<div class="ach-family-name">' + escHtml(fam.name) + '</div>';
      html += '<div class="ach-family-value">' + currentValue.toLocaleString() + '</div>';
      html += '</div>';
      html += '<div class="ach-compact-next">Next: ' + escHtml(fam.nextTierKey || '')
        + ' · ' + currentValue.toLocaleString() + '/' + nextThreshold.toLocaleString() + '</div>';
      html += '<div class="quest-bar"><div class="quest-bar-fill" style="width:' + item.progressPct + '%"></div></div>';
      html += '</div>';
    }
    html += '</div>';

    bodyEl.innerHTML = html;
  },
};
