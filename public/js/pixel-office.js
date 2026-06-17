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
  { x: 890, y: 60, w: 70, h: 60 },
  { x: 0, y: 280, w: 120, h: 110 },
  { x: 0, y: 460, w: 310, h: 250 },
  { x: 330, y: 310, w: 290, h: 270 },
  { x: 700, y: 380, w: 265, h: 320 },
  { x: 0, y: 0, w: 960, h: 70 },
];

var REST_SPOTS = [
  { x: 800, y: 370 }, { x: 750, y: 410 }, { x: 340, y: 450 },
  { x: 340, y: 510 }, { x: 870, y: 320 }, { x: 200, y: 340 },
  { x: 700, y: 310 }, { x: 150, y: 400 },
];

var STANDING_POSITIONS = [
  { x: 60, y: 590 }, { x: 170, y: 590 }, { x: 280, y: 590 },
  { x: 390, y: 590 }, { x: 500, y: 590 }, { x: 610, y: 590 },
];

function isInCurrentTask(agentId) {
  if (!currentTaskId || !tasks) return false;
  for (var i = 0; i < tasks.length; i++) {
    if (tasks[i].id === currentTaskId) {
      var p = tasks[i].participants;
      if (!p || p.length === 0) return true;
      return p.indexOf(agentId) >= 0;
    }
  }
  return false;
}

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
function getWalkSpeed() { return parseInt(localStorage.getItem("hub_agent_speed")) || 20; }

function findPath(x1, y1, x2, y2) {
  var sz = 44;
  var samples = 6;
  function segOk(ax, ay, bx, by) {
    for (var i = 1; i < samples; i++) {
      var t = i / samples;
      if (!isWalkable(ax + (bx - ax) * t, ay + (by - ay) * t, sz)) return false;
    }
    return true;
  }
  if (segOk(x1, y1, x2, y2)) return [{ x: x2, y: y2 }];
  // Try routing through each rest spot
  for (var r = 0; r < REST_SPOTS.length; r++) {
    var rs = REST_SPOTS[r];
    if (segOk(x1, y1, rs.x, rs.y) && segOk(rs.x, rs.y, x2, y2))
      return [{ x: rs.x, y: rs.y }, { x: x2, y: y2 }];
  }
  // Try center, corners, then random
  var tries = [
    { x: (x1 + x2) / 2, y: (y1 + y2) / 2 },
    { x: x1, y: (y1 + y2) / 2 }, { x: (x1 + x2) / 2, y: y1 },
    { x: x2, y: (y1 + y2) / 2 }, { x: (x1 + x2) / 2, y: y2 },
  ];
  for (var i = 0; i < 50; i++) {
    var wp = i < tries.length ? tries[i] : {
      x: x1 + (x2 - x1) * (0.25 + Math.random() * 0.5),
      y: y1 + (y2 - y1) * (0.25 + Math.random() * 0.5)
    };
    if (isWalkable(wp.x, wp.y, sz) && segOk(x1, y1, wp.x, wp.y) && segOk(wp.x, wp.y, x2, y2))
      return [{ x: wp.x, y: wp.y }, { x: x2, y: y2 }];
  }
  // Last resort: try rest spot closest to midpoint
  var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  var best = REST_SPOTS[0];
  var bestDist = Infinity;
  for (var r = 0; r < REST_SPOTS.length; r++) {
    var d2 = (REST_SPOTS[r].x - mx) * (REST_SPOTS[r].x - mx) + (REST_SPOTS[r].y - my) * (REST_SPOTS[r].y - my);
    if (d2 < bestDist) { bestDist = d2; best = REST_SPOTS[r]; }
  }
  if (segOk(x1, y1, best.x, best.y) && segOk(best.x, best.y, x2, y2))
    return [{ x: best.x, y: best.y }, { x: x2, y: y2 }];
  return [{ x: x2, y: y2 }];
}
function walkSegment(id, waypoints, idx) {
  var w = activeWalkers[id];
  if (!w) return;
  if (idx >= waypoints.length) {
    var target = waypoints[waypoints.length - 1];
    w.x = target.x; w.y = target.y;
    var isRestSpot = REST_SPOTS.some(function(s) { return Math.abs(s.x - target.x) < 30 && Math.abs(s.y - target.y) < 30; });
    var pause = isRestSpot ? (5000 + Math.random() * 5000) : (2000 + Math.random() * 3000);
    if (isRestSpot) {
      setTimeout(function() {
        if (activeWalkers[id]) w.el.querySelector('.sprite-sheet').src = '/office-assets/' + w.prefix + '-walk-down.png';
      }, 200);
    }
    w.moveTimer = setTimeout(function() { moveWalkerById(id); }, pause);
    return;
  }
  var pt = waypoints[idx];
  var dx = pt.x - w.x, dy = pt.y - w.y;
  var dist = Math.sqrt(dx*dx + dy*dy);
  if (dist < 10) { walkSegment(id, waypoints, idx + 1); return; }
  var speed = getWalkSpeed();
  var dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  var segDuration = dist / speed;
  var animDur = Math.max(0.1, 20 / speed);
  var sheet = w.el.querySelector('.sprite-sheet');
  sheet.src = '/office-assets/' + w.prefix + '-' + dirMap[dir] + '.png';
  // Reset and restart animation with synced speed
  sheet.style.animation = 'none';
  sheet.offsetHeight;
  sheet.style.animation = 'walk-cycle ' + animDur + 's steps(6) infinite';
  w.el.style.transitionDuration = segDuration + 's';
  requestAnimationFrame(function() {
    w.el.style.left = pt.x + 'px';
    w.el.style.top = pt.y + 'px';
  });
  w.x = pt.x; w.y = pt.y;
  w.moveTimer = setTimeout(function() { walkSegment(id, waypoints, idx + 1); }, segDuration * 1000 + 50);
}

function moveWalkerById(id) {
  var w = activeWalkers[id];
  if (!w) return;
  var target = randomWalkablePoint();
  var dx = target.x - w.x, dy = target.y - w.y;
  var dist = Math.sqrt(dx*dx + dy*dy);
  if (dist < 20) { w.moveTimer = setTimeout(function() { moveWalkerById(id); }, 1000); return; }
  var path = findPath(w.x, w.y, target.x, target.y);
  walkSegment(id, path, 0);
}function startWalkers() {
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
  var task = a.role || t("agent_idle");
  if (a.online !== false) {
    status = 'idle';
    var dot = document.getElementById('dot-' + a.id);
    if (dot) {
      if (dot.classList.contains('thinking')) { status = 'busy'; task = t("agent_thinking"); }
      else if (dot.classList.contains('online')) status = 'online';
      else if (dot.classList.contains('offline')) status = 'offline';
    }
  }
  return { status: status, task: task };
}

function renderFurniture() {
  var hall = document.getElementById("hallContent");
  if (!hall || hall.querySelector("#furniture-layer")) return;
  var layer = document.createElement("div");
  layer.id = "furniture-layer";
  layer.innerHTML =
    '<img class="deco" src="/office-assets/plant.png" style="left:16px;top:56px;width:40px;height:40px;">' +
    '<img class="deco" src="/office-assets/plant.png" style="left:896px;top:56px;width:40px;height:40px;">' +
    '<img class="deco" src="/office-assets/office-partitions-1.png" style="left:16px;top:300px;width:88px;height:88px;">' +
    '<img class="deco" src="/office-assets/cabinet.png" style="left:10px;top:535px;width:160px;height:160px;">' +
    '<img class="deco" src="/office-assets/printer.png" style="left:220px;top:608px;width:72px;height:72px;">' +
    '<img class="deco" src="/office-assets/writing-table.png" style="left:360px;top:320px;width:240px;height:240px;">' +
    '<img class="deco" src="/office-assets/chair.png" style="left:330px;top:400px;width:40px;height:40px;">' +
    '<img class="deco" src="/office-assets/chair.png" style="left:330px;top:470px;width:40px;height:40px;">' +
    '<img class="deco" src="/office-assets/sink.png" style="left:760px;top:400px;width:150px;height:150px;">' +
    '<img class="deco" src="/office-assets/water-cooler.png" style="left:610px;top:615px;width:50px;height:80px;">' +
    '<img class="deco" src="/office-assets/coffee-maker.png" style="left:740px;top:535px;width:160px;height:160px;">';
  hall.appendChild(layer);
}

function renderPixelOffice() {
  renderFurniture();
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
    // Task participation filter - non-participants show as offline
    if (isIdle && !isInCurrentTask(a.id)) {
      isIdle = false;
      isOffline = true;
      mapped.task = '—';
    }
    if (isIdle) idleAgents.push(a);

    var spritePrefix = SPRITE_MAP[a.id] || SPRITE_DEFAULTS[i % SPRITE_DEFAULTS.length];

    var cls = isOffline ? 'st-offline' : (isBusy ? 'st-busy' : 'st-idle');

    var ws = document.createElement('div');
    ws.className = 'workstation' + (isBusy ? ' busy' : '') + (isIdle ? ' idle' : '') + (isOffline ? ' offline' : '');
    ws.style.left = pos.left + 'px';
    ws.style.top = pos.top + 'px';
    ws.style.width = '128px';
    ws.style.height = '160px';

    var charHtml = '';
    if (isBusy) {
      charHtml = '<div class="char-container seated"><img class="char-sprite" src="/office-assets/' + esc(spritePrefix) + '-walk-up.png" style="width:384px;"></div>';
    }

    ws.innerHTML =
      '<div class="status-dot ' + cls + '"></div>' +
      charHtml +
      '<img class="desk-img" src="/office-assets/desk-with-pc.png">' +
      '<div class="label">' + esc(a.name) + '</div>' +
      '<div class="task-bubble">' + esc(mapped.task) + '</div>';
    container.appendChild(ws);
  });

  // Walkers - filter by task participation
  var participantIdle = [];
  var nonParticipantIdle = [];
  idleAgents.forEach(function(a) {
    if (isInCurrentTask(a.id)) { participantIdle.push(a); }
    else { nonParticipantIdle.push(a); }
  });

  var currentIds = {};
  participantIdle.forEach(function(a) { currentIds[a.id] = true; });

  for (var id in activeWalkers) {
    if (!activeWalkers.hasOwnProperty(id)) continue;
    if (!currentIds[id]) { activeWalkers[id].el.remove(); delete activeWalkers[id]; }
  }

  participantIdle.forEach(function(a) {
    if (activeWalkers[a.id]) return;
    var prefix = SPRITE_MAP[a.id] || SPRITE_DEFAULTS[0];
    var start = randomWalkablePoint();
    var el = document.createElement('div');
    el.className = 'walker';
    el.style.left = start.x + 'px';
    el.style.top = start.y + 'px';
    el.innerHTML =
      '<img class="sprite-sheet" src="/office-assets/' + prefix + '-walk-right.png" style="width:384px;">' +
      '<div class="walker-label">' + esc(a.name) + '</div>';
    walkersContainer.appendChild(el);
    activeWalkers[a.id] = { el: el, prefix: prefix, x: start.x, y: start.y, moveTimer: null };
  });

  // Standing non-participant idle agents at bottom
  var standingContainer = document.getElementById('standing-container');
  if (!standingContainer) {
    standingContainer = document.createElement('div');
    standingContainer.id = 'standing-container';
    standingContainer.style.cssText = 'position:absolute;bottom:0;left:0;width:100%;height:100px;z-index:8;pointer-events:none;';
    document.getElementById('hallContent').appendChild(standingContainer);
  }
  standingContainer.innerHTML = '';
  nonParticipantIdle.forEach(function(a, si) {
    var pos = STANDING_POSITIONS[si] || { x: 60 + (si - STANDING_POSITIONS.length) * 110, y: 590 };
    var prefix = SPRITE_MAP[a.id] || SPRITE_DEFAULTS[0];
    var el = document.createElement('div');
    el.className = 'standing-agent';
    el.style.cssText = 'position:absolute;left:' + pos.x + 'px;top:' + pos.y + 'px;width:64px;height:80px;text-align:center;';
    el.innerHTML =
      '<img class="standing-sprite" src="/office-assets/' + prefix + '-walk-down.png" style="width:384px;image-rendering:pixelated;">' +
      '<div class="standing-label" style="font-size:10px;color:#999;margin-top:-4px;">' + esc(a.name) + '</div>';
    standingContainer.appendChild(el);
  });

  startWalkers();
}

