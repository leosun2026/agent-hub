// Routes module — REST API
// Features: members CRUD, rooms, messages, tasks

const crypto = require('crypto');
const db = require('./db');
const agents = require('./agents');
const tasksMod = require('./tasks');
const roomsMod = require('./rooms');

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
  app.post('/api/members', (req, res) => {
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

      // Check for duplicate
      const existing = agents.getAgent(data.id);
      if (existing) {
        return res.status(409).json({ error: 'Agent id "' + data.id + '" already exists' });
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
  app.patch('/api/members/:id', (req, res) => {
    try {
      const id = req.params.id;
      const updated = agents.updateAgent(id, req.body);

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
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const current = db.getTask(req.params.id);
    if (!current) return res.status(404).json({ error: 'Task not found' });
    const updated = db.updateTaskTitle(req.params.id, title);
    res.json(updated);
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

}

module.exports = { setupRoutes };
