// Database module — SQLite via sql.js
// Tables: messages, tasks, rooms, agents

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

// Project-relative DB path (GitHub-friendly)
const DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'hub.db');

let db = null;
let SQL = null;

async function getDb() {
  if (db) return db;
  SQL = await initSqlJs();

  // Ensure data directory exists
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }
  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA busy_timeout = 3000');
  initSchema();
  return db;
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  fs.writeFileSync(DB_PATH, buffer);
}

function initSchema() {
  // === messages ===
  db.run("CREATE TABLE IF NOT EXISTS messages (" +
    "id INTEGER PRIMARY KEY AUTOINCREMENT," +
    "task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE," +
    "agent_id TEXT," +
    "role TEXT NOT NULL CHECK(role IN ('user','agent','system'))," +
    "content TEXT NOT NULL," +
    "metadata TEXT DEFAULT '{}'," +
    "created_at TEXT DEFAULT (datetime('now')))");

  // === tasks ===
  db.run("CREATE TABLE IF NOT EXISTS tasks (" +
    "id TEXT PRIMARY KEY," +
    "title TEXT NOT NULL," +
    "description TEXT DEFAULT ''," +
    "status TEXT NOT NULL DEFAULT 'discussing'" +
    "  CHECK(status IN ('discussing','planning','confirming','executing','reviewing','done','cancelled'))," +
    "plan_json TEXT," +
    "result_json TEXT," +
    "participants TEXT DEFAULT '[]'," +
    "created_at TEXT DEFAULT (datetime('now'))," +
    "updated_at TEXT DEFAULT (datetime('now')))");

  // === rooms ===
  db.run("CREATE TABLE IF NOT EXISTS rooms (" +
    "id TEXT PRIMARY KEY," +
    "name TEXT NOT NULL," +
    "mode TEXT NOT NULL DEFAULT 'broadcast' CHECK(mode IN ('broadcast','mention-only'))," +
    "members TEXT NOT NULL DEFAULT '[]'," +
    "created_at TEXT DEFAULT (datetime('now')))");

  // === agents (NEW) ===
  db.run("CREATE TABLE IF NOT EXISTS agents (" +
    "id TEXT PRIMARY KEY," +
    "name TEXT NOT NULL," +
    "role TEXT NOT NULL," +
    "avatar TEXT DEFAULT '🤖'," +
    "endpoint TEXT," +
    "model TEXT," +
    "auth TEXT," +
    "system_prompt TEXT," +
    "capabilities TEXT DEFAULT '[]'," +
    "group_permissions TEXT DEFAULT '{}'," +
    "nickname TEXT," +
    "added_at TEXT DEFAULT (datetime('now'))," +
    "added_by TEXT DEFAULT 'user')");

  // === room_members — per-room agent nicknames ===
  db.run("CREATE TABLE IF NOT EXISTS room_members (" +
    "room_id TEXT NOT NULL REFERENCES rooms(id)," +
    "agent_id TEXT NOT NULL," +
    "nickname TEXT," +
    "PRIMARY KEY (room_id, agent_id))");

  // === Column migrations ===
  try {
    db.run("ALTER TABLE messages ADD COLUMN room_id TEXT REFERENCES rooms(id)");
  } catch (e) { /* column already exists */ }

  // === Indexes ===
  db.run("CREATE INDEX IF NOT EXISTS idx_messages_task ON messages(task_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at)");
  db.run("CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)");
  db.run("CREATE INDEX IF NOT EXISTS idx_rooms_mode ON rooms(mode)");
  db.run("CREATE INDEX IF NOT EXISTS idx_agents_role ON agents(role)");
  // === settings (key-value store for rules, etc.) ===
  db.run("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");

  saveDb();
}

// === Generic query utilities ===

function queryAll(sql, params) {
  params = params || [];
  var stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  var rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOne(sql, params) {
  var rows = queryAll(sql, params);
  return rows.length ? rows[0] : null;
}

function run(sql, params) {
  params = params || [];
  db.run(sql, params);
  var row = queryOne('SELECT last_insert_rowid() AS id');
  saveDb();
  return row ? row.id : null;
}

// === Messages ===

function saveMessage(opts) {
  var id = run(
    'INSERT INTO messages (task_id, agent_id, role, content, metadata, room_id) VALUES (?, ?, ?, ?, ?, ?)',
    [
      opts.task_id || null,
      opts.agent_id || null,
      opts.role,
      opts.content,
      JSON.stringify(opts.metadata || {}),
      opts.room_id || null
    ]
  );
  return { id: id };
}

function getMessages(opts) {
  var sql = 'SELECT * FROM messages WHERE 1=1';
  var params = [];

  if (opts.room_id) {
    sql += ' AND room_id = ?';
    params.push(opts.room_id);
  }

  if (opts.task_id) {
    sql += ' AND task_id = ?';
    params.push(opts.task_id);
  } else if (!opts.room_id) {
    sql += ' AND task_id IS NULL';
  }

  // Filter by days (e.g. last 5 days)
  if (opts.days) {
    sql += ' AND created_at >= datetime(\'now\', ?)';
    params.push('-' + opts.days + ' days');
  }

  if (opts.since) {
    sql += ' AND id > ?';
    params.push(opts.since);
    sql += ' ORDER BY id ASC LIMIT ?';
    params.push(opts.limit || 500);
    return queryAll(sql, params);
  }

  // Default: most recent N messages (DESC + reverse → oldest-first)
  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(opts.limit || 500);
  return queryAll(sql, params).reverse();
}

// === Delete messages by date ===
function deleteMessagesByDate(opts) {
  var sql = "DELETE FROM messages WHERE substr(created_at, 1, 10) = ?";
  var params = [opts.date_key];
  
  if (opts.room_id) {
    sql += " AND room_id = ?";
    params.push(opts.room_id);
  }
  
  db.run(sql, params);
  saveDb();
  return { deleted: true };
}

// === Tasks ===

function createTask(opts) {
  run(
    "INSERT INTO tasks (id, title, description, status, participants) VALUES (?, ?, ?, 'discussing', ?)",
    [opts.id, opts.title, opts.description || '', JSON.stringify(opts.participants || [])]
  );
  return getTask(opts.id);
}

function getTask(id) {
  var task = queryOne('SELECT * FROM tasks WHERE id = ?', [id]);
  if (task) {
    task.participants = safeParse(task.participants, []);
    task.plan_json = safeParse(task.plan_json, null);
    task.result_json = safeParse(task.result_json, null);
  }
  return task;
}

function listTasks(status) {
  var sql = "SELECT * FROM tasks WHERE status != 'cancelled'";
  var params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY updated_at DESC';
  return queryAll(sql, params).map(function(t) {
    return {
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      plan_json: safeParse(t.plan_json, null),
      result_json: safeParse(t.result_json, null),
      participants: safeParse(t.participants, []),
      created_at: t.created_at,
      updated_at: t.updated_at,
    };
  });
}

function updateTaskStatus(id, status) {
  run("UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?", [status, id]);
  return getTask(id);
}

function updateTaskPlan(id, plan) {
  run("UPDATE tasks SET plan_json = ?, status = 'confirming', updated_at = datetime('now') WHERE id = ?",
    [JSON.stringify(plan), id]);
  return getTask(id);
}

function deleteTask(id) {
  run("DELETE FROM tasks WHERE id = ?", [id]);
  return { success: true };
}

function updateTaskTitle(id, title) {
  run("UPDATE tasks SET title = ?, updated_at = datetime('now') WHERE id = ?", [title, id]);
  return getTask(id);
}
function updateTaskParticipants(id, participants) {
  run("UPDATE tasks SET participants = ?, updated_at = datetime('now') WHERE id = ?", [JSON.stringify(participants || []), id]);
  return getTask(id);
}



function updateTaskResult(id, result) {
  run("UPDATE tasks SET result_json = ?, status = 'reviewing', updated_at = datetime('now') WHERE id = ?",
    [JSON.stringify(result), id]);
  return getTask(id);
}

// === Rooms ===

function createRoom(opts) {
  run(
    "INSERT INTO rooms (id, name, mode, members) VALUES (?, ?, ?, ?)",
    [opts.id, opts.name, opts.mode || 'broadcast', JSON.stringify(opts.members || [])]
  );
  return getRoom(opts.id);
}

function getRoom(id) {
  var room = queryOne('SELECT * FROM rooms WHERE id = ?', [id]);
  if (room) {
    room.members = safeParse(room.members, []);
  }
  return room;
}

function listRooms() {
  return queryAll('SELECT * FROM rooms ORDER BY created_at ASC').map(function(r) {
    return {
      id: r.id,
      name: r.name,
      mode: r.mode,
      members: safeParse(r.members, []),
      created_at: r.created_at,
    };
  });
}

function updateRoomMembers(id, members) {
  run("UPDATE rooms SET members = ? WHERE id = ?", [JSON.stringify(members), id]);
  return getRoom(id);
}

function updateRoomMode(id, mode) {
  run("UPDATE rooms SET mode = ? WHERE id = ?", [mode, id]);
  return getRoom(id);
}

function deleteRoom(id) {
  run("DELETE FROM rooms WHERE id = ?", [id]);
  run("DELETE FROM room_members WHERE room_id = ?", [id]);
  return { deleted: true };
}

// === Agents (NEW) ===

function saveAgentToDb(agent) {
  // Upsert: delete existing then insert
  run("DELETE FROM agents WHERE id = ?", [agent.id]);
  run(
    "INSERT INTO agents (id, name, role, avatar, endpoint, model, auth, system_prompt, capabilities, group_permissions, nickname, added_at, added_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      agent.id,
      agent.name,
      agent.role,
      agent.avatar || '🤖',
      agent.endpoint || null,
      agent.model || null,
      agent.auth || null,
      agent.system_prompt || null,
      JSON.stringify(agent.capabilities || []),
      JSON.stringify(agent.group_permissions || {}),
      agent.nickname || null,
      agent.added_at || new Date().toISOString(),
      agent.added_by || 'user'
    ]
  );
  return getAgentFromDb(agent.id);
}

function getAgentFromDb(id) {
  var agent = queryOne('SELECT * FROM agents WHERE id = ?', [id]);
  if (agent) {
    agent.capabilities = safeParse(agent.capabilities, []);
    agent.group_permissions = safeParse(agent.group_permissions, {});
  }
  return agent;
}

function listAgentsFromDb() {
  return queryAll('SELECT * FROM agents ORDER BY added_at ASC').map(function(a) {
    a.capabilities = safeParse(a.capabilities, []);
    a.group_permissions = safeParse(a.group_permissions, {});
    return a;
  });
}

function deleteAgentFromDb(id) {
  run("DELETE FROM agents WHERE id = ?", [id]);
  run("DELETE FROM room_members WHERE agent_id = ?", [id]);
  return { deleted: true };
}


// === Room Members (per-room nicknames) ===

function getRoomMemberNickname(roomId, agentId) {
  const row = queryOne('SELECT nickname FROM room_members WHERE room_id = ? AND agent_id = ?', [roomId, agentId]);
  return row ? row.nickname : null;
}

function getRoomMemberNicknames(roomId) {
  const rows = queryAll('SELECT agent_id, nickname FROM room_members WHERE room_id = ? AND nickname IS NOT NULL', [roomId]);
  const map = {};
  rows.forEach(function(r) { map[r.agent_id] = r.nickname; });
  return map;
}

function setRoomMemberNickname(roomId, agentId, nickname) {
  run('DELETE FROM room_members WHERE room_id = ? AND agent_id = ?', [roomId, agentId]);
  if (nickname && nickname.trim()) {
    run('INSERT INTO room_members (room_id, agent_id, nickname) VALUES (?, ?, ?)', [roomId, agentId, nickname.trim()]);
  }
  saveDb();
  return { room_id: roomId, agent_id: agentId, nickname: nickname ? nickname.trim() : null };
}

function syncAgentsToDb(agents) {
  // Preserve existing nicknames from DB before clearing
  var existing = queryAll("SELECT id, nickname FROM agents WHERE nickname IS NOT NULL");
  var nicknameMap = {};
  existing.forEach(function(row) { nicknameMap[row.id] = row.nickname; });

  // Clear and re-insert
  db.run("DELETE FROM agents");
  for (const agent of agents) {
    // Restore DB nickname if it existed (survives git checkout of agents.json)
    if (nicknameMap[agent.id]) {
      agent.nickname = nicknameMap[agent.id];
    }
    saveAgentToDb(agent);
  }
  console.log('[DB] Synced ' + agents.length + ' agents to database');
}

// === Utilities ===

function safeParse(str, fallback) {
  try { return str ? JSON.parse(str) : fallback; } catch(e) { return fallback; }
}

// === Settings ===

function getSetting(key, defaultValue) {
  var row = queryOne("SELECT value FROM settings WHERE key = ?", [key]);
  return row ? safeParse(row.value, defaultValue) : defaultValue;
}

function setSetting(key, value) {
  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, JSON.stringify(value)]);
  saveDb();
  return value;
}

module.exports = {
  getSetting,
  setSetting,
  getDb,
  saveDb,
  saveMessage,
  getMessages,
  deleteMessagesByDate,
  createTask,
  getTask,
  listTasks,
  updateTaskStatus,
  updateTaskPlan,
  updateTaskResult,
  updateTaskTitle,
  updateTaskParticipants,
  deleteTask,
  createRoom,
  getRoom,
  listRooms,
  updateRoomMembers,
  updateRoomMode,
  deleteRoom,
  // Agent DB methods
  saveAgentToDb,
  getAgentFromDb,
  listAgentsFromDb,
  deleteAgentFromDb,
  getRoomMemberNickname,
  getRoomMemberNicknames,
  setRoomMemberNickname,
  syncAgentsToDb,
};

