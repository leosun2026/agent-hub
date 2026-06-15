// Agent Hub Server v2.0 — Dynamic member management + Group chat
// Core: message broadcast to all room agents with permission filtering

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const LOG_FILE = path.join(__dirname, 'hub.log');
;
const { setupRoutes } = require('./src/routes');
const { saveMessage, getMessages, getDb, getRoom, syncAgentsToDb, listAgentsFromDb } = require('./src/db');
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

// ============ Parse @mentions (for notification enhancement) ============

function parseMentions(text) {
  const matches = text.match(/@(\S+)/g);
  if (!matches) return [];
  return matches.map(function(m) { return m.slice(1); });
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
    if (content === '[SILENT]' || content === '') {
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
    console.error('Agent ' + agentId + ' error:', err.message);
    writeLog('ERROR', 'Agent ' + agentId + ' error: ' + err.message)
    const errMsg = saveMessage({
      task_id: taskId || null,
      room_id: roomId || null,
      agent_id: agentId,
      role: 'agent',
      content: '[Error] ' + err.message,
    });
    io.emit('chat:message', {
      id: errMsg.id,
      room_id: roomId || null,
      agent_id: agentId,
      role: 'agent',
      content: '[Error] ' + err.message,
      created_at: new Date().toISOString()
    });
    io.emit('agent:state', { agentId: agentId, state: 'idle' });
    return null;
  }
}

// ============ Broadcast to all agents in room (core logic — enhanced) ============

async function broadcastToRoom(roomId, senderId, senderName, content, taskId, depth) {
  if (depth === undefined) depth = 0;
    if (stopBroadcast) { stopBroadcast = false; return; }
  const room = getRoom(roomId);
  if (!room) {
    console.log('[Broadcast] Room not found:', roomId);
    writeLog('WARN', '[Broadcast] Room not found: ' + roomId)
    return;
  }

  const mode = room.mode || 'broadcast';
  console.log('[Broadcast] Room "' + room.name + '" mode=' + mode + ' sender=' + senderId);
  writeLog('INFO', '[Broadcast] Room "' + room.name + '" mode=' + mode + ' sender=' + senderId);

  // Get recent history for context
  const recentMsgs = getMessages({ room_id: roomId, limit: 30 });

  // Get room agents with permission filtering
  const roomAgents = getRoomAgents(room, senderId, content);
  if (roomAgents.length === 0) {
    console.log('[Broadcast] No eligible agents in room');
    writeLog('WARN', '[Broadcast] No eligible agents in room');
    return;
  }

  // Build reply-to context (NEW)
  const replyTo = (senderId !== 'user' && recentMsgs.length > 1)
    ? buildReplyContext(content, recentMsgs.slice(0, -1))
    : null;

  // Send to all agents in parallel
  const tasks = roomAgents.map(async function(agent) {
    // Permission check: mention-only mode
    const perms = agent.group_permissions || {};

    if (mode === 'mention-only') {
      const mentioned = isAgentMentioned(content, agent.id);
      const mentionAll = isMentionAll(content);
      if (!mentioned && !mentionAll && perms.receive_at_only !== false) {
        // In mention-only mode, skip if not @mentioned and not receive_at_only
        return { agentId: agent.id, name: agent.name, skipped: true, reason: 'not mentioned' };
      }
    }

    // Skip if agent cannot receive broadcast
    if (mode === 'broadcast' && perms.receive_all === false) {
      return { agentId: agent.id, name: agent.name, skipped: true, reason: 'receive_all disabled' };
    }

    // Throttle check
    if (!canAgentReply(agent.id)) {
      return { agentId: agent.id, name: agent.name, skipped: true, reason: 'throttled' };
    }

    // Build messages with enhanced context (companion list + reply-to)
    const isMentioned = mode === 'broadcast'
      ? isAgentMentioned(content, agent.id) || isMentionAll(content)
      : true;

    const currentMsg = {
      sender_id: senderId,
      sender_name: senderName,
      content: content,
      reply_to: replyTo || null,
    };

    const messages = buildGroupChatMessages(room, recentMsgs, currentMsg, agent, isMentioned);

    try {
      io.emit('agent:state', { agentId: agent.id, state: 'thinking' });

      const result = await callAgent(agent.id, messages);
      const replyContent = (result.content || '').trim();

      if (replyContent === '[SILENT]' || replyContent === '') {
        io.emit('agent:state', { agentId: agent.id, state: 'idle' });
        return { agentId: agent.id, name: agent.name, silent: true };
      }

      if (isDuplicateReply(agent.id, replyContent)) {
        io.emit('agent:state', { agentId: agent.id, state: 'idle' });
        return { agentId: agent.id, name: agent.name, duplicate: true };
      }

      recordAgentReply(agent.id);

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

      // Also broadcast this agent's reply to other agents (chained broadcast)
      // But only for broadcast mode, not mention-only (to avoid infinite loops)
      // Max 3 rounds of agent-to-agent replies without user input
      if (mode === 'broadcast' && replyContent && replyContent.length > 0) {
        const nextDepth = depth + 1;
        if (nextDepth <= 3) {
          setImmediate(() => {
            const agentName = agent.nickname || agent.name || agent.id;
            broadcastToRoom(roomId, agent.id, agentName, replyContent, taskId, nextDepth)
              .catch(err => console.error('[Chained] Broadcast error:', err.message));
          });
        }
      }

      return { agentId: agent.id, name: agent.name, replied: true, content: replyContent };
    } catch (err) {
      console.error('Agent ' + agent.id + ' error:', err.message);
      writeLog('ERROR', 'Agent ' + agent.id + ' error: ' + err.message)
      io.emit('agent:state', { agentId: agent.id, state: 'idle' });
      return { agentId: agent.id, name: agent.name, error: err.message };
    }
  });

  const results = await Promise.allSettled(tasks);

  // Statistics
  const replied = results.filter(r => r.status === 'fulfilled' && r.value && r.value.replied).length;
  const silent = results.filter(r => r.status === 'fulfilled' && r.value && r.value.silent).length;
  const skipped = results.filter(r => r.status === 'fulfilled' && r.value && r.value.skipped).length;
  const errors = results.filter(r => r.status === 'rejected' || (r.value && r.value.error)).length;

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

// ============ Startup ============

async function start() {
  await getDb();

  // Sync agents.json to hub.db
  const allAgents = listAgents();
  syncAgentsToDb(allAgents);

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

  server.listen(PORT, '127.0.0.1', function() {
    console.log('Agent Hub v2.0 running at http://127.0.0.1:' + PORT);
    writeLog('INFO', 'Agent Hub v2.0 started on port ' + PORT + ' with ' + allAgents.length + ' agents');
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

module.exports = { broadcastToRoom };



