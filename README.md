# KIOSK-MONITOR Signaling Server

A production-aligned Node.js backend that provides WebRTC signaling and crew event broadcasting for KIOSK and MONITOR clients.

## 🏗️ Architecture

**VIEW-ONLY ARCHITECTURE**: This backend does **NOT** process video streams. It only handles:
- WebRTC signaling message forwarding (offer, answer, ice-candidate)
- Crew event broadcasting (sign-on/sign-off)
- Client authentication and authorization

All video data flows directly between clients via WebRTC peer-to-peer connections. This server never touches video streams.

## 📁 Project Structure

```
backend/
 ├─ src/
 │  ├─ server.js              # Express server with Socket.IO setup
 │  ├─ socket/
 │  │   └─ index.js           # Socket.IO event handlers
 │  ├─ auth/
 │  │   └─ auth.middleware.js # JWT authentication middleware
 │  └─ events/
 │      └─ crew.events.js     # Crew event broadcasting logic
 ├─ package.json
 └─ README.md
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ (ES modules support)

### Installation

```bash
cd backend
npm install
```

### Running the Server

```bash
# Production mode
npm start

# Development mode (with auto-reload)
npm run dev
```

The server will start on `http://localhost:3000` by default.

### Environment Variables

Create a `.env` file (optional):

```env
PORT=3000
JWT_SECRET=your-secret-key-change-in-production
CORS_ORIGIN=http://localhost:3000
```

### Performance / Load Test (Optional)

Run a simple Socket.IO load test to estimate connection and session latency. This creates unique KIOSK and MONITOR users, registers them, and optionally starts monitoring sessions.

```bash
npm install
node scripts/load-test.js --url https://webrtc-test.divyavyoma.cloud --kiosks 5 --monitors 5 --duration 30
```

Output includes average and p95 latencies for connect/register/start-monitoring steps and error counts.

## 🔐 Authentication

All Socket.IO connections require a valid JWT token. The token must include:
- `clientId`: Unique client identifier
- `role`: Either `KIOSK` or `MONITOR`

### Generating Test Tokens

Use the helper script to generate test tokens:

```bash
node scripts/generate-token.js KIOSK_01 KIOSK
node scripts/generate-token.js MONITOR_01 MONITOR
```

Or use the auth middleware directly:

```javascript
import { generateToken } from './src/auth/auth.middleware.js';

const kioskToken = generateToken('KIOSK_01', 'KIOSK');
const monitorToken = generateToken('MONITOR_01', 'MONITOR');
```

### Connecting with Authentication

```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:3000', {
  auth: {
    token: 'your-jwt-token-here'
  }
});
```

## 🔌 Socket.IO Events

### Client Registration

#### `register-kiosk`
Emitted by KIOSK clients to register themselves.

**Emit:**
```javascript
socket.emit('register-kiosk');
```

**Response:**
```javascript
socket.on('kiosk-registered', (data) => {
  console.log(data);
  // { kioskId: 'KIOSK_01', timestamp: '2024-01-01T00:00:00.000Z' }
});
```

**Broadcast to MONITORs:**
```javascript
socket.on('kiosk-online', (data) => {
  // { kioskId: 'KIOSK_01', timestamp: '2024-01-01T00:00:00.000Z' }
});
```

#### `register-monitor`
Emitted by MONITOR clients to register themselves.

**Emit:**
```javascript
socket.emit('register-monitor');
```

**Response:**
```javascript
socket.on('monitor-registered', (data) => {
  console.log(data);
  // {
  //   monitorId: 'MONITOR_01',
  //   onlineKiosks: [{ kioskId: 'KIOSK_01', connectedAt: '...' }],
  //   timestamp: '2024-01-01T00:00:00.000Z'
  // }
});
```

### WebRTC Signaling

#### `offer`
Forward WebRTC offer to target client.

**Emit:**
```javascript
socket.emit('offer', {
  targetId: 'KIOSK_01',
  offer: offerObject
});
```

**Receive:**
```javascript
socket.on('offer', (data) => {
  // { fromId: 'KIOSK_01', offer: offerObject }
});
```

#### `answer`
Forward WebRTC answer to target client.

**Emit:**
```javascript
socket.emit('answer', {
  targetId: 'MONITOR_01',
  answer: answerObject
});
```

**Receive:**
```javascript
socket.on('answer', (data) => {
  // { fromId: 'MONITOR_01', answer: answerObject }
});
```

#### `ice-candidate`
Forward ICE candidate to target client.

**Emit:**
```javascript
socket.emit('ice-candidate', {
  targetId: 'KIOSK_01',
  candidate: candidateObject
});
```

**Receive:**
```javascript
socket.on('ice-candidate', (data) => {
  // { fromId: 'KIOSK_01', candidate: candidateObject }
});
```

### Crew Events

#### `crew-sign-on`
Emitted by KIOSK clients when a crew member signs on.

**Emit:**
```javascript
socket.emit('crew-sign-on', {
  employeeId: 'EMP001',
  name: 'Demo User',
  timestamp: new Date().toISOString(),
  kioskId: 'KIOSK_01' // Will be overridden by server for security
});
```

**Acknowledgment:**
```javascript
socket.on('crew-sign-on-ack', (data) => {
  // { employeeId: 'EMP001', timestamp: '2024-01-01T00:00:00.000Z' }
});
```

**Broadcast to MONITORs:**
```javascript
socket.on('crew-sign-on', (data) => {
  // {
  //   employeeId: 'EMP001',
  //   name: 'Demo User',
  //   timestamp: '2024-01-01T00:00:00.000Z',
  //   kioskId: 'KIOSK_01',
  //   eventType: 'crew-sign-on'
  // }
});
```

#### `crew-sign-off`
Emitted by KIOSK clients when a crew member signs off.

**Emit:**
```javascript
socket.emit('crew-sign-off', {
  employeeId: 'EMP001',
  name: 'Demo User',
  timestamp: new Date().toISOString(),
  kioskId: 'KIOSK_01' // Will be overridden by server for security
});
```

**Acknowledgment:**
```javascript
socket.on('crew-sign-off-ack', (data) => {
  // { employeeId: 'EMP001', timestamp: '2024-01-01T00:00:00.000Z' }
});
```

**Broadcast to MONITORs:**
```javascript
socket.on('crew-sign-off', (data) => {
  // {
  //   employeeId: 'EMP001',
  //   name: 'Demo User',
  //   timestamp: '2024-01-01T00:00:00.000Z',
  //   kioskId: 'KIOSK_01',
  //   eventType: 'crew-sign-off'
  // }
});
```

### Status Events

#### `kiosk-online`
Broadcast to MONITOR clients when a kiosk comes online.

```javascript
socket.on('kiosk-online', (data) => {
  // { kioskId: 'KIOSK_01', timestamp: '2024-01-01T00:00:00.000Z' }
});
```

#### `kiosk-offline`
Broadcast to MONITOR clients when a kiosk goes offline.

```javascript
socket.on('kiosk-offline', (data) => {
  // { kioskId: 'KIOSK_01', timestamp: '2024-01-01T00:00:00.000Z' }
});
```

### Error Handling

```javascript
socket.on('error', (error) => {
  console.error('Socket error:', error.message);
});
```

## 🛡️ Security Features

1. **JWT Authentication**: All connections require valid JWT tokens
2. **Role-Based Authorization**: Events are restricted by role (KIOSK vs MONITOR)
3. **Client ID Validation**: Server validates and overrides client-provided IDs
4. **Input Validation**: All crew events are validated before broadcasting

## 📊 API Endpoints

### `GET /health`
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "service": "kiosk-monitor-signaling-server"
}
```

## 🏭 Production Considerations

1. **JWT Secret**: Use a strong, environment-specific secret key
2. **CORS**: Configure CORS origins appropriately
3. **Rate Limiting**: Add rate limiting for production
4. **Logging**: Implement structured logging (e.g., Winston, Pino)
5. **Monitoring**: Add health checks and metrics
6. **Database**: Replace in-memory storage with persistent storage if needed
7. **Scaling**: Consider Redis adapter for Socket.IO clustering
8. **SSL/TLS**: Use HTTPS/WSS in production

## 🧪 Testing

Example client connection:

```javascript
import io from 'socket.io-client';
import { generateToken } from './src/auth/auth.middleware.js';

const token = generateToken('KIOSK_01', 'KIOSK');

const socket = io('http://localhost:3000', {
  auth: { token }
});

socket.on('connect', () => {
  console.log('Connected!');
  socket.emit('register-kiosk');
});

socket.on('kiosk-registered', (data) => {
  console.log('Registered:', data);
  
  // Emit crew sign-on
  socket.emit('crew-sign-on', {
    employeeId: 'EMP001',
    name: 'Demo User',
    timestamp: new Date().toISOString()
  });
});
```

## 📝 Notes

- This is a **signaling server only** - it does not handle video streams
- Video data flows directly between clients via WebRTC peer connections
- All crew events are broadcast to MONITOR clients only
- WebRTC signaling messages are forwarded between clients without modification
# railway-monitoring
