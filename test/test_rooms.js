// P1 Test: Room operations — get, create, delete, members, mode

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { fetchJson, BASE, testId } = require('./_helper');

const createdRoomIds = [];

after(async () => {
  // Clean up created rooms
  for (const id of createdRoomIds) {
    try {
      await fetch(`${BASE}/api/rooms/${id}`, { method: 'DELETE' });
    } catch {
      // Ignore
    }
  }
});

describe('Rooms API', () => {

  it('GET /api/rooms returns all rooms', async () => {
    const rooms = await fetchJson(`${BASE}/api/rooms`);
    assert.ok(Array.isArray(rooms));
    const general = rooms.find(r => r.id === 'room-general');
    assert.ok(general, 'room-general should exist');
    assert.strictEqual(general.mode, 'broadcast');
  });

  it('GET /api/rooms/:id returns room details with memberDetails', async () => {
    const room = await fetchJson(`${BASE}/api/rooms/room-general`);
    assert.strictEqual(room.id, 'room-general');
    assert.ok(room.name);
    assert.ok(room.mode);
    assert.ok(Array.isArray(room.members));
    assert.ok(Array.isArray(room.memberDetails), 'room should have memberDetails array');
    if (room.memberDetails.length > 0) {
      const m = room.memberDetails[0];
      assert.ok(m.id, 'member should have id');
      assert.ok(m.name, 'member should have name');
    }
  });

  it('GET /api/rooms/:id returns 404 for unknown room', async () => {
    const r = await fetch(`${BASE}/api/rooms/room-nonexistent-999`);
    assert.strictEqual(r.status, 404);
  });

  it('POST /api/rooms creates a new room', async () => {
    const roomName = 'Test Room ' + Date.now();
    const room = await fetchJson(`${BASE}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: roomName, mode: 'broadcast' }),
    });
    createdRoomIds.push(room.id);
    assert.ok(room.id.startsWith('room-'), 'room id should start with room-');
    assert.strictEqual(room.name, roomName);
    assert.strictEqual(room.mode, 'broadcast');
    assert.ok(Array.isArray(room.members));
  });

  it('POST /api/rooms creates mention-only room', async () => {
    const roomName = 'Mention Only ' + Date.now();
    const room = await fetchJson(`${BASE}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: roomName, mode: 'mention-only' }),
    });
    createdRoomIds.push(room.id);
    assert.strictEqual(room.mode, 'mention-only');
  });

  it('POST /api/rooms without name returns 400', async () => {
    const r = await fetch(`${BASE}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'broadcast' }),
    });
    assert.strictEqual(r.status, 400);
  });

  it('PUT /api/rooms/:id/mode updates room mode', async () => {
    const room = await fetchJson(`${BASE}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Mode Test ' + Date.now() }),
    });
    createdRoomIds.push(room.id);

    const updated = await fetchJson(`${BASE}/api/rooms/${room.id}/mode`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'mention-only' }),
    });
    assert.strictEqual(updated.mode, 'mention-only');
  });

  it('PUT /api/rooms/:id/members updates room members', async () => {
    // Get the current members list
    const room = await fetchJson(`${BASE}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Members Test ' + Date.now() }),
    });
    createdRoomIds.push(room.id);

    // Update members to empty (all removed)
    const updated = await fetchJson(`${BASE}/api/rooms/${room.id}/members`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ members: [] }),
    });
    assert.ok(Array.isArray(updated.members));
    assert.strictEqual(updated.members.length, 0);
  });

  it('DELETE /api/rooms/:id deletes a room', async () => {
    const room = await fetchJson(`${BASE}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Delete Me ' + Date.now() }),
    });

    const r = await fetch(`${BASE}/api/rooms/${room.id}`, { method: 'DELETE' });
    assert.strictEqual(r.status, 200);
    const data = await r.json();
    assert.ok(data.deleted);

    // Verify gone
    const r2 = await fetch(`${BASE}/api/rooms/${room.id}`);
    assert.strictEqual(r2.status, 404);
  });

  it('DELETE /api/rooms/room-general returns 400 (protected)', async () => {
    const r = await fetch(`${BASE}/api/rooms/room-general`, { method: 'DELETE' });
    assert.strictEqual(r.status, 400);
    const data = await r.json();
    assert.ok(data.error.includes('default room'), 'should mention default room protection');
  });

  it('PATCH /api/rooms/:roomId/members/:agentId/nickname sets nickname', async () => {
    // Use first real agent in room-general
    const room = await fetchJson(`${BASE}/api/rooms/room-general`);
    if (room.members.length === 0) return; // skip if no members

    const agentId = room.members[0];
    const testNick = 'Tst_' + Date.now().toString().slice(-8); // Max 13 chars = under 20 limit

    const result = await fetchJson(
      `${BASE}/api/rooms/room-general/members/${agentId}/nickname`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: testNick }),
      }
    );
    assert.strictEqual(result.room_id, 'room-general');
    assert.strictEqual(result.agent_id, agentId);
    assert.strictEqual(result.nickname, testNick);

    // Verify via GET nicknames
    const nicks = await fetchJson(`${BASE}/api/rooms/room-general/nicknames`);
    assert.strictEqual(nicks[agentId], testNick);

    // Clean up — remove nickname
    await fetchJson(`${BASE}/api/rooms/room-general/members/${agentId}/nickname`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: null }),
    });
  });

  it('GET /api/rooms/:roomId/nicknames returns nicknames', async () => {
    const nicks = await fetchJson(`${BASE}/api/rooms/room-general/nicknames`);
    assert.ok(typeof nicks === 'object', 'nicknames should be an object');
    // Should be a map of agentId -> nickname
  });

  it('DELETE /api/rooms/:roomId/members/:agentId removes agent from room', async () => {
    // Create a room with a test agent
    const agentId = 'test-room-member-' + Date.now();
    await fetchJson(`${BASE}/api/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: agentId, name: 'Room Test', role: 'executor' }),
    });

    const room = await fetchJson(`${BASE}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Room Remove Test ' + Date.now(),
        members: [agentId],
      }),
    });

    const r = await fetch(`${BASE}/api/rooms/${room.id}/members/${agentId}`, { method: 'DELETE' });
    assert.strictEqual(r.status, 200);

    // Clean up
    await fetch(`${BASE}/api/members/${agentId}`, { method: 'DELETE' });
    await fetch(`${BASE}/api/rooms/${room.id}`, { method: 'DELETE' });
  });
});
