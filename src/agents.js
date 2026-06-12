// Agents module — Dynamic loading from agents.json
// Supports live add/remove/update without server restart

const fs = require('fs');
const path = require('path');

const AGENTS_PATH = path.join(__dirname, '..', 'agents.json');

// In-memory agent cache
let AGENTS = [];
let AGENT_MAP = {};

// === Load / Reload ===

function loadAgents() {
  try {
    const raw = fs.readFileSync(AGENTS_PATH, 'utf-8');
  // Strip BOM if present
  const clean = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
  const data = JSON.parse(clean);
    
    AGENTS = data.agents || [];
    AGENT_MAP = {};
    AGENTS.forEach(a => { AGENT_MAP[a.id] = a; });
    console.log('[Agents] Loaded ' + AGENTS.length + ' agents from agents.json');
    return AGENTS;
  } catch (err) {
    console.error('[Agents] Failed to load agents.json:', err.message);
    return [];
  }
}

function reloadAgents() {
  return loadAgents();
}

// === Read ===

function getAgent(id) {
  const agent = AGENT_MAP[id];
  if (!agent) return null;
  // Deep clone to prevent external mutation
  return JSON.parse(JSON.stringify(agent));
}

function listAgents() {
  return AGENTS.map(a => JSON.parse(JSON.stringify(a)));
}

// === Write (double-writes to agents.json + returns the agent for db sync) ===

function saveAgentsToFile() {
  const data = { agents: AGENTS };
  fs.writeFileSync(AGENTS_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function addAgent(agentData) {
  // Validation
  if (!agentData.id || !agentData.name || !agentData.role) {
    throw new Error('id, name, role are required');
  }
  if (AGENT_MAP[agentData.id]) {
    throw new Error('Agent id "' + agentData.id + '" already exists');
  }

  const now = new Date().toISOString();
  const agent = {
    id: agentData.id,
    name: agentData.name,
    role: agentData.role,
    avatar: agentData.avatar || '🤖',
    endpoint: agentData.endpoint || null,
    model: agentData.model || null,
    auth: agentData.auth || null,
    system_prompt: agentData.system_prompt || null,
    capabilities: agentData.capabilities || [],
    group_permissions: {
      receive_all: agentData.group_permissions?.receive_all ?? true,
      receive_at_only: agentData.group_permissions?.receive_at_only ?? false,
      can_send_active: agentData.group_permissions?.can_send_active ?? true,
      can_see_history: agentData.group_permissions?.can_see_history ?? true,
    },
    nickname: agentData.nickname || null,
    added_at: agentData.added_at || now,
    added_by: agentData.added_by || 'user',
  };

  AGENTS.push(agent);
  AGENT_MAP[agent.id] = agent;
  saveAgentsToFile();
  console.log('[Agents] Added agent:', agent.id, agent.name);
  return JSON.parse(JSON.stringify(agent));
}

function removeAgent(id) {
  const idx = AGENTS.findIndex(a => a.id === id);
  if (idx === -1) {
    throw new Error('Agent "' + id + '" not found');
  }
  const removed = AGENTS.splice(idx, 1)[0];
  delete AGENT_MAP[id];
  saveAgentsToFile();
  console.log('[Agents] Removed agent:', id, removed.name);
  return JSON.parse(JSON.stringify(removed));
}

function updateAgent(id, updates) {
  const idx = AGENTS.findIndex(a => a.id === id);
  if (idx === -1) {
    throw new Error('Agent "' + id + '" not found');
  }

  const allowedFields = ['name', 'role', 'avatar', 'endpoint', 'model', 'auth',
    'system_prompt', 'capabilities', 'group_permissions', 'nickname', 'note'];

  for (const key of allowedFields) {
    if (updates[key] !== undefined) {
      AGENTS[idx][key] = updates[key];
    }
  }

  // Refresh map reference
  AGENT_MAP[id] = AGENTS[idx];
  saveAgentsToFile();
  console.log('[Agents] Updated agent:', id);
  return JSON.parse(JSON.stringify(AGENTS[idx]));
}

// === Agent Call ===

async function callAgent(agentId, messages) {
  // Re-read from memory (may have been added dynamically)
  const agent = AGENT_MAP[agentId];
  if (!agent) throw new Error('Unknown agent: ' + agentId);
  if (!agent.endpoint) throw new Error('Agent ' + agentId + ' has no endpoint');

  const payload = {
    model: agent.model || 'deepseek-v4-flash',
    messages: [],
  };

  if (agent.system_prompt) {
    payload.messages.push({ role: 'system', content: agent.system_prompt });
  }

  payload.messages.push(...messages);

  const headers = { 'Content-Type': 'application/json' };

  // If auth starts with '\$', resolve from environment variable
  if (agent.auth && agent.auth.startsWith('$')) {
    const envKey = agent.auth.slice(1);
    agent.auth = process.env[envKey] || null;
  }

  if (agent.auth) {
    headers['Authorization'] = agent.auth.startsWith('Bearer ') ? agent.auth : 'Bearer ' + agent.auth;
  }

  const resp = await fetch(agent.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error('Agent ' + agentId + ' returned ' + resp.status + ': ' + text.slice(0, 200));
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || JSON.stringify(data);
  return { agentId, agentName: agent.name, content };
}

// === Status Check ===

async function checkAgentStatus(agentId) {
  const agent = AGENT_MAP[agentId];
  if (!agent || !agent.endpoint) return { agentId, online: false, reason: 'no endpoint' };

  try {
    // Resolve $env var prefix before using auth
    if (agent.auth && agent.auth.startsWith('$')) {
      const envKey = agent.auth.slice(1);
      agent.auth = process.env[envKey] || null;
    }
    const url = agent.endpoint.replace('/v1/chat/completions', '/v1/models');
    const headers = {};
    if (agent.auth) headers['Authorization'] = agent.auth.startsWith('Bearer ') ? agent.auth : 'Bearer ' + agent.auth;

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 5000);

    const resp = await fetch(url, { headers, signal: ctrl.signal });
    clearTimeout(timeout);

    return { agentId, online: resp.ok };
  } catch (e) {
    return { agentId, online: false, reason: e.message };
  }
}

async function checkAllAgentsStatus() {
  const agentsWithEndpoint = AGENTS.filter(a => a.endpoint);
  const results = await Promise.all(
    agentsWithEndpoint.map(a => checkAgentStatus(a.id))
  );
  return results;
}

// === Get agent by name (for @mention matching) ===
function findAgentByNameOrAlias(nameOrAlias) {
  const lower = (nameOrAlias || '').toLowerCase();
  return AGENTS.find(a =>
    a.id.toLowerCase() === lower ||
    a.name.toLowerCase() === lower ||
    (a.nickname && a.nickname.toLowerCase() === lower)
  );
}

// === Initial load ===
loadAgents();

module.exports = {
  getAgent,
  listAgents,
  addAgent,
  removeAgent,
  updateAgent,
  reloadAgents,
  callAgent,
  checkAgentStatus,
  checkAllAgentsStatus,
  findAgentByNameOrAlias,
  // Expose for rooms module compatibility
  get AGENTS() { return AGENTS; },
};

