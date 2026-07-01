// Agent Hub Server v0.2.0 — Dynamic member management + Group chat
// Core: message broadcast to all room agents with permission filtering

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const LOG_FILE = path.join(__dirname, 'hub.log');
;
const { setupRoutes } = require('./src/routes');
const { saveMessage, getMessages, getDb, getRoom, getTask, syncAgentsToDb, listAgentsFromDb, createTask, listTasks } = require('./src/db');
const { callAgent, getAgent, listAgents, setInMemoryProperty } = require('./src/agents');
const {
  initDefaultRoom,
  getRoomAgents,
  buildGroupChatMessages,
  isAgentMentioned,
  isMentionAll,
  getSenderLabel,
} = require('./src/rooms');


// Load .env file for auth tokens
const dotenv = require('dotenv');
dotenv.config();

const PORT = 3457;
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, 'public')));

setupRoutes(app, io);

// ============ Anti-spam & dedup ============

const agentLastReply = {};
let stopBroadcast = false;
const MIN_REPLY_INTERVAL = 3000;
const recentReplies = [];
const DEDUP_WINDOW = 5000;
const MAX_RECENT_REPLIES = 50;

function canAgentReply(agentId) {
  const last = agentLastReply[agentId] || 0;
  return (Date.now() - last) >= MIN_REPLY_INTERVAL;
}

function recordAgentReply(agentId) {
  agentLastReply[agentId] = Date.now();
}

function isDuplicateReply(agentId, content) {
  const now = Date.now();
  while (recentReplies.length > 0 && (now - recentReplies[0].timestamp) > DEDUP_WINDOW) {
    recentReplies.shift();
  }
  const hash = agentId + '|' + (content || '').slice(0, 100).trim();
  const dup = recentReplies.some(r => r.hash === hash);
  if (!dup) {
    recentReplies.push({ agentId, hash, timestamp: now });
    if (recentReplies.length > MAX_RECENT_REPLIES) recentReplies.shift();
  }
  return dup;
}


// ============ Agent reply: build reply-to context (NEW) ============

function buildReplyContext(currentContent, previousMessages) {
  // Find the last non-system, non-current-agent message as reply target
  for (let i = previousMessages.length - 1; i >= 0; i--) {
    const msg = previousMessages[i];
    if (msg.role !== 'system' && msg.content !== currentContent) {
      return getSenderLabel(msg.agent_id);
    }
  }
  return null;
}

// ============ Call agent and broadcast reply ============

async function askAgent(agentId, userMessage, taskId, roomId) {
  const agent = getAgent(agentId);
  if (!agent || !agent.endpoint) return null;

  // Throttle check
  if (!canAgentReply(agentId)) {
    console.log('[Throttle] Agent ' + agentId + ' is cooling down, skipping');
    writeLog('WARN', '[Throttle] Agent ' + agentId + ' is cooling down, skipping');
    return null;
  }

  try {
    io.emit('agent:state', { agentId: agentId, state: 'thinking' });

    const result = await callAgent(agentId, [
      { role: 'user', content: userMessage }
    ]);

    const content = (result.content || '').trim();
    if (content === '[SILENT]' || content.startsWith('[SILENT]') || content === '' || content.startsWith('No response from OpenClaw')) {
      console.log('[Silent] Agent ' + agentId + ' chose to be silent');
      writeLog('INFO', '[Silent] Agent ' + agentId + ' chose to be silent');
      io.emit('agent:state', { agentId: agentId, state: 'idle' });
      return { agentId, silent: true };
    }

    if (stopBroadcast) { io.emit("agent:state", { agentId: agentId, state: "idle" }); return null; }
    if (isDuplicateReply(agentId, content)) {
      console.log('[Dedup] Agent ' + agentId + ' duplicate reply, skipping');
      writeLog('WARN', '[Dedup] Agent ' + agentId + ' duplicate reply, skipping');
      io.emit('agent:state', { agentId: agentId, state: 'idle' });
      return { agentId, duplicate: true };
    }

    recordAgentReply(agentId);

    const msg = saveMessage({
      task_id: taskId || null,
      room_id: roomId || null,
      agent_id: agentId,
      role: 'agent',
      content: content,
    });

    io.emit('chat:message', {
      id: msg.id,
      room_id: roomId || null,
      agent_id: agentId,
      role: 'agent',
      content: content,
      created_at: new Date().toISOString()
    });
    io.emit('agent:state', { agentId: agentId, state: 'idle' });

    return result;
  } catch (err) {
    var errMsg = err.message || '';
    var noisePatterns = ['No response from OpenClaw', '[SILENT]'];
    var isNoise = noisePatterns.some(function(p) { return errMsg.indexOf(p) >= 0; });
    if (isNoise) {
      console.log('[Silent] Agent ' + agentId + ' chose to be silent (' + errMsg.substring(0, 80) + ')');
      writeLog('INFO', '[Silent] Agent ' + agentId + ' chose to be silent');
      io.emit('agent:state', { agentId: agentId, state: 'idle' });
      return { agentId, silent: true };
    }
    console.error('Agent ' + agentId + ' error:', errMsg);
    writeLog('ERROR', 'Agent ' + agentId + ' error: ' + errMsg);
    var savedMsg = saveMessage({
      task_id: taskId || null,
      room_id: roomId || null,
      agent_id: agentId,
      role: 'agent',
      content: '[Error] ' + errMsg,
    });
    io.emit('chat:message', {
      id: savedMsg.id,
      room_id: roomId || null,
      agent_id: agentId,
      role: 'agent',
      content: '[Error] ' + errMsg,
      created_at: new Date().toISOString()
    });
    io.emit('agent:state', { agentId: agentId, state: 'idle' });
    return null;
  }
}

// ============ Broadcast to all agents in room (core logic — enhanced) ============

async function broadcastToRoom(roomId, senderId, senderName, content, taskId, depth, eligibleAgentIds) {
  if (depth === undefined) depth = 0;
    if (stopBroadcast) { return; }
  const room = getRoom(roomId);
  if (!room) {
    console.log('[Broadcast] Room not found:', roomId);
    writeLog('WARN', '[Broadcast] Room not found: ' + roomId)
    return;
  }

  // When user @mentions a specific agent (not @all/@everyone), switch to mention-only
  const isUserMessage = senderId === 'user';
  const hasMention = content && /@(?!all\b|everyone\b)\S+/i.test(content);

  // Get room agents with permission filtering
  const roomAgents = getRoomAgents(room, senderId, content);
  const hasRealAgentMention = hasMention && roomAgents.some(function(a) {
    return isAgentMentioned(content, a.id);
  });
  const mode = (isUserMessage && hasRealAgentMention) ? 'mention-only' : (room.mode || 'broadcast');
  console.log('[Broadcast] Room "' + room.name + '" mode=' + mode + ' sender=' + senderId);
  writeLog('INFO', '[Broadcast] Room "' + room.name + '" mode=' + mode + ' sender=' + senderId);

  // Get recent history for context
  const recentMsgs = getMessages({ room_id: roomId, limit: 15 });

  if (roomAgents.length === 0) {
    console.log('[Broadcast] No eligible agents in room');
    writeLog('WARN', '[Broadcast] No eligible agents in room');
    return;
  }

  // Filter agents by current task's participants
  // This ensures @mentions and battle only reach agents in the current project
  let taskFilteredAgents = roomAgents;
  if (taskId) {
    const task = getTask(taskId);
    if (task && task.participants && task.participants.length > 0) {
      taskFilteredAgents = roomAgents.filter(function(agent) {
        return task.participants.indexOf(agent.id) >= 0;
      });
      console.log('[Broadcast] Task "' + task.title + '" participants filter: ' + roomAgents.length + ' -> ' + taskFilteredAgents.length + ' agents');
      writeLog('INFO', '[Broadcast] Task "' + task.title + '" participants filter: ' + roomAgents.length + ' -> ' + taskFilteredAgents.length + ' agents');
    }
  }

    // Track eligible agents for chain broadcast (mention-only/battle mode)
  if (depth === 0 && mode === 'mention-only' && !eligibleAgentIds) {
    eligibleAgentIds = new Set();
    for (var ei = 0; ei < taskFilteredAgents.length; ei++) {
      var ea = taskFilteredAgents[ei];
      if (isAgentMentioned(content, ea.id) || isMentionAll(content)) {
        eligibleAgentIds.add(ea.id);
      }
    }
    if (eligibleAgentIds.size > 0) {
      console.log('[Broadcast] Tracked ' + eligibleAgentIds.size + ' eligible agents for chain');
    } else {
      eligibleAgentIds = null;
    }
  }

    // Build reply-to context (NEW)
  const replyTo = (senderId !== 'user' && recentMsgs.length > 1)
    ? buildReplyContext(content, recentMsgs.slice(0, -1))
    : null;

  // Send to all agents sequentially so stop can take effect between agents
  const results = [];

  for (const agent of taskFilteredAgents) {
    // Chain depth filtering: only allow agents that were originally eligible
    if (eligibleAgentIds && !eligibleAgentIds.has(agent.id)) {
      results.push({ agentId: agent.id, name: agent.name, skipped: true, reason: 'not in chain scope' });
      continue;
    }
    // Permission check: mention-only mode
    const perms = agent.group_permissions || {};

    if (mode === 'mention-only') {
      const mentioned = isAgentMentioned(content, agent.id);
      const mentionAll = isMentionAll(content);
      if (!mentioned && !mentionAll) {
        results.push({ agentId: agent.id, name: agent.name, skipped: true, reason: 'not mentioned' });
        continue;
      }
    }

    // Skip if agent cannot receive broadcast
    if (mode === 'broadcast' && perms.receive_all === false) {
      results.push({ agentId: agent.id, name: agent.name, skipped: true, reason: 'receive_all disabled' });
      continue;
    }

    // Throttle check
    if (!canAgentReply(agent.id)) {
      results.push({ agentId: agent.id, name: agent.name, skipped: true, reason: 'throttled' });
      continue;
    }

    // Build messages with enhanced context
    const isMentioned = mode === 'broadcast'
      ? isAgentMentioned(content, agent.id) || isMentionAll(content)
      : true;

    const currentMsg = {
      sender_id: senderId,
      sender_name: senderName,
      content: content,
      reply_to: replyTo || null,
    };

    // Check round limit before calling agent
    if (!canAgentReplyInRound(agent.id, taskId, content, depth === 0)) {
      io.emit('agent:state', { agentId: agent.id, state: 'idle' });
      results.push({ agentId: agent.id, name: agent.name, skipped: true, reason: 'round limit' });
      continue;
    }
    
    // Check stop before calling agent
    if (stopBroadcast) { io.emit("agent:state", { agentId: agent.id, state: "idle" }); results.push({ agentId: agent.id, name: agent.name, skipped: true, reason: "stopped" }); break; }

    // Pass rules to buildGroupChatMessages
    const messages = buildGroupChatMessages(room, recentMsgs, currentMsg, agent, isMentioned, chatRules);

    try {
      io.emit('agent:state', { agentId: agent.id, state: 'thinking' });

      const result = await callAgent(agent.id, messages);
      
      // Check stop AFTER callAgent returns — catches already-in-flight calls
      if (stopBroadcast) {
        io.emit('agent:state', { agentId: agent.id, state: 'idle' });
        results.push({ agentId: agent.id, name: agent.name, skipped: true, reason: 'stopped' });
        break;
      }

      const replyContent = (result.content || '').trim();

      if (replyContent === '[SILENT]' || replyContent === '') {
        io.emit('agent:state', { agentId: agent.id, state: 'idle' });
        results.push({ agentId: agent.id, name: agent.name, silent: true });
        continue;
      }

      if (isDuplicateReply(agent.id, replyContent)) {
        io.emit('agent:state', { agentId: agent.id, state: 'idle' });
        results.push({ agentId: agent.id, name: agent.name, duplicate: true });
        continue;
      }

      recordAgentReply(agent.id);
      incrementAgentRound(agent.id, taskId);

      const msg = saveMessage({
        task_id: taskId || null,
        room_id: roomId,
        agent_id: agent.id,
        role: 'agent',
        content: replyContent,
      });

      io.emit('chat:message', {
        id: msg.id,
        room_id: roomId,
        agent_id: agent.id,
        role: 'agent',
        content: replyContent,
        created_at: new Date().toISOString()
      });
      io.emit('agent:state', { agentId: agent.id, state: 'idle' });

      // Check stop before chaining
      if (stopBroadcast) {
        results.push({ agentId: agent.id, name: agent.name, replied: true, content: replyContent });
        break;
      }

      results.push({ agentId: agent.id, name: agent.name, replied: true, content: replyContent });
    } catch (err) {
      console.error('Agent ' + agent.id + ' error:', err.message);
      writeLog('ERROR', 'Agent ' + agent.id + ' error: ' + err.message);
      io.emit('agent:state', { agentId: agent.id, state: 'idle' });
      results.push({ agentId: agent.id, name: agent.name, error: err.message });
    }

    // Break out of loop entirely if stopped
    if (stopBroadcast) {
      console.log('[Broadcast] Stopped mid-loop, remaining agents skipped');
      writeLog('INFO', '[Broadcast] Stopped mid-loop by user');
      break;
    }
  }

  // One chain broadcast per depth (not one per agent)
  if (depth < 3 && !stopBroadcast) {
    var chainContent = null;
    var chainSenderId = null;
    var chainSenderName = null;
    for (var ri = 0; ri < results.length; ri++) {
      var r = results[ri];
      if (r && r.replied && r.content) {
        chainContent = r.content;
        chainSenderId = r.agentId;
        chainSenderName = r.name || r.agentId;
      }
    }
    if (chainContent) {
      setImmediate(function() {
        if (stopBroadcast) { return; }
        broadcastToRoom(roomId, chainSenderId, chainSenderName, chainContent, taskId, depth + 1, eligibleAgentIds)
          .catch(function(err) { console.error('[Chained] Broadcast error:', err.message); });
      });
    }
  }

  // Statistics
  const replied = results.filter(function(r) { return r && r.replied; }).length;
  const silent = results.filter(function(r) { return r && r.silent; }).length;
  const skipped = results.filter(function(r) { return r && r.skipped; }).length;
  const errors = results.filter(function(r) { return r && r.error; }).length;

  console.log('[Broadcast] Results: ' + replied + ' replied, ' + silent + ' silent, ' + skipped + ' skipped, ' + errors + ' errors');
  writeLog('INFO', '[Broadcast] Results: ' + replied + ' replied, ' + silent + ' silent, ' + skipped + ' skipped, ' + errors + ' errors');
}

// ============ Socket.IO event handling ============

io.on('connection', function(socket) {
  console.log('Client connected:', socket.id);
  writeLog('INFO', 'Client connected: ' + socket.id);

  let currentRoom = 'room-general';

  // --- Send message (broadcast mode core) ---
  socket.on('chat:send', async function(data) {
    stopBroadcast = false; // Reset stop flag for new user message
    resetTaskRounds(data.task_id);
    const { task_id, agent_id, role, content, room_id, reply_to } = data;
    if (!content) return;

    const roomId = room_id || currentRoom;

    // 1. Save user message
    const msg = saveMessage({
      task_id: task_id || null,
      room_id: roomId,
      agent_id: agent_id || 'user',
      role: role || 'user',
      content: content,
    });

    // 2. Broadcast to all frontend clients
    io.emit('chat:message', {
      id: msg.id,
      room_id: roomId,
      task_id: task_id || null,
      agent_id: agent_id || 'user',
      role: role || 'user',
      content: content,
      reply_to: reply_to || null,
      created_at: new Date().toISOString()
    });

    console.log('Chat [' + roomId + ']:', agent_id || 'user', '->', content.slice(0, 50));
    writeLog('INFO', 'Chat [' + roomId + ']: ' + (agent_id || 'user') + ' -> ' + content.slice(0, 50));

    // 3. Broadcast to all room agents
    const senderName = agent_id === 'user' ? 'Boss' : (getAgent(agent_id)?.nickname || getAgent(agent_id)?.name || agent_id || 'Unknown');
    broadcastToRoom(roomId, agent_id || 'user', senderName, content, task_id, 0);
  });

    // --- Stop broadcast ---
  socket.on("chat:stop", function() {
    stopBroadcast = true;
    console.log("Broadcast stopped by user");
    writeLog("INFO", "Broadcast stopped by user");
  });

  // --- Message history ---
  socket.on('chat:history', function(data, callback) {
    const roomId = data?.room_id || currentRoom;
    const msgs = getMessages({ room_id: roomId, task_id: data?.task_id || null });
    if (callback) callback(msgs);
  });

  // --- Member added event (for frontend sync) ---
  socket.on('member:refresh', function() {
    const allAgents = listAgents();
    socket.emit('agents:list', allAgents);
  });

  socket.on('disconnect', function() {
    console.log('Client disconnected:', socket.id);
    writeLog('INFO', 'Client disconnected: ' + socket.id);
  });
});

// ============ Health check ============

app.get('/api/basepath', function(req, res) {
  res.json({ basePath: __dirname });
});

// ============ API: Log ============
app.get('/api/log', function(req, res) {
  fs.readFile(LOG_FILE, 'utf8', function(err, data) {
    if (err) {
      if (err.code === 'ENOENT') return res.send('日志文件尚未生成。\n');
      return res.status(500).json({ error: err.message });
    }
    var lines = data.split('\n').filter(function(l) { return l.trim(); });
    var tail = lines.slice(-500);
    res.type('text/plain; charset=utf-8').send(tail.join('\n'));
  });
});


app.get('/api/health', function(_req, res) {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.post('/api/export', function(req, res) {
  var exportPath = req.body.exportPath || path.join(__dirname, 'exports');
  var filename = req.body.filename || 'export.txt';
  var content = req.body.content || '';
  var fullPath = path.join(exportPath, filename);
  fs.mkdir(exportPath, { recursive: true }, function(mkErr) {
    if (mkErr) return res.status(500).json({ error: 'Failed to create directory: ' + mkErr.message });
    fs.writeFile(fullPath, content, 'utf8', function(wErr) {
      if (wErr) return res.status(500).json({ error: 'Failed to write file: ' + wErr.message });
      writeLog('INFO', 'Export saved: ' + fullPath);
      res.json({ success: true, path: fullPath });
    });
  });
});

// ============ API: Shutdown ============
app.post('/api/shutdown', function(req, res) {
  writeLog('INFO', 'Shutdown requested via API');
  res.json({ status: 'shutting_down' });
  setTimeout(function() {
    process.exit(0);
  }, 500);
});

// ============ Serve README as User Guide ============
app.get('/guide', function(req, res) {
  var fs = require('fs');
  var readmePath = path.join(__dirname, 'README.md');
  fs.readFile(readmePath, 'utf-8', function(err, data) {
    if (err) { res.status(404).send('Guide not available'); return; }
    res.type('text/html').send('<html><head><meta charset="utf-8"><title>Agent Hub Guide</title><style>body{font-family:sans-serif;max-width:800px;margin:20px auto;padding:20px;line-height:1.6}code{background:#eee;padding:2px 6px;border-radius:3px}pre{background:#eee;padding:16px;border-radius:6px}</style></head><body>' + data.replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>') + '</body></html>');
  });
});

// ============ Startup ============

async function start() {
  await getDb();

  // Sync agents.json to hub.db
  const allAgents = listAgents();
  syncAgentsToDb(allAgents);
  // Validate env var references for all agents
  for (const agent of allAgents) {
    if (agent.endpoint && typeof agent.endpoint === "string" && agent.endpoint.startsWith("$")) {
      const envKey = agent.endpoint.slice(1);
      if (!process.env[envKey]) {
        console.warn("[Startup] WARNING: Agent " + agent.id + " references env " + agent.endpoint + " which is not set");
        writeLog("WARN", "Missing env var " + agent.endpoint + " for agent " + agent.id);
      }
    }
  }

  // Restore DB-persisted nicknames into in-memory cache
  // This makes nickname survive git checkout of agents.json
  const dbAgents = listAgentsFromDb();
  for (const dbAgent of dbAgents) {
    if (dbAgent.nickname) {
      setInMemoryProperty(dbAgent.id, 'nickname', dbAgent.nickname);
    }
  }

  // Initialize default room
  initDefaultRoom(require('./src/db'));

  // Create default task if none exist
  const db = require('./src/db');
  const existingTasks = db.listTasks();
  if (!existingTasks || existingTasks.length === 0) {
    db.createTask({
      id: 'default-project',
      title: 'Default Project',
      description: 'Welcome! Start your first conversation or add agents.',
      participants: []
    });
    console.log('[Startup] Created default task: Default Project');
    writeLog('INFO', 'Created default task for new installation');
  }

  server.listen(PORT, '127.0.0.1', function() {
    console.log('Agent Hub v0.2.0 running at http://127.0.0.1:' + PORT);
    writeLog('INFO', 'Agent Hub v0.2.0 started on port ' + PORT + ' with ' + allAgents.length + ' agents');
    console.log('Mode: Dynamic member management + Group chat broadcast');
    writeLog('INFO', 'Mode: Dynamic member management + Group chat broadcast');
    console.log('Agents loaded:', allAgents.length);
    writeLog('INFO', 'Agents loaded: ' + allAgents.length);
  });
}

start().catch(function(err) {
  console.error('Failed to start:', err);
  writeLog('CRITICAL', 'Failed to start: ' + (err && err.message ? err.message : err))
  process.exit(1);
});

// Export broadcastToRoom for routes.js
// ============ Logging ============

function writeLog(level, msg) {
  const line = '[' + new Date().toISOString() + '] [' + level + '] ' + msg + '\n';
  fs.appendFile(LOG_FILE, line, function(err) {
    if (err) console.error('Log write error:', err.message);
  });
}

// Round counters per task per agent
var agentRoundCounts = {};

// In-memory rules cache  
var chatRules = { rounds: 3, customRules: "" };

// Load rules from DB on startup
try {
  const db = require('./src/db');
  chatRules.rounds = db.getSetting("chat_rounds", 3);
  chatRules.customRules = db.getSetting("chat_custom_rules", "");
} catch(e) { /* use defaults */ }

// Make accessible to routes.js
global.__chatRules = chatRules;

// Reset round counters for a task (called when user sends a message)
function resetTaskRounds(taskId) {
  delete agentRoundCounts[taskId || "__global__"];
}

// Check if an agent can reply in this round
function canAgentReplyInRound(agentId, taskId, content, allowMentionBypass) {
  // @mentions and battle mode skip round limits (user messages only)
  if (allowMentionBypass !== false && (isAgentMentioned(content, agentId) || isMentionAll(content) || content.includes("/Battle") || content.includes("/battle"))) {
    return true;
  }

  var key = taskId || "__global__";
  if (!agentRoundCounts[key]) agentRoundCounts[key] = {};
  var counts = agentRoundCounts[key];
  var count = counts[agentId] || 0;

  return count < chatRules.rounds;
}

function incrementAgentRound(agentId, taskId) {
  var key = taskId || "__global__";
  if (!agentRoundCounts[key]) agentRoundCounts[key] = {};
  if (!agentRoundCounts[key][agentId]) agentRoundCounts[key][agentId] = 0;
  agentRoundCounts[key][agentId]++;
}

module.exports = { broadcastToRoom, resetTaskRounds, chatRules };






