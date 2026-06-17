// P0 Test: Message API — loading, posting, recent messages first
// Critical regression: "only first 50 messages" bug must not recur

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { fetchJson, BASE } = require('./_helper');

const createdMsgIds = [];

after(async () => {
  // No need to clean messages (DELETE by date not available for test-prefixed),
  // but we should try to remove test data
});

describe('Messages API', () => {

  it('POST /api/messages creates a message (verify by fetching it back)', async () => {
    const ts = Date.now();
    const content = 'Hello from test ' + ts;
    const r = await fetch(`${BASE}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: 'test-user',
        role: 'user',
        content: content,
      }),
    });
    assert.strictEqual(r.status, 200, 'POST should succeed');

    // Verify the message was actually stored by fetching recent messages
    const msgs = await fetchJson(`${BASE}/api/messages?limit=100`);
    const found = msgs.find(m => m.content === content);
    assert.ok(found, 'posted message should be findable in message list');
    assert.strictEqual(found.role, 'user');
    assert.strictEqual(found.agent_id, 'test-user');
  });

  it('GET /api/messages returns messages array', async () => {
    const msgs = await fetchJson(`${BASE}/api/messages`);
    assert.ok(Array.isArray(msgs), 'messages should be an array');
    assert.ok(msgs.length > 0, 'should have at least one message');
    // Each message should have core fields
    const msg = msgs[0];
    assert.ok(msg.id, 'message should have id');
    assert.ok(msg.content !== undefined, 'message should have content');
    assert.ok(msg.role, 'message should have role (user/agent/system)');
    assert.ok(msg.created_at, 'message should have created_at');
  });

  it('GET /api/messages returns newest messages LAST (regression check)', async () => {
    // Post 3 messages and verify ordering (oldest-first after DESC+reverse fix)
    const ts = Date.now();
    const contents = [
      `Regression test message A ${ts}`,
      `Regression test message B ${ts}`,
      `Regression test message C ${ts}`,
    ];

    for (const content of contents) {
      const r = await fetch(`${BASE}/api/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: 'test-user',
          role: 'user',
          content: content,
        }),
      });
      assert.strictEqual(r.status, 200, `POST ${content} should succeed`);
    }

    // Fetch messages and find our test messages
    const msgs = await fetchJson(`${BASE}/api/messages?limit=100`);
    const testMsgs = msgs.filter(m => m.content && m.content.includes(String(ts)));
    assert.ok(testMsgs.length >= 3,
      `should find at least 3 test messages, found ${testMsgs.length}`);

    // CRITICAL CHECK: messages array should be oldest-first (DESC + .reverse())
    // So message A (first posted) should come before message C (last posted)
    const idxA = msgs.findIndex(m => m.content === contents[0]);
    const idxC = msgs.findIndex(m => m.content === contents[2]);
    assert.ok(idxA >= 0, 'first message should be findable');
    assert.ok(idxC >= 0, 'third message should be findable');
    assert.ok(idxA < idxC,
      'oldest message should come before newest (oldest-first ordering)');
    console.log(`  Ordering: A at index ${idxA}, C at index ${idxC}`);
  });

  it('GET /api/messages with room_id filters correctly', async () => {
    const msgs = await fetchJson(`${BASE}/api/messages?room_id=room-general`);
    assert.ok(Array.isArray(msgs));
    // All returned messages should have room_id === 'room-general' (or null for legacy messages)
    for (const msg of msgs) {
      assert.ok(msg.room_id === 'room-general' || msg.room_id === null,
        `message ${msg.id} should have room_id room-general or null, got ${msg.room_id}`);
    }
  });

  it('GET /api/messages with since parameter returns only newer messages', async () => {
    // Get the current latest message id
    const allMsgs = await fetchJson(`${BASE}/api/messages?limit=10`);
    if (allMsgs.length === 0) return; // Skip if no messages

    const latestId = allMsgs[allMsgs.length - 1].id;

    // Post a new message
    const newMsg = await fetchJson(`${BASE}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: 'test-user',
        role: 'user',
        content: 'Since test ' + Date.now(),
      }),
    });

    // Fetch with since=latestId — should only return messages AFTER latestId
    const sinceMsgs = await fetchJson(`${BASE}/api/messages?since=${latestId}`);
    assert.ok(sinceMsgs.length >= 1, 'should return at least the new message');
    for (const msg of sinceMsgs) {
      assert.ok(msg.id > latestId, `message ${msg.id} should be > ${latestId}`);
    }
  });

  it('POST /api/messages without required fields returns 400', async () => {
    const r = await fetch(`${BASE}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: 'test' }),
    });
    assert.strictEqual(r.status, 400);
  });
});
