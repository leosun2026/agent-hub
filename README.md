# Agent Hub v2.0

> Multi-Agent collaboration hub with dynamic member management, Feishu-style group chat, and task orchestration.
> 多 Agent 协作中控台，支持动态成员管理、飞书式群聊和任务流程。

---

## Quick Start / 快速启动

```cmd
cd /d D:\Admin\Cedex工作区域\agent-hub
node server.js
```

Or double-click `start-hub.cmd`

访问: **http://127.0.0.1:3457**

---

## What's New in v2.0 / v2.0 新特性

### Dynamic Member Management / 动态成员管理
- **Add members from UI**: Click "Add Member" → Copy invitation → Send to Agent → Paste JSON → Done
- **从 UI 添加成员**: 点击"添加成员"→ 复制邀请 → 发给 Agent → 粘贴 JSON → 完成
- **Remove/Edit members**: Built-in manage panel for member lifecycle
- **No restart needed**: Agents are loaded dynamically from `agents.json`

### Enhanced Group Chat / 增强群聊
- **Permission filtering**: `group_permissions` controls which agents receive messages
- **@mention enhancement**: Match by agent ID, name, or nickname
- **Agent-to-agent chat**: Agents can reply to each other with reply-to context
- **Companion list**: Agents know who else is in the room via system prompt

### Bilingual UI / 中英文双语
- Auto-detects browser language (`navigator.language`)
- Chinese (zh-CN) default, English fallback

---

## Architecture / 架构

```
┌─────────────────────────────────────────────┐
│                 Agent Hub                    │
│           http://127.0.0.1:3457              │
├──────────┬──────────┬──────────┬────────────┤
│  Chat    │  Tasks   │  Office  │  REST API   │
│ (Socket) │ (Kanban) │ (Pixel)  │  /api/*     │
├──────────┴──────────┴──────────┴────────────┤
│           Node.js + Express 5                │
│         Socket.IO 4 + sql.js                 │
├──────────────────────────────────────────────┤
│          SQLite (./data/hub.db)              │
└──────────────────────────────────────────────┘
```

---

## Agents / Agent 配置

All agents are defined in `agents.json` with the following structure:

```json
{
  "id": "hermes-main",
  "name": "Hermes Main",
  "role": "executor",
  "avatar": "🦞",
  "endpoint": "http://127.0.0.1:8642/v1/chat/completions",
  "model": "deepseek-v4-flash",
  "auth": null,
  "system_prompt": "You are a helpful assistant.",
  "capabilities": ["chat", "general-knowledge"],
  "group_permissions": {
    "receive_all": true,
    "receive_at_only": false,
    "can_send_active": true,
    "can_see_history": true
  },
  "nickname": null,
  "added_at": "2026-05-30T00:00:00Z",
  "added_by": "system"
}
```

### Roles / 角色

| Role | Description |
|------|-------------|
| `orchestrator` | Coordinates other agents, no endpoint required |
| `executor` | General execution agent |
| `specialist` | Domain-specific agent (writing, support, ops) |

### Group Permissions / 群聊权限

| Permission | Description |
|------------|-------------|
| `receive_all` | Receive all messages in broadcast mode |
| `receive_at_only` | Only receive @mentioned messages |
| `can_send_active` | Can POST to `/api/messages` to speak proactively |
| `can_see_history` | Can see message history when joining |

---

## Chat Modes / 聊天模式

| Mode | Icon | Behavior |
|------|------|----------|
| **Broadcast** | ● | All agents receive messages, smart reply |
| **@Mention** | ○ | Only @mentioned agents receive messages |

---

## Add Member Flow / 添加成员流程

1. Click **"Add Member"** in chat toolbar
2. **Step 1**: Copy the invitation message
3. Send it to the target Agent (via Feishu, WebUI, or any other channel)
4. Agent replies with a JSON configuration
5. **Step 2**: Paste the JSON → Preview → Confirm
6. Agent is added instantly, no restart needed

---

## API Reference / API 参考

### Agents / Members

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agents` | List all agents with full structure |
| GET | `/api/agents/status` | Check agent connectivity |
| POST | `/api/members` | Add new agent |
| DELETE | `/api/members/:id` | Remove agent |
| PATCH | `/api/members/:id` | Update agent config |
| POST | `/api/agents/:id/call` | Call a specific agent |

### Rooms / 房间

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/rooms` | List all rooms |
| POST | `/api/rooms` | Create room |
| GET | `/api/rooms/:id` | Get room details |
| PUT | `/api/rooms/:id/members` | Update room members |
| PUT | `/api/rooms/:id/mode` | Update room mode |
| DELETE | `/api/rooms/:id` | Delete room |

### Messages / 消息

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/messages` | Get messages (query: room_id, task_id, since, limit) |
| POST | `/api/messages` | Post message (agents need `can_send_active`) |

### Tasks / 任务

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tasks` | List tasks |
| POST | `/api/tasks` | Create task |
| GET | `/api/tasks/:id` | Get task details |
| PATCH | `/api/tasks/:id/status` | Update task status |

---

## Socket.IO Events / WebSocket 事件

| Event | Direction | Description |
|-------|-----------|-------------|
| `chat:send` | Client → Server | Send message |
| `chat:message` | Server → Client | New message |
| `chat:history` | Client → Server | Get history |
| `chat:mode:set` | Client → Server | Set room mode |
| `chat:mode` | Server → Client | Mode changed |
| `room:join` | Client → Server | Join room |
| `room:joined` | Server → Client | Joined room |
| `room:update` | Server → Client | Room config updated |
| `agent:state` | Server → Client | Agent state (thinking/idle) |
| `member:added` | Server → Client | New member added |
| `member:removed` | Server → Client | Member removed |
| `member:updated` | Server → Client | Member updated |

---

## Database / 数据库

Path: `./data/hub.db` (SQLite via sql.js)

**Tables**: `messages`, `tasks`, `rooms`, `agents`

---

## File Structure / 文件结构

```
agent-hub/
├── server.js              # Main server + Socket.IO
├── package.json           # Dependencies
├── agents.json            # Agent definitions (authoritative source)
├── start-hub.cmd          # Windows startup script
├── .gitignore
├── LICENSE (MIT)
├── README.md
├── src/
│   ├── agents.js          # Agent management (dynamic loading)
│   ├── db.js              # SQLite wrapper + all tables
│   ├── routes.js          # REST API routes
│   ├── rooms.js           # Room management + message building
│   └── tasks.js           # Task state machine
├── public/
│   ├── index.html         # Main SPA (3 tabs + modals)
│   ├── js/
│   │   ├── i18n.js        # Internationalization (zh-CN / en)
│   │   ├── chat.js        # Chat + member management logic
│   │   ├── tasks.js       # Tasks kanban logic
│   │   └── pixel-office.js # Pixel office animation
│   └── office-assets/     # Pixel art sprites
└── data/
    └── hub.db             # SQLite database (auto-created)
```

---

## Version History / 版本历史

| Version | Date | Changes |
|---------|------|---------|
| v2.0 | 2026-06-01 | Dynamic member management, add/remove/edit agents, group_permissions, enhanced @mention, agent inter-chat, companion list, i18n bilingual |
| v0.1.1 | 2026-05-31 | Pixel office, broadcast/@mention modes, chat history by day, white theme |
| v0.1.0 | 2026-05-30 | Initial: Chat/Tasks/Office, SVG office, 5 agents |
