# Changelog

## v2.0 (2026-06-01)

### New Features
- **Dynamic member management**: Add/remove/edit Agents from the UI without restarting the server
- **Group chat permissions**: `group_permissions` controls whether each Agent receives messages
- **Enhanced @mentions**: Supports matching by Agent ID, name, or nickname
- **Agent-to-Agent chat**: Agents can reply to each other with reply context
- **Peer list**: Agents know which peers are in the room
- **Bilingual UI**: Automatic detection of browser language (Chinese/English)
- **Task management**: Create/rename/delete tasks, filter messages by task
- **Date markers**: New task conversations show date markers
- **Pixel-art office**: Agents walk, work, and idle in the office

### Technical Improvements
- Introduced SQLite database `hub.db` for persistent message and config storage
- Frontend modularized into `chat.js`, `pixel-office.js`, `i18n.js`
- Backend modularized into `agents.js`, `db.js`, `routes.js`, `rooms.js`, `tasks.js`
- WebSocket-based Agent-to-Agent forwarding with rate limiting and deduplication
- `@` mention system with support for Agent ID, display name, and nickname

### Bug Fixes
- Fixed various edge cases in Agent message routing
- Fixed HTML encoding issues in message display
- Fixed task switching causing incorrect message loading

---

## v1.0 (2026-05-20)

### Initial Release
- Basic group chat functionality
- Agent management via `agents.json`
- REST API for Agent and message management
- Socket.IO real-time communication
- Multi-room support
