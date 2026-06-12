// Room management module — Group chat room management
// Enhanced: name+alias @mention, companion list injection, replyTo context, nickname override

const agents = require('./agents');

// Default room configuration
const DEFAULT_ROOM = {
  id: 'room-general',
  name: 'Main Hall',
  mode: 'broadcast',
};

/**
 * Get all agent IDs that have endpoints
 */
function getAllAgentIds() {
  const allAgents = agents.AGENTS || agents.listAgents();
  return allAgents.filter(a => a.endpoint).map(a => a.id);
}

/**
 * Get default room definition
 */
function getDefaultRoom() {
  return {
    ...DEFAULT_ROOM,
    members: getAllAgentIds(),
  };
}

/**
 * Initialize default room if it doesn't exist
 */
function initDefaultRoom(db) {
  const existing = db.getRoom(DEFAULT_ROOM.id);
  if (!existing) {
    const room = getDefaultRoom();
    db.createRoom(room);
    console.log('[Rooms] Default room created:', room.id, 'members:', room.members.length);
  } else {
    // Sync new agents from agents.json into default room
    const currentMembers = existing.members || [];
    const allIds = getAllAgentIds();
    const newMembers = allIds.filter(id => !currentMembers.includes(id));
    if (newMembers.length > 0) {
      const updated = [...currentMembers, ...newMembers];
      db.updateRoomMembers(DEFAULT_ROOM.id, updated);
      console.log('[Rooms] Added new members to default room:', newMembers.join(', '));
    }
  }
  return db.getRoom(DEFAULT_ROOM.id);
}

/**
 * Get room agents with endpoints, respecting group_permissions
 */
function getRoomAgents(room, excludeSender, content) {
  const members = room.members || [];
  let agentIds = members;

  // Exclude sender (prevent self-reply)
  if (excludeSender) {
    agentIds = agentIds.filter(id => id !== excludeSender);
  }

  const allAgents = agents.AGENTS || agents.listAgents();
  const roomMode = room.mode || 'broadcast';

  return agentIds
    .map(id => {
      const agent = allAgents.find(a => a.id === id);
      return agent && agent.endpoint ? agent : null;
    })
    .filter(agent => {
      if (!agent) return false;

      // Check group_permissions
      const perms = agent.group_permissions || {};

      if (roomMode === 'mention-only') {
        // In mention-only mode, agent must have receive_at_only
        return perms.receive_at_only !== false;
      }

      // In broadcast mode, agent must have receive_all
      if (perms.receive_all === false) {
        return false;
      }

      return true;
    });
}

/**
 * Build group chat messages array for agent API call
 */
function buildGroupChatMessages(room, history, currentMsg, agent, isMentioned) {
  const messages = [];

  // System prompt: group chat behavior instructions
  const groupInstructions = buildGroupInstructions(room, agent, isMentioned);
  messages.push({ role: 'system', content: groupInstructions });

  // Companion list (NEW)
  const companionList = buildCompanionList(room, agent.id, currentMsg.sender_id);
  if (companionList) {
    messages.push({ role: 'system', content: companionList });
  }

  // Recent conversation history (as context)
  const recentHistory = history.slice(-20);
  for (const msg of recentHistory) {
    if (msg.role === 'system') continue;
    if (msg.agent_id === agent.id) {
      messages.push({ role: 'assistant', content: msg.content });
    } else {
      const senderLabel = getSenderLabel(msg.agent_id);
      messages.push({
        role: 'user',
        content: '[' + senderLabel + ']: ' + msg.content
      });
    }
  }

  // Current message
  const senderLabel = currentMsg.sender_id === 'user' ? 'Boss' : getSenderLabel(currentMsg.sender_id);
  let content = '[' + senderLabel + ']: ' + currentMsg.content;

  // Reply-to context injection (NEW)
  if (currentMsg.reply_to) {
    content = '[Reply to ' + currentMsg.reply_to + '] ' + content;
  }

  messages.push({ role: 'user', content: content });

  return messages;
}

/**
 * Build system prompt instructions for group chat
 */
function buildGroupInstructions(room, agent, isMentioned) {
  const displayName = agent.nickname || agent.name;
  let instructions = '[Group Chat Mode]\n';
  instructions += 'You are a member of the "' + room.name + '" chat room. Your name is "' + displayName + '" (ID: ' + agent.id + ').\n';
  instructions += 'You will receive all messages in this room. Please follow these rules:\n\n';

  instructions += '1. **Relevance**: If the current message relates to your expertise, or you have valuable input, please respond.\n';
  instructions += '2. **Silence principle**: If the message is completely irrelevant to you, please do NOT respond (output "[SILENT]" only).\n';
  instructions += '3. **When @mentioned, MUST respond**';

  if (isMentioned) {
    instructions += ': You have been @mentioned! You MUST give a substantive response. Do NOT be silent.\n';
  } else {
    instructions += ': You are not @mentioned, you may freely choose whether to respond.\n';
  }

  instructions += '\n4. **Response style**:\n';
  instructions += '   - Concise, conversational, like chatting with colleagues\n';
  instructions += '   - Do not use customer-service phrases like "How may I help you"\n';
  instructions += '   - Be direct, 1-3 sentences preferred\n';
  instructions += '5. **Do not reply to yourself**: Do not respond to your own previous messages\n';
  instructions += '6. **No meaningless filler**: Do not say "OK", "Received", "Understood" with no additional value\n';
  instructions += '7. **You may challenge/supplement**: If you find issues with other agents or users, politely point them out or supplement\n';
  instructions += '8. **You can @mention others**: Use @Name to directly address other participants in the room\n\n';
  instructions += '[IMPORTANT] If you decide NOT to respond, output only "[SILENT]" (without quotes) as content.\n';

  return instructions;
}

/**
 * Build companion list for the system prompt (NEW)
 */
function buildCompanionList(room, currentAgentId, senderId) {
  const allAgents = agents.AGENTS || agents.listAgents();
  const memberIds = room.members || [];

  const companions = memberIds
    .filter(id => id !== currentAgentId)
    .map(id => {
      const a = allAgents.find(ag => ag.id === id);
      if (!a) return null;
      const displayName = a.nickname || a.name;
      const isSender = id === senderId;
      return {
        id: a.id,
        name: displayName,
        role: a.role,
        isSender: isSender,
      };
    })
    .filter(Boolean);

  if (companions.length === 0) return null;

  let list = '[Room Companions]\nOther participants in this room you can interact with:\n';
  for (const c of companions) {
    const senderTag = c.isSender ? ' [CURRENT SPEAKER]' : '';
    list += '- ' + c.name + ' (' + c.role + ')' + senderTag + ' — @mention with: @' + c.name + '\n';
  }
  list += '\nYou can @mention any companion above to directly address them.';

  return list;
}

/**
 * Get sender display label
 */
function getSenderLabel(agentId) {
  if (!agentId || agentId === 'user') return 'Boss';
  const allAgents = agents.AGENTS || agents.listAgents();
  const agent = allAgents.find(a => a.id === agentId);
  return agent ? (agent.nickname || agent.name) : (agentId || 'Unknown');
}

/**
 * Check if a message @mentions a specific agent (enhanced: match name + id + alias)
 */
function isAgentMentioned(content, agentId) {
  if (!content) return false;

  // Check @all / @everyone
  if (/@all\b|@everyone\b/i.test(content)) return true;

  // Check @agentId
  if (new RegExp('@' + escapeRegex(agentId) + '\\b', 'i').test(content)) return true;

  // Check @name (Chinese + English) and @nickname
  const allAgents = agents.AGENTS || agents.listAgents();
  const agent = allAgents.find(a => a.id === agentId);
  if (!agent) return false;

  // Match by name
  if (agent.name && new RegExp('@' + escapeRegex(agent.name) + '\\b', 'i').test(content)) {
    return true;
  }

  // Match by nickname (if set)
  if (agent.nickname && new RegExp('@' + escapeRegex(agent.nickname) + '\\b', 'i').test(content)) {
    return true;
  }

  return false;
}

/**
 * Extract @mentioned agent IDs from content (enhanced)
 */
function extractMentions(content) {
  if (!content) return [];
  const matches = content.match(/@(\S+)/g);
  if (!matches) return [];

  const mentionedNames = matches.map(m => m.slice(1));
  const allAgents = agents.AGENTS || agents.listAgents();
  const results = [];

  for (const name of mentionedNames) {
    // Try exact match by id, name, or nickname
    const found = agents.findAgentByNameOrAlias(name);
    if (found) {
      results.push(found.id);
    }
  }
  return results;
}

/**
 * Check if message contains @all / @everyone
 */
function isMentionAll(content) {
  return /@all\b|@everyone\b/i.test(content);
}

function escapeRegex(str) {
  return (str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  DEFAULT_ROOM,
  getDefaultRoom,
  getAllAgentIds,
  initDefaultRoom,
  getRoomAgents,
  buildGroupChatMessages,
  buildGroupInstructions,
  buildCompanionList,
  getSenderLabel,
  isAgentMentioned,
  extractMentions,
  isMentionAll,
};
