// P0 Smoke Test: Server health endpoints
// Read-only, no side effects — safe to run anytime

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { fetchJson, BASE } = require('./_helper');

describe('Server Health', () => {

  it('GET /api/health returns ok with uptime', async () => {
    const data = await fetchJson(`${BASE}/api/health`);
    assert.strictEqual(data.status, 'ok');
    assert.ok(typeof data.uptime === 'number', 'uptime should be a number');
    assert.ok(data.uptime >= 0, 'uptime should be >= 0');
  });

  it('GET /api/basepath returns a valid basePath', async () => {
    const data = await fetchJson(`${BASE}/api/basepath`);
    assert.ok(data.basePath, 'basePath should exist');
    assert.ok(data.basePath.includes('Agent-Hub'), 'basePath should contain Agent-Hub');
  });

  it('GET /api/log returns log output (or empty)', async () => {
    const r = await fetch(`${BASE}/api/log`);
    assert.ok([200, 500].includes(r.status), 'log endpoint should respond');
    if (r.ok) {
      const text = await r.text();
      assert.ok(typeof text === 'string');
    }
  });

  it('GET /api/agents returns agent list', async () => {
    const data = await fetchJson(`${BASE}/api/agents`);
    assert.ok(Array.isArray(data), 'agents should be an array');
    assert.ok(data.length > 0, 'should have at least one agent');
    // Each agent should have id, name, role
    for (const agent of data) {
      assert.ok(agent.id, `agent should have id (got ${JSON.stringify(agent)})`);
      assert.ok(agent.name, `agent should have name`);
      assert.ok(agent.role, `agent should have role`);
    }
  });

  it('GET /api/rooms returns room list', async () => {
    const data = await fetchJson(`${BASE}/api/rooms`);
    assert.ok(Array.isArray(data), 'rooms should be an array');
    assert.ok(data.length > 0, 'should have at least one room');
    // Check default room exists
    const general = data.find(r => r.id === 'room-general');
    assert.ok(general, 'room-general should exist');
    assert.ok(general.name, 'room should have a name');
    assert.ok(Array.isArray(general.members), 'room should have members array');
  });

  it('GET /api/tasks returns task list', async () => {
    const data = await fetchJson(`${BASE}/api/tasks`);
    assert.ok(Array.isArray(data), 'tasks should be an array');
  });
});
