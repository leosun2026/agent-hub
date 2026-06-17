// P0 Test: Member CRUD operations + nickname persistence
// Self-cleaning — removes created test agents after tests

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { fetchJson, BASE, testId } = require('./_helper');

const createdAgentIds = [];

after(async () => {
  // Clean up all created test agents
  for (const id of createdAgentIds) {
    try {
      await fetch(`${BASE}/api/members/${id}`, { method: 'DELETE' });
    } catch {
      // Ignore cleanup errors
    }
  }
});

describe('Members API', () => {

  it('POST /api/members creates a new agent', async () => {
    const agentId = testId('test-agent');
    const agent = await fetchJson(`${BASE}/api/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: agentId,
        name: 'Test Agent',
        role: 'executor',
      }),
    });
    createdAgentIds.push(agent.id);
    assert.strictEqual(agent.id, agentId);
    assert.strictEqual(agent.name, 'Test Agent');
    assert.strictEqual(agent.role, 'executor');
    assert.ok(agent.added_at, 'agent should have added_at');
  });

  it('POST /api/members with duplicate id returns 409', async () => {
    const agentId = testId('test-dup');
    await fetchJson(`${BASE}/api/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: agentId, name: 'First', role: 'executor' }),
    });
    createdAgentIds.push(agentId);

    const r = await fetch(`${BASE}/api/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: agentId, name: 'Second', role: 'specialist' }),
    });
    assert.strictEqual(r.status, 409);
  });

  it('POST /api/members validates required fields', async () => {
    const r1 = await fetch(`${BASE}/api/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'No ID', role: 'executor' }),
    });
    assert.strictEqual(r1.status, 400);

    const r2 = await fetch(`${BASE}/api/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'no-role', name: 'No Role' }),
    });
    assert.strictEqual(r2.status, 400);
  });

  it('POST /api/members validates role enum', async () => {
    const r = await fetch(`${BASE}/api/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'bad-role', name: 'Bad', role: 'invalid' }),
    });
    assert.strictEqual(r.status, 400);
  });

  it('POST /api/members validates id format (no special chars)', async () => {
    const r = await fetch(`${BASE}/api/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'bad id!@#', name: 'Bad', role: 'executor' }),
    });
    assert.strictEqual(r.status, 400);
  });

  it('PATCH /api/members/:id updates agent fields', async () => {
    const agentId = testId('test-upd');
    const created = await fetchJson(`${BASE}/api/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: agentId,
        name: 'Original Name',
        role: 'executor',
        nickname: 'OriginalNick',
      }),
    });
    createdAgentIds.push(agentId);

    const updated = await fetchJson(`${BASE}/api/members/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Name', nickname: 'UpdatedNick' }),
    });
    assert.strictEqual(updated.name, 'Updated Name');
    assert.strictEqual(updated.nickname, 'UpdatedNick');
  });

  it('DELETE /api/members/:id removes an agent', async () => {
    const agentId = testId('test-del');
    await fetchJson(`${BASE}/api/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: agentId, name: 'Delete Me', role: 'executor' }),
    });

    const r = await fetch(`${BASE}/api/members/${agentId}`, { method: 'DELETE' });
    assert.strictEqual(r.status, 200);
    const data = await r.json();
    assert.ok(data.deleted);

    // Verify agent is gone from the list
    const agents = await fetchJson(`${BASE}/api/agents`);
    const found = agents.find(a => a.id === agentId);
    assert.ok(!found, 'deleted agent should not appear in list');
  });

  it('DELETE /api/members/:id with unknown id returns error', async () => {
    const r = await fetch(`${BASE}/api/members/nonexistent-agent-xyz`, { method: 'DELETE' });
    assert.strictEqual(r.status, 400);
  });
});
