// P0 Test: Task CRUD operations
// Self-cleaning — creates test tasks and deletes them after

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { fetchJson, BASE } = require('./_helper');

const createdTaskIds = [];

after(async () => {
  // Clean up all created tasks
  for (const id of createdTaskIds) {
    try {
      await fetch(`${BASE}/api/tasks/${id}`, { method: 'DELETE' });
    } catch {
      // Ignore cleanup errors
    }
  }
});

describe('Tasks API', () => {

  it('POST /api/tasks creates a new task', async () => {
    const task = await fetchJson(`${BASE}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Test Task ' + Date.now(),
        description: 'Integration test task',
        participants: ['hermes-main'],
      }),
    });
    assert.ok(task.id, 'created task should have an id');
    assert.ok(task.id.startsWith('task-'), 'task id should start with task-');
    assert.strictEqual(task.status, 'discussing', 'new task should have status discussing');
    assert.ok(task.created_at, 'task should have created_at');
    createdTaskIds.push(task.id);
  });

  it('GET /api/tasks returns created task', async () => {
    // First create one
    const created = await fetchJson(`${BASE}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'List Test ' + Date.now() }),
    });
    createdTaskIds.push(created.id);

    const tasks = await fetchJson(`${BASE}/api/tasks`);
    const found = tasks.find(t => t.id === created.id);
    assert.ok(found, 'created task should appear in list');
    assert.strictEqual(found.title, created.title);
  });

  it('GET /api/tasks/:id returns single task', async () => {
    const created = await fetchJson(`${BASE}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Single Get Test ' + Date.now() }),
    });
    createdTaskIds.push(created.id);

    const task = await fetchJson(`${BASE}/api/tasks/${created.id}`);
    assert.strictEqual(task.id, created.id);
    assert.strictEqual(task.title, created.title);
  });

  it('GET /api/tasks/:id returns 404 for unknown task', async () => {
    const r = await fetch(`${BASE}/api/tasks/task-nonexistent-12345`);
    assert.strictEqual(r.status, 404);
  });

  it('PATCH /api/tasks/:id updates task title', async () => {
    const created = await fetchJson(`${BASE}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Before Update ' + Date.now() }),
    });
    createdTaskIds.push(created.id);

    const newTitle = 'Updated Title ' + Date.now();
    const updated = await fetchJson(`${BASE}/api/tasks/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle }),
    });
    assert.strictEqual(updated.title, newTitle);
  });

  it('DELETE /api/tasks/:id deletes a task', async () => {
    const created = await fetchJson(`${BASE}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Delete Me ' + Date.now() }),
    });

    const r = await fetch(`${BASE}/api/tasks/${created.id}`, { method: 'DELETE' });
    assert.strictEqual(r.status, 200);
    const data = await r.json();
    assert.strictEqual(data.success, true);

    // Verify it's gone
    const r2 = await fetch(`${BASE}/api/tasks/${created.id}`);
    assert.strictEqual(r2.status, 404);
  });

  it('POST /api/tasks without title returns 400', async () => {
    const r = await fetch(`${BASE}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'no title' }),
    });
    assert.strictEqual(r.status, 400);
  });
});
