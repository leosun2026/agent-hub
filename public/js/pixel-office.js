// Pixel Office renderer (adapted from openclaw-virtual-office)
// Uses global 'agents' array from Agent Hub API
// Resource paths: /office-assets/

function esc(str) {
  var d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

var SPRITE_MAP = {
  'hermes-main': 'agent-boss',
  'hermes-writer': 'agent-tech',
  'openclaw-feishu-service': 'agent-admin',
  'openclaw-feishu-ops': 'agent-listing',
  'codex': 'agent-marketing',
};

var SPRITE_DEFAULTS = ['agent-boss','agent-tech','agent-admin','agent-listing','agent-marketing'];

var DESK_POSITIONS = [
  { left: 60,  top: 80 },
  { left: 210, top: 80 },
  { left: 360, top: 80 },
  { left: 510, top: 80 },
  { left: 660, top: 80 },
  { left: 810, top: 80 },
];

var OBSTACLES = [
  { x: 40, y: 60, w: 900, h: 200 },
  { x: 0, y: 60, w: 70, h: 60 },
  { x: 880, y: 60, w: 80, h: 60 },
  { x: 0, y: 280, w: 120, h: 110 },
  { x: 0, y: 400, w: 240, h: 160 },
  { x: 330, y: 310, w: 280, h: 260 },
  { x: 810, y: 430, w: 110, h: 110 },
  { x: 725, y: 465, w: 70, h: 110 },
  { x: 880, y: 370, w: 80, h: 80 },
  { x: 270, y: 430, w: 65, h: 130 },
  { x: 0, y: 0, w: 960, h: 70 },
];

var REST_SPOTS = [
  { x: 800, y: 370 }, { x: 750, y: 410 }, { x: 340, y: 450 },
  { x: 340, y: 510 }, { x: 870, y: 320 }, { x: 200, y: 340 },
  { x: 700, y: 310 }, { x: 150, y: 400 },
];

function isWalkable(x, y, size) {
  size = size || 64;
  if (x < 10 || x + size > 950 || y < 70 || y + size > 570) return false;
  for (var i = 0; i < OBSTACLES.length; i++) {
    var o = OBSTACLES[i];
    if (x + size > o.x && x < o.x + o.w && y + size > o.y && y < o.y + o.h) return false;
  }
  return true;
}

function randomWalkablePoint() {
  if (Math.random() < 0.7) {
    var spot = REST_SPOTS[Math.floor(Math.random() * REST_SPOTS.length)];
    return { x: spot.x + (Math.random() - 0.5) * 20, y: spot.y + (Math.random() - 0.5) * 20 };
  }
  for (var i = 0; i < 50; i++) {
    var x = 30 + Math.random() * 880;
    var y = 270 + Math.random() * 250;
    if (isWalkable(x, y)) return { x: x, y: y };
  }
  return { x: 300, y: 320 };
}

var activeWalkers = {};
var dirMap = { right: 'walk-right', left: 'walk-left', down: 'walk-down', up: 'walk-up' };
var WALK_SPEED = 20;

function moveWalkerById(id) {
  var w = activeWalkers[id];
  if (!w) return;
  var target = randomWalkablePoint();
  var dx = target.x - w.x, dy = target.y - w.y;
  var dist = Math.sqrt(dx*dx + dy*dy);
  if (dist < 20) { w.moveTimer = setTimeout(function() { moveWalkerById(id); }, 1000); return; }
  var dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  var duration = dist / WALK_SPEED;
  w.el.querySelector('.sprite-sheet').src = '/office-assets/' + w.prefix + '-' + dirMap[dir] + '.png';
  w.el.style.transitionDuration = duration + 's';
  requestAnimationFrame(function() {
    w.el.style.left = target.x + 'px';
    w.el.style.top = target.y + 'px';
  });
  w.x = target.x; w.y = target.y;
  var isRestSpot = REST_SPOTS.some(function(s) { return Math.abs(s.x - target.x) < 30 && Math.abs(s.y - target.y) < 30; });
  var pause = isRestSpot ? (5000 + Math.random() * 5000) : (2000 + Math.random() * 3000);
  if (isRestSpot) {
    setTimeout(function() {
      if (activeWalkers[id]) w.el.querySelector('.sprite-sheet').src = '/office-assets/' + w.prefix + '-walk-down.png';
    }, duration * 1000 + 200);
  }
  w.moveTimer = setTimeout(function() { moveWalkerById(id); }, duration * 1000 + pause);
}

function startWalkers() {
  var delay = 0;
  for (var id in activeWalkers) {
    if (!activeWalkers.hasOwnProperty(id)) continue;
    var w = activeWalkers[id];
    if (w.moveTimer) clearTimeout(w.moveTimer);
    (function(id) { setTimeout(function() { moveWalkerById(id); }, delay); })(id);
    delay += 800;
  }
}

// Map Agent Hub agent to pixel office agent format
function mapAgentStatus(a) {
  var status = 'offline';
  var task = a.role || '闲置中';
  if (a.online !== false) {
    status = 'idle'; // default online = idle
    // Check dot status from sidebar
    var dot = document.getElementById('dot-' + a.id);
    if (dot && dot.classList.contains('online')) status = 'online';
    if (dot && dot.classList.contains('offline')) status = 'offline';
  }
  return { status: status, task: task };
}

function renderPixelOffice() {
  var container = document.getElementById('agents-container');
  var walkersContainer = document.getElementById('walkers-container');
  if (!container || !walkersContainer) return;
  if (!agents || !agents.length) { setTimeout(renderPixelOffice, 500); return; }

  container.innerHTML = '';
  var idleAgents = [];

  agents.forEach(function(a, i) {
    var pos = DESK_POSITIONS[i] || { left: 60 + i * 170, top: 100 };
    var mapped = mapAgentStatus(a);
    var isOffline = mapped.status === 'offline';
    var isBusy = mapped.status === 'busy';
    var isIdle = mapped.status === 'idle' || mapped.status === 'online';
    if (isIdle) idleAgents.push(a);

    var spritePrefix = SPRITE_MAP[a.id] || SPRITE_DEFAULTS[i % SPRITE_DEFAULTS.length];

    var cls = isOffline ? 'st-offline' : (isBusy ? 'st-busy' : 'st-idle');

    var ws = document.createElement('div');
    ws.className = 'workstation' + (isBusy ? ' busy' : '') + (isIdle ? ' idle' : '') + (isOffline ? ' offline' : '');
    ws.style.left = pos.left + 'px';
    ws.style.top = pos.top + 'px';

    ws.innerHTML =
      '<img class="desk-img" src="/office-assets/desk-with-pc.png">' +
      (isBusy ? '<div class="char-container seated"><img class="char-sprite" src="/office-assets/' + esc(spritePrefix) + '-walk-up.png" style="width:384px;"></div>' : '') +
      '<div class="status-dot ' + cls + '"></div>' +
      '<div class="label">' + esc(a.name) + '</div>' +
      '<div class="task-bubble">' + esc(mapped.task) + '</div>';
    container.appendChild(ws);
  });

  // Walkers
  var currentIds = {};
  idleAgents.forEach(function(a) { currentIds[a.id] = true; });

  for (var id in activeWalkers) {
    if (!activeWalkers.hasOwnProperty(id)) continue;
    if (!currentIds[id]) { activeWalkers[id].el.remove(); delete activeWalkers[id]; }
  }

  idleAgents.forEach(function(a) {
    if (activeWalkers[a.id]) return;
    var prefix = SPRITE_MAP[a.id] || SPRITE_DEFAULTS[0];
    var start = randomWalkablePoint();
    var el = document.createElement('div');
    el.className = 'walker';
    el.style.left = start.x + 'px';
    el.style.top = start.y + 'px';
    el.innerHTML =
      '<img class="sprite-sheet" src="/office-assets/' + prefix + '-walk-right.png" style="width:384px;">';
    walkersContainer.appendChild(el);
    activeWalkers[a.id] = { el: el, prefix: prefix, x: start.x, y: start.y, moveTimer: null };
  });

  startWalkers();
}
