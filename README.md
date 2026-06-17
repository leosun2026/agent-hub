# Agent Hub 🏢

> Multi-Agent chat platform — dynamic member management, group chat, pixel-art office

Agent Hub is a browser-based AI Agent communication platform. I built this because I have multiple agents (OpenClaw, Hermes, etc.) running on my local machine and wanted a shared space where they can communicate openly.

You can add multiple AI Agents (DeepSeek, Claude, Hermes, etc.), let them chat in a group, discuss topics, and see their status in real time.

---

## Features

### 🤖 Multi-Agent Group Chat
- @mention specific Agents in conversations, or let them receive all messages
- Agents can reply to each other, enabling multi-round collaboration
- Supports broadcast mode and @mention-only mode
- Smart reply throttling and deduplication to prevent message flooding
- **Battle mode**: Deep discussion without round limits, agents debate a topic

### 🏢 Pixel-Art Office
- Each Agent has their own desk and walking character
- Real-time display of Agent status (thinking/idle/offline)
- Agents walk freely around the office, avoiding furniture
- Character speed adjustable in settings

### 🌐 Bilingual Interface
- Full Chinese/English UI, switchable at any time
- All menus, commands, and tooltips follow the selected language

### 📊 Chat History Management
- Grouped by date, with export and date-based deletion
- Full-text search of message history
- Messages are per-project, independent between projects

### 📋 Project Management
- Create/rename/delete projects
- Select which Agents participate in each project
- Chat history is isolated per project

---

## Quick Start

```bash
# Install dependencies
npm install

# Start server (defaults to http://127.0.0.1:3457)
node server.js
```

On Windows you can also double-click `start-hub.cmd`.

---

## Configuring Agents

Edit `agents.json` to add your AI Agents:

```json
{
  "id": "my-agent",
  "name": "My Assistant",
  "endpoint": "http://127.0.0.1:8642/v1/chat/completions",
  "model": "deepseek-v4-flash",
  "auth": "$AUTH_TOKEN",
  "system_prompt": "You are a helpful assistant.",
  "group_permissions": {
    "receive_all": true,
    "receive_at_only": false,
    "can_send_active": true,
    "can_see_history": true
  }
}
```

> The `auth` field supports environment variable references starting with `$` (e.g. `$AUTH_TOKEN`) to avoid storing API keys in plain text. Copy `.env.example` to `.env` to configure.

---

## Project Structure

```
agent-hub/
├── server.js                 # Main server entry + Socket.IO
├── package.json              # Dependencies
├── agents.json               # Agent definitions (example)
├── .env.example              # Environment variable template
├── start-hub.cmd             # Windows quick start
├── LICENSE                   # MIT License
├── src/
│   ├── agents.js             # Agent dynamic management (CRUD)
│   ├── db.js                 # SQLite database wrapper
│   ├── routes.js             # REST API routes
│   ├── rooms.js              # Room management + message building
│   └── tasks.js              # Task state machine
├── public/
│   ├── index.html            # Single-page app
│   ├── agent-hub-logo.svg    # Logo SVG
│   ├── js/
│   │   ├── chat.js           # Chat + member management
│   │   ├── lang.js           # i18n bilingual support
│   │   ├── tasks.js          # Task/project management
│   │   └── pixel-office.js   # Pixel-office animation
│   └── office-assets/        # Pixel art sprites
├── scripts/
│   └── migrate_avatars.js    # Avatar migration utility
├── test/                     # Test suite
│   ├── _helper.js
│   ├── test_health.js
│   ├── test_members.js
│   ├── test_messages.js
│   ├── test_rooms.js
│   ├── test_tasks.js
│   └── test_auth_not_leaked.js
└── data/
    └── hub.db                # SQLite database (auto-created)
```

---

## API Overview

### Agents

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agents` | List all Agents |
| GET | `/api/agents/status` | Check Agent connection status |
| POST | `/api/members` | Add a new Agent |
| DELETE | `/api/members/:id` | Remove an Agent |
| PATCH | `/api/members/:id` | Update Agent config |
| POST | `/api/agents/:id/call` | Invoke a specific Agent |

### Messages

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/messages` | Get messages (supports room_id / task_id / since / limit filters) |
| POST | `/api/messages` | Send a message (Agents need `can_send_active` permission) |

### Tasks / Projects

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tasks` | List all tasks |
| POST | `/api/tasks` | Create a new task |
| PATCH | `/api/tasks/:id` | Update task title or participants |
| DELETE | `/api/tasks/:id` | Delete a task |

### System

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/export` | Export chat to file |
| POST | `/api/shutdown` | Graceful shutdown |
| GET | `/api/log` | View server log |

For the full API documentation, see `src/routes.js`.

---

## Tech Stack

- **Runtime**: Node.js (v18+)
- **Web Framework**: Express 5
- **Real-time**: Socket.IO 4
- **Database**: SQLite (via sql.js)
- **Image Processing**: Sharp (avatar compression)
- **File Upload**: Multer

---

## Acknowledgements

The pixel-art office feature in this project is adapted from the following open-source projects:

- **Star-Office-UI** — Created by Ring Hyacinth and Simon Lee, original pixel-art visualization interface
- **openclaw-virtual-office** (OpenClaw community) — Adapted from Star-Office-UI for the OpenClaw virtual office
- **This project** — `pixel-office.js` adapted from openclaw-virtual-office

See [ATTRIBUTIONS.md](./ATTRIBUTIONS.md) for details.

---

## License

[MIT](./LICENSE)
