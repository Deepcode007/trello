# ⚡ Collaborative WebSocket Engine (`apps/websockets`)

High-performance real-time collaboration engine built on native [Bun WebSockets](https://bun.com/docs/api/websockets) providing board-scoped pub/sub rooms, handshake authentication, authorization guards, and presence tracking for the Kanban platform.

---

## 🚀 Features

- **Multi-Strategy Handshake Authentication**: Validates JWTs through `Authorization: Bearer <token>`, Cookies (`token`, `auth_token`), URL query parameters (`?token=`, `?access_token=`, `?jwt=`), or WebSocket Subprotocols (`Sec-WebSocket-Protocol: bearer, <token>`).
- **Board Membership Authorization**: Enforces organization-level access control before subscribing sockets to board rooms (`board_<boardId>`).
- **Real-Time Presence Tracking**: Automatically broadcasts `user:joined` and `user:left` events upon room entry, room exit, and connection termination.
- **Inter-Process HTTP Bridge**: Secure `/internal/broadcast` endpoint authenticated via `x-internal-secret` allowing backend API processes to publish real-time events to active board rooms.
- **Independent Service**: Runs as a separate process from the Express API and accepts authenticated internal broadcast requests from the backend.

---

## 🛠️ Environment Configuration

Configure `apps/websockets/.env`:

```env
ws_port="3001"
jwt_key="your-super-secret-jwt-key"
INTERNAL_BROADCAST_SECRET="your-internal-service-secret"
WS_IDLE_TIMEOUT="60"
WS_HEARTBEAT_INTERVAL="30000"
```

| Variable | Default | Description |
| :--- | :--- | :--- |
| `ws_port` / `WS_PORT` | `3001` | Port on which the WebSocket server listens |
| `jwt_key` / `JWT_SECRET` | Shared secret key for JWT verification and IPC broadcast authentication |
| `INTERNAL_BROADCAST_SECRET` | Shared backend-to-WebSocket secret; defaults to the JWT secret when omitted |

> [!IMPORTANT]
> `jwt_key` must match between the apps for token validation. `INTERNAL_BROADCAST_SECRET` should also match; if omitted, both services use the JWT secret for internal requests.

---

## 📡 Protocol Reference

### Connecting to WebSockets

Connect to `ws://localhost:3001` with any supported authentication mechanism:

```javascript
// 1. Via URL query parameter
const ws = new WebSocket("ws://localhost:3001?token=" + jwtToken);

// 2. Via WebSocket Subprotocol
const ws = new WebSocket("ws://localhost:3001", ["bearer", jwtToken]);
```

### Client Actions (Send JSON Frames)

#### 1. Join / Subscribe to Board Room
```jsonc
{
  "action": "join", // or "subscribe"
  "boardId": "3fa85f64-5717-4562-b3fc-2c963f66afa6"
}
```
*Note: The server verifies that the authenticated user is an accepted member of the board's organization. Unauthorized requests receive an error message and are not subscribed.*

#### 2. Leave / Unsubscribe from Board Room
```jsonc
{
  "action": "leave", // or "unsubscribe"
  "boardId": "3fa85f64-5717-4562-b3fc-2c963f66afa6"
}
```

#### 3. Heartbeat Ping
```jsonc
{
  "action": "ping"
}
```
*Response: `{"type": "pong"}`*

---

## 📢 Server Broadcast Events

Events published to board subscribers (`board_<boardId>`):

| Event Type | Payload | Description |
| :--- | :--- | :--- |
| `user:joined` | `{ userId, name, email, boardId }` | Collaborator entered the board |
| `user:left` | `{ userId, name, email, boardId }` | Collaborator left or disconnected |
| `card:created` | `{ cardData: Issue }` | New issue card added to column |
| `card:updated` | `{ cardId, updates: { title?, gh_url? } }` | Card title or metadata changed |
| `card:moved` | `{ cardId, sourceList, destList, position }` | Card moved across columns or reordered |
| `card:deleted` | `{ cardId }` | Card removed from board |
| `list:created` | `{ listData: Section }` | New column created |
| `list:updated` | `{ listId, title }` | Column renamed |
| `list:reordered` | `{ listId, newPosition }` | Column position reordered |
| `list:deleted` | `{ listId }` | Column removed from board |

---

## 🔌 HTTP Endpoints

- `GET /health` or `GET /api/health`: Health status and port inspection.
- `POST /internal/broadcast`: Inter-process event dispatch used by the Express backend to broadcast events to board subscribers.
  - Header: `x-internal-secret: <INTERNAL_BROADCAST_SECRET>` (falls back to `jwt_key`)
  - Body: `{ "boardId": "<board_uuid>", "event": { "type": "card:created", ... } }`
- `POST /internal/evict-user`: Inter-process user socket eviction upon member removal or privilege revocation.
  - Header: `x-internal-secret: <INTERNAL_BROADCAST_SECRET>` (falls back to `jwt_key`)
  - Body: `{ "userId": "<user_uuid>", "orgId": "<org_uuid>", "boardIds": ["<board_uuid>"] }`

---

## 🧪 Testing & Development

```bash
# Run server with live reloading
bun run dev

# Run WebSocket test suite (103 tests)
bun test
```
