// Routes module — REST API
// Features: members CRUD, rooms, messages, tasks

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const agents = require('./agents');
const tasksMod = require('./tasks');
const roomsMod = require('./rooms');

const ENV_PATH = path.join(__dirname, '..', '.env');
const ENV_LOCK = { locked: false, queue: [] };
function acquireEnvLock() {
  return new Promise(resolve => {
    if (!ENV_LOCK.locked) { ENV_LOCK.locked = true; resolve(); return; }
    ENV_LOCK.queue.push(resolve);
  });
}
function releaseEnvLock() {
  if (ENV_LOCK.queue.length > 0) { ENV_LOCK.queue.shift()(); return; }
  ENV_LOCK.locked = false;
}
const AVATAR_DIR = path.join(__dirname, '..', 'public', 'avatars');

async function saveEnvVar(key, value) {
  await acquireEnvLock();
  try {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let content = fs.readFileSync(ENV_PATH, 'utf8');
    const regex = new RegExp('^' + escapedKey + '=.*', 'm');
    if (value && (value.includes('\n') || value.includes('\r'))) {
      console.error('[Env] Value for', key, 'contains newlines, rejecting');
      return;
    }
    const line = key + '=' + value;
    if (regex.test(content)) {
      content = content.replace(regex, line);
    } else {
      if (!content.endsWith('\n')) content += '\n';
      content += line;
    }
    fs.writeFileSync(ENV_PATH, content, 'utf8');
    process.env[key] = value;
  } catch(e) {
    console.error('[Env] Failed to write', key, e.message);
  } finally {
    releaseEnvLock();
  }
}
// Ensure avatars directory exists
if (!fs.existsSync(AVATAR_DIR)) {
  fs.mkdirSync(AVATAR_DIR, { recursive: true });
}

/**
 * Compress a raw image buffer and save to avatars/{agentId}.jpg
 * Returns the public URL path
 */
async function saveAvatarFile(agentId, buffer) {
  const sharp = require('sharp');
  const filename = agentId + '.jpg';
  const outputPath = path.join(AVATAR_DIR, filename);
  await sharp(buffer)
    .resize(200, 200, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toFile(outputPath);
  return '/avatars/' + filename;
}

function setupRoutes(app, io) {

  // ============ Agent / Member endpoints ============

  // List all agents with full structure
  app.get('/api/agents', (_req, res) => {
    res.json(agents.listAgents());
  });

  // Check agent connectivity status
  app.get('/api/agents/status', async (_req, res) => {
    const statuses = await agents.checkAllAgentsStatus();
    res.json(statuses);
  });

  // Call a specific agent
  app.post('/api/agents/:id/call', async (req, res) => {
    try {
      const { messages } = req.body;
      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'messages array required' });
      }
      const result = await agents.callAgent(req.params.id, messages);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============ Member Management (NEW) ============

  // Add a new member/agent
  app.post('/api/members', async (req, res) => {
    try {
      const data = req.body;

      // Validate required fields
      if (!data.id) return res.status(400).json({ error: 'id is required (unique identifier, e.g. "hermes-main")' });
      if (!data.name) return res.status(400).json({ error: 'name is required (display name)' });
      if (!data.role) return res.status(400).json({ error: 'role is required (orchestrator|executor|specialist)' });
      if (!['orchestrator', 'executor', 'specialist'].includes(data.role)) {
        return res.status(400).json({ error: 'role must be one of: orchestrator, executor, specialist' });
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(data.id)) {
        return res.status(400).json({ error: 'id must only contain letters, numbers, underscores, hyphens' });
      }

      // Validate endpoint (if provided)
      if (data.endpoint) {
        try { const u = new URL(data.endpoint); } catch (_) {
          return res.status(400).json({ error: 'endpoint must be a valid URL (e.g. http://127.0.0.1:8642/v1/chat/completions)' });
        }
        if (data.endpoint.includes('{') || data.endpoint.includes('}')) {
          return res.status(400).json({ error: 'endpoint contains placeholder braces { }. Please use a real URL.' });
        }
      }


      // Try to verify endpoint connectivity (reject if unreachable)
      if (data.endpoint) {
        try {
          const modelUrl = data.endpoint.replace('/v1/chat/completions', '/v1/models');
          const timeout = new AbortController();
          setTimeout(() => timeout.abort(), 5000);
          const testResp = await fetch(modelUrl, { signal: timeout.signal });
          if (!testResp.ok) {
            console.warn('[Members] Endpoint check returned ' + testResp.status + ', but continuing');
          }
        } catch (_) {
          return res.status(400).json({ error: 'endpoint is unreachable. Agent Hub could not connect to ' + data.endpoint + '. Please check the address and ensure the service is running.' });
        }
      }
      // Check for duplicate
      const existing = agents.getAgent(data.id);
      if (existing) {
        return res.status(409).json({ error: 'Agent id "' + data.id + '" already exists' });
      }

      // Save endpoint/auth to .env if provided
      if (data.endpoint) {
        const envKey = 'ENDPOINT_' + data.id.toUpperCase().replace(/-/g, '_');
        await saveEnvVar(envKey, data.endpoint);
        data.endpoint = '$' + envKey;
      }
      if (data.auth) {
        const authEnvKey = 'AUTH_' + data.id.toUpperCase().replace(/-/g, '_');
        await saveEnvVar(authEnvKey, data.auth);
        data.auth = '$' + authEnvKey;
      }

      const agent = agents.addAgent(data);

      // Sync to DB
      db.saveAgentToDb(agent);

      // Auto-add to default room
      try {
        const defaultRoom = db.getRoom('room-general');
        if (defaultRoom && agent.endpoint) {
          const members = defaultRoom.members || [];
          if (!members.includes(agent.id)) {
            members.push(agent.id);
            db.updateRoomMembers('room-general', members);
          }
        }
      } catch (e) {
        console.error('[Members] Failed to add to default room:', e.message);
      }

      // Notify all clients
      io.emit('member:added', agent);
      io.emit('room:update', { action: 'member_added', agent });

      // System message in default room
      const sysMsg = db.saveMessage({
        room_id: 'room-general',
        agent_id: 'system',
        role: 'system',
        content: agent.name + ' has joined the chat room',
      });
      io.emit('chat:message', {
        id: sysMsg.id,
        room_id: 'room-general',
        agent_id: 'system',
        role: 'system',
        content: agent.name + ' has joined the chat room',
        created_at: new Date().toISOString()
      });

            // Structured system event for i18n frontend rendering
      io.emit('chat:system', {
        type: 'member:joined',
        payload: { agentId: agent.id, agentName: agent.name }
      });

      console.log('[Members] Added:', agent.id, agent.name);
      res.status(201).json(agent);
    } catch (err) {
      console.error('[Members] Add error:', err.message);
      res.status(400).json({ error: err.message });
    }
  });

  // Remove a member
  app.delete('/api/members/:id', (req, res) => {
    try {
      const id = req.params.id;
      const removed = agents.removeAgent(id);

      // Remove from DB
      db.deleteAgentFromDb(id);

      // Remove from all rooms
      const rooms = db.listRooms();
      for (const room of rooms) {
        const members = (room.members || []).filter(m => m !== id);
        db.updateRoomMembers(room.id, members);
      }

      // Notify clients
      io.emit('member:removed', { id });
      io.emit('room:update', { action: 'member_removed', agentId: id });

      // Structured system event for i18n frontend rendering
      io.emit('chat:system', {
        type: 'member:removed',
        payload: { agentId: id, agentName: removed.name }
      });

      const sysMsg = db.saveMessage({
        room_id: 'room-general',
        agent_id: 'system',
        role: 'system',
        content: removed.name + ' has been removed from the chat room',
      });
      io.emit('chat:message', {
        id: sysMsg.id,
        room_id: 'room-general',
        agent_id: 'system',
        role: 'system',
        content: removed.name + ' has been removed from the chat room',
        created_at: new Date().toISOString()
      });

      res.json({ deleted: true, agent: removed });
    } catch (err) {
      console.error('[Members] Remove error:', err.message);
      res.status(400).json({ error: err.message });
    }
  });

  // Update a member
  app.patch('/api/members/:id', async (req, res) => {
    try {
      const id = req.params.id;
      const updates = { ...req.body };

      // Auto-convert base64 avatar to compressed file
      if (updates.avatar && updates.avatar.indexOf('data:') === 0) {
        const commaIdx = updates.avatar.indexOf(',');
        const base64Data = updates.avatar.substring(commaIdx + 1);
        const imgBuffer = Buffer.from(base64Data, 'base64');
        updates.avatar = await saveAvatarFile(id, imgBuffer);
      }

      // Sync endpoint/auth to .env if provided
      if (updates.endpoint) {
        const envKey = 'ENDPOINT_' + id.toUpperCase().replace(/-/g, '_');
        await saveEnvVar(envKey, updates.endpoint);
        updates.endpoint = '$' + envKey;
      }
      if (updates.auth) {
        const authEnvKey = 'AUTH_' + id.toUpperCase().replace(/-/g, '_');
        await saveEnvVar(authEnvKey, updates.auth);
        updates.auth = '$' + authEnvKey;
      }

      const updated = agents.updateAgent(id, updates);

      // Sync to DB
      db.saveAgentToDb(updated);

      // Notify clients
      io.emit('member:updated', updated);
      io.emit('room:update', { action: 'member_updated', agent: updated });

      res.json(updated);
    } catch (err) {
      console.error('[Members] Update error:', err.message);
      res.status(400).json({ error: err.message });
    }
  });

  // Upload avatar as file (multipart/form-data)
  function uploadAvatarMw(req, res, next) {
    const multer = require('multer');
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_r, f, cb) => {
        if (f.mimetype.startsWith('image/')) return cb(null, true);
        cb(new Error('Only image files are allowed'));
      },
    });
    upload.single('avatar')(req, res, next);
  }
  app.post('/api/agents/:id/avatar', uploadAvatarMw, async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const avatarUrl = await saveAvatarFile(req.params.id, req.file.buffer);
      const updated = agents.updateAgent(req.params.id, { avatar: avatarUrl });
      db.saveAgentToDb(updated);
      io.emit('member:updated', updated);
      res.json({ avatar: avatarUrl, agent: updated });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ============ Room endpoints ============

  app.get('/api/rooms', (_req, res) => {
    res.json(db.listRooms());
  });

  app.post('/api/rooms', (req, res) => {
    const { name, mode, members } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });

    const id = 'room-' + crypto.randomBytes(4).toString('hex');
    const room = db.createRoom({
      id,
      name,
      mode: mode || 'broadcast',
      members: members || roomsMod.getAllAgentIds(),
    });

    io.emit('room:update', { action: 'created', room });
    res.status(201).json(room);
  });

  app.get('/api/rooms/:id', (req, res) => {
    const room = db.getRoom(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const memberDetails = (room.members || []).map(id => {
      const agent = agents.getAgent(id);
      return agent ? {
        id: agent.id,
        name: agent.name,
        avatar: agent.avatar,
        role: agent.role,
        nickname: agent.nickname || null,
        hasEndpoint: !!agent.endpoint,
        group_permissions: agent.group_permissions || {},
      } : { id, name: id, unknown: true };
    });

    res.json({ ...room, memberDetails });
  });

  app.put('/api/rooms/:id/members', (req, res) => {
    const { members } = req.body;
    if (!members || !Array.isArray(members)) {
      return res.status(400).json({ error: 'members array required' });
    }
    const room = db.getRoom(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const updated = db.updateRoomMembers(req.params.id, members);
    io.emit('room:update', { action: 'members_updated', room: updated });
    res.json(updated);
  });

  app.put('/api/rooms/:id/mode', (req, res) => {
    const { mode } = req.body;
    if (!mode || !['broadcast', 'mention-only'].includes(mode)) {
      return res.status(400).json({ error: 'mode must be "broadcast" or "mention-only"' });
    }
    const room = db.getRoom(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const updated = db.updateRoomMode(req.params.id, mode);
    io.emit('room:update', { action: 'mode_updated', room: updated });
    res.json(updated);
  });

  
  // Set agent nickname in a room
  
  // Get all room member nicknames
  app.get('/api/rooms/:roomId/nicknames', (req, res) => {
    const room = db.getRoom(req.params.roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    const nicks = db.getRoomMemberNicknames(req.params.roomId);
    res.json(nicks);
  });


  // Remove agent from a specific room (agent stays in system)
  app.delete('/api/rooms/:roomId/members/:agentId', (req, res) => {
    const room = db.getRoom(req.params.roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const members = (room.members || []).filter(function(m) { return m !== req.params.agentId; });
    if (members.length === (room.members || []).length) {
      return res.status(404).json({ error: 'Agent not in this room' });
    }

    const updated = db.updateRoomMembers(req.params.roomId, members);
    io.emit('room:update', { action: 'member_removed_from_room', room: updated, agentId: req.params.agentId });
    io.emit('room:nicknames:refresh', { roomId: req.params.roomId });
    res.json(updated);
  });

app.patch('/api/rooms/:roomId/members/:agentId/nickname', (req, res) => {
    try {
      const { nickname } = req.body;
      const room = db.getRoom(req.params.roomId);
      if (!room) return res.status(404).json({ error: 'Room not found' });

      const agent = agents.getAgent(req.params.agentId);
      if (!agent) return res.status(404).json({ error: 'Agent not found' });

      if (nickname && nickname.trim().length > 20) {
        return res.status(400).json({ error: 'Nickname must be 20 characters or fewer' });
      }

      const result = db.setRoomMemberNickname(req.params.roomId, req.params.agentId, nickname || null);
      io.emit('room:nickname:set', result);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

app.delete('/api/rooms/:id', (req, res) => {
    const room = db.getRoom(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.id === 'room-general') {
      return res.status(400).json({ error: 'Cannot delete the default room' });
    }
    db.deleteRoom(req.params.id);
    io.emit('room:update', { action: 'deleted', roomId: req.params.id });
    res.json({ deleted: true });
  });

  // ============ Message endpoints ============

  // POST /api/messages — for Agent active speaking (NEW: can_send_active check)
  app.post('/api/messages', (req, res) => {
    const { task_id, room_id, agent_id, role, content, metadata } = req.body;
    if (!agent_id || !role || !content) {
      return res.status(400).json({ error: 'agent_id, role, content required' });
    }

    // Check can_send_active for agent role messages
    if (role === 'agent') {
      const agent = agents.getAgent(agent_id);
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      const perms = agent.group_permissions || {};
      if (!perms.can_send_active) {
        return res.status(403).json({ error: 'Agent does not have can_send_active permission' });
      }
    }

    const msg = db.saveMessage({ task_id, room_id, agent_id, role, content, metadata });

    // If agent message, broadcast to other agents
    if (role === 'agent' && agent_id !== 'user') {
      const agent = agents.getAgent(agent_id);
      const roomId = room_id || 'room-general';
      const senderName = agent ? (agent.nickname || agent.name) : agent_id;

      // Emit to frontend
      io.emit('chat:message', {
        id: msg.id,
        room_id: roomId,
        task_id: task_id || null,
        agent_id: agent_id,
        role: 'agent',
        content: content,
        created_at: new Date().toISOString()
      });

      // Broadcast to other agents asynchronously (don't block response)
      setImmediate(() => {
        const { broadcastToRoom } = require('../server');
        broadcastToRoom(roomId, agent_id, senderName, content, task_id || null)
          .catch(err => console.error('[API Messages] Broadcast error:', err.message));
      });
    } else {
      // Regular emit
      io.emit('chat:message', {
        id: msg.id,
        room_id: room_id || null,
        task_id: task_id || null,
        agent_id: agent_id,
        role: role,
        content: content,
        created_at: new Date().toISOString()
      });
    }

    res.json(msg);
  });

  app.get('/api/messages', (req, res) => {
    const { task_id, room_id, since, limit, days } = req.query;
    const msgs = db.getMessages({
      task_id: task_id || null,
      room_id: room_id || null,
      days: days ? parseInt(days) : null,
      since: since ? parseInt(since) : null,
      limit: limit ? parseInt(limit) : 50,
    });
    res.json(msgs);
  });

  // ============ Delete messages by date ============
  app.post('/api/messages/delete-by-date', (req, res) => {
    const { date_key, room_id } = req.body;
    if (!date_key) return res.status(400).json({ error: 'date_key required' });
    
    try {
      const count = db.deleteMessagesByDate({ 
        date_key: date_key, 
        room_id: room_id || null 
      });
      res.json({ deleted: count });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============ Task endpoints ============

  app.get('/api/tasks', (req, res) => {
    const { status } = req.query;
    res.json(db.listTasks(status || null));
  });

  app.get('/api/tasks/:id', (req, res) => {
    const task = db.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  });

  app.post('/api/tasks', (req, res) => {
    const { title, description, participants } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const id = 'task-' + crypto.randomBytes(4).toString('hex');
    const task = db.createTask({ id, title, description, participants });
    res.status(201).json(task);
  });

  
  // PATCH /api/tasks/:id — update task title
  app.patch('/api/tasks/:id', (req, res) => {
    const { title, participants } = req.body;
    const current = db.getTask(req.params.id);
    if (!current) return res.status(404).json({ error: 'Task not found' });
    if (title) {
      const updated = db.updateTaskTitle(req.params.id, title);
      res.json(updated);
    } else if (participants) {
      const updated = db.updateTaskParticipants(req.params.id, participants);
      res.json(updated);
    } else {
      return res.status(400).json({ error: 'title or participants required' });
    }
  });

  
  // DELETE /api/tasks/:id
  app.delete('/api/tasks/:id', (req, res) => {
    const current = db.getTask(req.params.id);
    if (!current) return res.status(404).json({ error: 'Task not found' });
    db.deleteTask(req.params.id);
    res.json({ success: true });
  });

  app.patch('/api/tasks/:id/status', (req, res) => {
    const { status } = req.body;
    const current = db.getTask(req.params.id);
    if (!current) return res.status(404).json({ error: 'Task not found' });
    if (!tasksMod.canTransition(current.status, status)) {
      return res.status(400).json({ error: 'Invalid status transition' });
    }
    const updated = db.updateTaskStatus(req.params.id, status);
    res.json(updated);
  });

  app.post('/api/tasks/:id/comment', (req, res) => {
    const { agent_id, content } = req.body;
    if (!agent_id || !content) return res.status(400).json({ error: 'agent_id, content required' });
    const msg = db.saveMessage({
      task_id: req.params.id,
      agent_id,
      role: agent_id === 'user' ? 'user' : 'agent',
      content,
    });
    res.json(msg);
  });

  app.post('/api/tasks/:id/plan', (req, res) => {
    const { plan } = req.body;
    if (!plan) return res.status(400).json({ error: 'plan required' });
    const updated = db.updateTaskPlan(req.params.id, plan);
    res.json(updated);
  });

  app.post('/api/tasks/:id/result', (req, res) => {
    const { result } = req.body;
    if (!result) return res.status(400).json({ error: 'result required' });
    const updated = db.updateTaskResult(req.params.id, result);
    res.json(updated);
  });

  // === Rules API ===
  // GET /api/rules - get current chat rules
  app.get("/api/rules", function(req, res) {
    var rules = {
      rounds: db.getSetting("chat_rounds", 3),
      customRules: db.getSetting("chat_custom_rules", "")
    };
    res.json(rules);
  });

  // POST /api/rules - save chat rules
  app.post("/api/rules", function(req, res) {
    var rounds = parseInt(req.body.rounds) || 3;
    var customRules = (req.body.customRules || "").trim();

    // Validate
    if (rounds < 1) rounds = 1;
    if (rounds > 10) rounds = 10;

    db.setSetting("chat_rounds", rounds);
    db.setSetting("chat_custom_rules", customRules);

    // Update server's in-memory rules
    try {
      const server = require("../server");
      if (server.chatRules) {
        server.chatRules.rounds = rounds;
        server.chatRules.customRules = customRules;
      }
    } catch(e) { /* server module not available */ }

    res.json({ success: true, rules: { rounds: rounds, customRules: customRules } });
  });


  // ============ Invitation / Registration (Verification Callback) ============

  // POST /api/invite - Create an invitation for an agent
  app.post('/api/invite', (req, res) => {
    var agentId = (req.body.agentId || '').trim();
    var agentName = (req.body.agentName || agentId).trim();
    var mode = req.body.mode || 'direct'; // 'direct' or 'review'
    if (!agentId) return res.status(400).json({ error: 'agentId is required' });

    // Check if agent already exists
    var existing = agents.getAgent(agentId);
    if (existing) return res.status(409).json({ error: 'Agent "' + agentId + '" already exists' });

    var invite = db.createInvitation(agentId, agentName, mode);
    var hubUrl = req.protocol + '://' + req.get('host');
    res.json({
      inviteId: invite.inviteId,
      challenge: invite.challenge,
      expiresAt: invite.expiresAt,
      registerUrl: hubUrl + '/api/register',
      mode: mode
    });
  });

  // POST /api/register - Agent calls back with minimum info (simplified)
  app.post('/api/register', async (req, res) => {
    var inviteId = (req.body.inviteId || '').trim();
    var baseUrl = (req.body.baseUrl || req.body.endpoint || '').trim();
    var authToken = req.body.auth || req.body.authToken || req.body.auth_token || '';
    var model = (req.body.model || '').trim();
    var mode = req.body.mode || 'direct';

    if (!inviteId) return res.status(400).json({ error: 'inviteId is required' });

    var invite = db.getInvitation(inviteId);
    if (!invite) return res.status(404).json({ error: 'Invitation not found' });
    if (invite.status !== 'pending') return res.status(410).json({ error: 'Invitation already ' + invite.status });
    if (new Date(invite.expires_at) < new Date()) {
      db.updateInvitationStatus(inviteId, 'expired');
      return res.status(410).json({ error: 'Invitation expired' });
    }

    // Construct endpoint from baseUrl or use provided endpoint directly
    var endpoint = baseUrl;
    if (endpoint && !endpoint.includes('/v1/chat/completions')) {
      endpoint = endpoint.replace(/\/+$/, '') + '/v1/chat/completions';
    }

    // Mark as accepted immediately
    db.updateInvitationStatus(inviteId, 'accepted', {
      endpoint: endpoint || null,
      authToken: authToken || null,
      model: model || null
    });

    // Add the agent right away
    var agentData = {
      id: invite.agent_id,
      name: invite.agent_name,
      role: 'executor',
      avatar: '🤖',
      endpoint: endpoint || null,
      model: model || null,
      auth: authToken || null,
      capabilities: ['chat'],
      group_permissions: { receive_all: true, receive_at_only: false, can_send_active: true, can_see_history: true }
    };

    agents.addAgent(agentData);
    db.saveAgentToDb(agentData);

    // Auto-add to default room
    try {
      var roomGeneral = db.getRoom('room-general');
      if (roomGeneral) {
        var members = roomGeneral.members || [];
        if (members.indexOf(agentData.id) < 0) {
          members.push(agentData.id);
          db.updateRoomMembers('room-general', members);
        }
      }
    } catch (e) {
      console.error('[Register] Failed to add to room:', e.message);
    }

    try { require('../server').io.emit('agents:list', agents.listAgents()); } catch(e) {}

    // Async endpoint probe (non-blocking, wont affect registration)
    if (endpoint) {
      setTimeout(async () => {
        try {
          var modelUrl = endpoint.replace('/v1/chat/completions', '/v1/models');
          var probeResp = await fetch(modelUrl, { signal: AbortSignal.timeout(5000) });
          if (probeResp.ok) {
            var body = await probeResp.json();
            var modelList = (body.data || body.models || []).map(function(m) { return m.id || m.name || m; });
            console.log('[Register] Endpoint verified for', invite.agent_id, '- models:', modelList.join(', '));
          } else {
            console.log('[Register] Endpoint check returned', probeResp.status, 'for', invite.agent_id);
          }
        } catch (e) {
          console.log('[Register] Async endpoint probe skipped for', invite.agent_id, ':', e.message);
        }
      }, 0);
    }

    res.json({ status: 'active', agentId: invite.agent_id, agentName: invite.agent_name });
  });

  // GET /api/invite/:id - Check a single invitation status
  app.get('/api/invite/:id', (req, res) => {
    var invite = db.getInvitation(req.params.id);
    if (!invite) return res.status(404).json({ error: 'Invitation not found' });
    res.json({
      id: invite.id,
      agentId: invite.agent_id,
      agentName: invite.agent_name,
      status: invite.status,
      expiresAt: invite.expires_at,
      createdAt: invite.created_at
    });
  });

  // GET /api/pending-invites - List pending invitations for the UI
  // GET /api/pending-invites - List pending invitations for the UI
  app.get('/api/pending-invites', (req, res) => {
    var invites = db.listPendingInvitations();
    res.json(invites);
  });

  // POST /api/invite/approve - Human approves a pending review-mode invitation
  app.post('/api/invite/approve', (req, res) => {
    var inviteId = (req.body.inviteId || '').trim();
    var approvedBy = req.body.approvedBy || 'user';
    if (!inviteId) return res.status(400).json({ error: 'inviteId is required' });

    var invite = db.getInvitation(inviteId);
    if (!invite) return res.status(404).json({ error: 'Invitation not found' });
    if (invite.status !== 'accepted') return res.status(400).json({ error: 'Invitation not in accepted state, current: ' + invite.status });

    // Generate approval token for agent to complete registration
    var approvalToken = 'appr-' + require('crypto').randomBytes(8).toString('hex');
    db.updateInvitationStatus(inviteId, 'accepted', { approvedBy: approvedBy });

    // If endpoint already provided in review mode, add agent now
    if (invite.endpoint && invite.model) {
      var agentData = {
        id: invite.agent_id,
        name: invite.agent_name,
        role: 'executor',
        avatar: '🤖',
        endpoint: invite.endpoint,
        model: invite.model,
        auth: invite.auth_token,
        capabilities: ['chat'],
        group_permissions: { receive_all: true, receive_at_only: false, can_send_active: true, can_see_history: true }
      };
      agents.addAgent(agentData);
      db.saveAgentToDb(agentData);
      try { require('../server').io.emit('agents:list', agents.listAgents()); } catch(e) {}
      return res.json({ status: 'active', agentId: invite.agent_id, approvalToken: approvalToken });
    }

    res.json({ status: 'approved', agentId: invite.agent_id, approvalToken: approvalToken,
      message: 'Agent approved. Send the approvalToken to the agent so it can complete registration via POST /api/complete-registration' });
  });

  // POST /api/complete-registration - Agent completes registration after approval
  app.post('/api/complete-registration', async (req, res) => {
    var approvalToken = (req.body.approvalToken || '').trim();
    var endpoint = (req.body.endpoint || '').trim();
    var authToken = req.body.auth || '';
    var model = (req.body.model || '').trim();

    if (!approvalToken) return res.status(400).json({ error: 'approvalToken is required' });
    if (!endpoint) return res.status(400).json({ error: 'endpoint is required' });
    if (!model) return res.status(400).json({ error: 'model is required' });

    // Find invitation by approval context
    // In a real implementation, approvalToken would map to an invitation
    // For now, simple lookup
    var allInvites = db.listAllInvitations();
    var invite = allInvites.find(function(i) { return i.status === 'accepted' && i.agent_id; });
    if (!invite) return res.status(404).json({ error: 'No pending approved invitation found' });

    var agentData = {
      id: invite.agent_id,
      name: invite.agent_name,
      role: 'executor',
      avatar: '🤖',
      endpoint: endpoint,
      model: model,
      auth: authToken,
      capabilities: ['chat'],
      group_permissions: { receive_all: true, receive_at_only: false, can_send_active: true, can_see_history: true }
    };
    agents.addAgent(agentData);
    db.saveAgentToDb(agentData);
    db.updateInvitationStatus(invite.id, 'accepted', { endpoint: endpoint, authToken: authToken, model: model });
    try { require('../server').io.emit('agents:list', agents.listAgents()); } catch(e) {}

    res.json({ status: 'active', agentId: invite.agent_id });
  });


    app.post("/api/hello", async (req, res) => {
      try {
        const { id, name } = req.body;
        if (!id) return res.status(400).json({ error: "id is required" });
        const existing = agents.getAgent(id);
        if (existing) return res.status(409).json({ error: "Agent \"" + id + "\" already exists" });
        const envKey = "ENDPOINT_" + id.toUpperCase().replace(/-/g, "_");
        const authEnvKey = "AUTH_" + id.toUpperCase().replace(/-/g, "_");
        let endpoint = req.body.endpoint || process.env[envKey] || null;
        let auth = req.body.auth || process.env[authEnvKey] || null;
        if (req.body.endpoint) await saveEnvVar(envKey, req.body.endpoint);
        if (req.body.auth) await saveEnvVar(authEnvKey, req.body.auth);
        const agentData = {
          id: id, name: name || id, role: "executor",
          avatar: req.body.avatar || "robot",
          endpoint: endpoint ? "$" + envKey : null,
          model: req.body.model || null,
          auth: auth ? "$" + authEnvKey : null,
          capabilities: ["chat"],
          group_permissions: { receive_all: true, receive_at_only: false, can_send_active: true, can_see_history: true }
        };
        if (endpoint) {
          try {
            const modelUrl = endpoint.replace("/v1/chat/completions", "/v1/models");
            const controller = new AbortController();
            setTimeout(() => controller.abort(), 3000);
            const probeResp = await fetch(modelUrl, { signal: controller.signal });
            if (probeResp.ok) {
              const body = await probeResp.json();
              const modelList = (body.data || body.models || []).map(function(m) { return m.id || m.name || m; });
              if (modelList.length > 0 && !agentData.model) agentData.model = modelList[0];
            }
          } catch (_) { console.log("[Hello] Endpoint probe skipped for", id); }
        }
        const agent = agents.addAgent(agentData);
        db.saveAgentToDb(agent);
        try {
          const defaultRoom = db.getRoom("room-general");
          if (defaultRoom) {
            const members = defaultRoom.members || [];
            if (!members.includes(agent.id)) { members.push(agent.id); db.updateRoomMembers("room-general", members); }
          }
        } catch (_) {}
        try { require("../server").io.emit("agents:list", agents.listAgents()); } catch(_) {}
        console.log("[Hello] Agent registered:", id, endpoint ? "-> " + endpoint : "(no endpoint)");
        res.json({ status: "active", agentId: agent.id, agentName: agent.name });
      } catch (e) {
        console.error("[Hello] Error:", e.message);
        res.status(500).json({ error: e.message });
      }
    });
}

  module.exports = { setupRoutes };
