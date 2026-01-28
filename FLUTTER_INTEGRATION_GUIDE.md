# Flutter Integration Guide
## KIOSK-MONITOR Backend Integration

This guide explains how to integrate the hardened backend with your Flutter applications.

---

## 📱 Application Overview

You have **two Flutter applications**:

1. **KIOSK App** - The screen/device being monitored
   - Displays content/video feed
   - Sends video stream to monitor
   - Emits crew sign-on/sign-off events
   - Sends heartbeat pings

2. **MONITOR App** - The monitoring dashboard
   - Receives video streams from kiosks
   - Displays multiple kiosk feeds
   - Receives crew event notifications
   - Manages monitoring sessions

---

## 🏗️ Architecture Flow

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│  KIOSK App  │◄───────►│   Backend    │◄───────►│ MONITOR App │
│  (Flutter)  │         │  (Node.js)   │         │  (Flutter)  │
└─────────────┘         └──────────────┘         └─────────────┘
      │                        │                        │
      │                        │                        │
      └────────────────────────┴────────────────────────┘
                    WebRTC Peer Connection
              (Direct video stream, no backend)
```

**Key Point**: The backend **NEVER touches video streams**. It only:
- Handles WebRTC signaling (offer, answer, ICE candidates)
- Manages sessions and authentication
- Broadcasts crew events
- Tracks online/offline status

---

## 🔐 Step 1: Authentication Flow

### Why Authentication is Required
- **Security**: Prevents unauthorized access
- **Role Enforcement**: Ensures KIOSK and MONITOR apps can only do their specific actions
- **Session Tracking**: Backend needs to know which client is which

### How It Works

#### 1.1 Generate JWT Token (Before App Launch)
- Use the backend's token generation script or API
- Tokens contain: `clientId`, `role` (KIOSK or MONITOR), expiration time
- **KIOSK App**: Needs token with role `KIOSK` and unique `clientId` (e.g., "KIOSK_01")
- **MONITOR App**: Needs token with role `MONITOR` and unique `clientId` (e.g., "MONITOR_01")

#### 1.2 Store Token Securely
- **KIOSK App**: Store token in secure storage (flutter_secure_storage)
- **MONITOR App**: Store token in secure storage
- Tokens should be long-lived (24 hours default) or refreshed periodically

#### 1.3 Connect with Authentication
- Both apps connect to Socket.IO server with token in `auth.token`
- Backend validates token on connection
- If invalid → Connection rejected
- If valid → Connection established with role and clientId attached

### Flow Diagram
```
App Start
   │
   ├─► Load Token from Secure Storage
   │
   ├─► Connect to Socket.IO Server
   │   └─► auth: { token: "jwt-token-here" }
   │
   ├─► Backend Validates Token
   │   ├─► Valid? → Connection Accepted
   │   └─► Invalid? → Connection Rejected (handle error)
   │
   └─► Ready for Registration
```

---

## 📺 Step 2: KIOSK App Flow

### 2.1 Initial Connection & Registration

**Purpose**: Announce to backend that this kiosk is online and available for monitoring.

**Flow**:
1. **Connect** to Socket.IO server with JWT token
2. **Wait for connection** event confirmation
3. **Emit `register-kiosk`** event
4. **Listen for `kiosk-registered`** acknowledgment
5. **Listen for `kiosk-online`** broadcast (confirms monitors were notified)

**Why This Matters**:
- Backend tracks which kiosks are online
- Monitors receive `kiosk-online` event to know this kiosk is available
- Enables session management

**What Happens**:
- Kiosk is added to backend's kiosk registry
- All monitors receive `kiosk-online` event
- Kiosk receives confirmation it's registered

### 2.2 Heartbeat Mechanism

**Purpose**: Keep backend informed that kiosk is still alive and prevent false offline detection.

**Flow**:
1. **Every 30 seconds**, emit `heartbeat-ping` event
2. **Listen for `heartbeat-pong`** response
3. **If no pong received** → Connection might be lost (handle reconnection)

**Why This Matters**:
- Backend marks kiosk offline if no heartbeat for 90 seconds
- Prevents stale sessions
- Ensures monitors see accurate online/offline status

**What Happens**:
- Backend updates kiosk's `lastSeenAt` timestamp
- If heartbeat stops → Backend marks kiosk offline after 90s
- Active sessions are terminated if kiosk goes offline

### 2.3 WebRTC Video Stream Setup

**Purpose**: Establish peer-to-peer video connection with monitor.

**Flow**:
1. **Wait for `start-monitoring`** event from monitor (or monitor initiates)
2. **Monitor sends WebRTC offer** → Kiosk receives `offer` event
3. **Kiosk creates answer** → Emit `answer` event with `targetId: monitorId`
4. **Exchange ICE candidates** → Emit `ice-candidate` events
5. **WebRTC connection established** → Video stream flows directly to monitor

**Why This Matters**:
- Backend validates session exists before forwarding signaling
- Ensures only authorized monitor can receive video
- Video stream bypasses backend (peer-to-peer)

**What Happens**:
- Backend validates session ownership
- Backend forwards signaling messages between kiosk and monitor
- Video stream flows directly (backend never sees video data)

### 2.4 Crew Event Broadcasting

**Purpose**: Notify monitors when crew members sign on or off.

**Flow**:
1. **Crew member signs on** → Emit `crew-sign-on` event with payload:
   ```json
   {
     "employeeId": "EMP001",
     "name": "John Doe",
     "timestamp": "2024-01-01T12:00:00Z"
   }
   ```
2. **Listen for `crew-sign-on-ack`** acknowledgment
3. **Backend broadcasts** to all monitors
4. **Repeat for `crew-sign-off`** when crew member signs off

**Why This Matters**:
- Monitors need real-time crew activity updates
- Backend validates payload and applies rate limiting
- Ensures kioskId matches authenticated client (security)

**What Happens**:
- Backend validates payload structure
- Backend checks rate limits (10 per minute)
- Backend broadcasts to all monitors
- Kiosk receives acknowledgment

### 2.5 Disconnect Handling

**Purpose**: Clean shutdown and notify monitors.

**Flow**:
1. **App closing** → Emit disconnect or let Socket.IO handle it
2. **Backend automatically**:
   - Marks kiosk offline
   - Ends active sessions
   - Notifies monitors via `kiosk-offline` and `session-ended` events
   - Cleans up state

**Why This Matters**:
- Prevents orphaned sessions
- Monitors see accurate status
- Backend stays clean

---

## 🖥️ Step 3: MONITOR App Flow

### 3.1 Initial Connection & Registration

**Purpose**: Connect to backend and receive list of available kiosks.

**Flow**:
1. **Connect** to Socket.IO server with JWT token
2. **Wait for connection** event confirmation
3. **Emit `register-monitor`** event
4. **Listen for `monitor-registered`** with `onlineKiosks` array
5. **Display available kiosks** in UI

**Why This Matters**:
- Monitor needs to know which kiosks are online
- Backend provides current state on registration
- Enables monitor to select which kiosk to monitor

**What Happens**:
- Monitor is added to backend's monitor registry
- Monitor receives list of all online kiosks
- Monitor can now start monitoring sessions

### 3.2 Starting a Monitoring Session

**Purpose**: Establish authorized monitoring relationship with a kiosk.

**Flow**:
1. **User selects kiosk** from available list
2. **Emit `start-monitoring`** event with `kioskId`
3. **Listen for `monitoring-started`** confirmation
4. **If error** → Handle `SESSION_ALREADY_EXISTS` (another monitor is watching)
5. **Session established** → Can now exchange WebRTC signaling

**Why This Matters**:
- Backend enforces one monitor per kiosk
- Backend validates kiosk is online
- Creates session record for WebRTC validation

**What Happens**:
- Backend creates session record
- Backend validates kiosk is online
- Backend rejects if session already exists
- Monitor receives confirmation

### 3.3 WebRTC Video Stream Setup

**Purpose**: Receive video stream from kiosk.

**Flow**:
1. **After session started** → Monitor initiates WebRTC offer
2. **Emit `offer`** event with `targetId: kioskId` and WebRTC offer
3. **Listen for `answer`** event from kiosk
4. **Exchange ICE candidates** → Emit and listen for `ice-candidate` events
5. **WebRTC connection established** → Display video stream in UI

**Why This Matters**:
- Backend validates session before forwarding signaling
- Ensures only authorized monitor receives video
- Video stream flows directly (peer-to-peer)

**What Happens**:
- Backend validates session ownership
- Backend forwards signaling messages
- Video stream flows directly to monitor
- Monitor displays video in UI

### 3.4 Receiving Crew Events

**Purpose**: Display real-time crew activity notifications.

**Flow**:
1. **Listen for `crew-sign-on`** event
2. **Display notification** in UI (e.g., toast, banner)
3. **Update crew list** if maintaining a list
4. **Repeat for `crew-sign-off`** events

**Why This Matters**:
- Monitors need to know crew activity in real-time
- Events are broadcast to all monitors
- Events include employee info and timestamp

**What Happens**:
- Backend broadcasts crew events to all monitors
- Monitor receives event with employee details
- Monitor updates UI accordingly

### 3.5 Kiosk Status Updates

**Purpose**: Track which kiosks are online/offline.

**Flow**:
1. **Listen for `kiosk-online`** event → Add to available kiosks list
2. **Listen for `kiosk-offline`** event → Remove from list or mark offline
3. **Update UI** to reflect current status

**Why This Matters**:
- Monitor needs accurate kiosk availability
- Prevents trying to monitor offline kiosks
- Enables dynamic UI updates

**What Happens**:
- Backend broadcasts status changes
- Monitor receives events
- Monitor updates UI

### 3.6 Session Management

**Purpose**: Handle session lifecycle and errors.

**Flow**:
1. **Listen for `session-ended`** event → Handle session termination
2. **Listen for `session-timeout`** event → Handle timeout
3. **Emit `stop-monitoring`** when user stops monitoring
4. **Listen for `monitoring-stopped`** confirmation

**Why This Matters**:
- Sessions can end due to various reasons (timeout, disconnect, etc.)
- Monitor needs to handle these gracefully
- Clean session termination prevents errors

**What Happens**:
- Backend ends session and notifies monitor
- Monitor receives event with reason
- Monitor cleans up WebRTC connection
- Monitor updates UI

---

## 🔄 Step 4: Complete Integration Flow

### 4.1 Initial Setup (Both Apps)

```
App Launch
   │
   ├─► Load JWT Token (from secure storage or generate)
   │
   ├─► Initialize Socket.IO Client
   │   └─► Configure with token in auth
   │
   ├─► Connect to Backend
   │   └─► Wait for 'connect' event
   │
   └─► Register Based on Role
       ├─► KIOSK → emit 'register-kiosk'
       └─► MONITOR → emit 'register-monitor'
```

### 4.2 KIOSK App Complete Flow

```
KIOSK App Lifecycle
   │
   ├─► 1. Connect & Register
   │   └─► Backend confirms → Ready
   │
   ├─► 2. Start Heartbeat Loop (every 30s)
   │   └─► Prevents offline detection
   │
   ├─► 3. Wait for Monitor Connection
   │   └─► Listen for 'offer' event
   │
   ├─► 4. Establish WebRTC Connection
   │   ├─► Receive offer → Create answer → Send answer
   │   ├─► Exchange ICE candidates
   │   └─► Video stream flows to monitor
   │
   ├─► 5. Handle Crew Events
   │   ├─► User signs on → emit 'crew-sign-on'
   │   └─► User signs off → emit 'crew-sign-off'
   │
   └─► 6. Handle Disconnect
       └─► Backend cleans up automatically
```

### 4.3 MONITOR App Complete Flow

```
MONITOR App Lifecycle
   │
   ├─► 1. Connect & Register
   │   └─► Receive list of online kiosks
   │
   ├─► 2. Display Available Kiosks
   │   └─► User selects kiosk to monitor
   │
   ├─► 3. Start Monitoring Session
   │   ├─► emit 'start-monitoring' with kioskId
   │   └─► Wait for 'monitoring-started' confirmation
   │
   ├─► 4. Establish WebRTC Connection
   │   ├─► Create offer → emit 'offer'
   │   ├─► Receive answer → Process answer
   │   ├─► Exchange ICE candidates
   │   └─► Display video stream
   │
   ├─► 5. Receive Crew Events
   │   ├─► Listen for 'crew-sign-on'
   │   └─► Listen for 'crew-sign-off'
   │
   ├─► 6. Handle Status Updates
   │   ├─► Listen for 'kiosk-online'
   │   └─► Listen for 'kiosk-offline'
   │
   └─► 7. Stop Monitoring
       ├─► emit 'stop-monitoring'
       └─► Clean up WebRTC connection
```

---

## 🛡️ Step 5: Error Handling Flow

### 5.1 Common Error Scenarios

**Authentication Errors**:
- `AUTH_INVALID_TOKEN` → Token expired or invalid → Reconnect with new token
- `AUTH_INVALID_ROLE` → Wrong role in token → Regenerate token with correct role

**Session Errors**:
- `SESSION_ALREADY_EXISTS` → Another monitor is watching → Show message to user
- `SESSION_NOT_FOUND` → Session ended → Refresh kiosk list and retry
- `SESSION_TIMEOUT` → Session inactive too long → Reconnect

**Signaling Errors**:
- `SIGNALING_NO_SESSION` → No active session → Start monitoring session first
- `SIGNALING_UNAUTHORIZED_SENDER` → Session ownership issue → Restart session
- `SIGNALING_INVALID_TARGET` → Target kiosk/monitor not found → Refresh list

**Rate Limiting Errors**:
- `RATE_LIMIT_EXCEEDED` → Too many events → Wait and retry later

### 5.2 Error Handling Strategy

**For KIOSK App**:
1. **Listen for `error` events** on socket
2. **Parse error code** from error object
3. **Handle based on code**:
   - Authentication errors → Reconnect with new token
   - Rate limit errors → Show user message, wait before retry
   - Other errors → Log and show user-friendly message

**For MONITOR App**:
1. **Listen for `error` events** on socket
2. **Parse error code** from error object
3. **Handle based on code**:
   - Session errors → Refresh kiosk list, allow retry
   - Signaling errors → Restart WebRTC connection
   - Other errors → Log and show user-friendly message

---

## 📦 Step 6: Required Flutter Packages

### 6.1 Socket.IO Client
**Package**: `socket_io_client`
**Purpose**: Connect to backend Socket.IO server
**Usage**: 
- Initialize client with server URL and auth token
- Listen for events
- Emit events

### 6.2 WebRTC
**Package**: `flutter_webrtc`
**Purpose**: Establish peer-to-peer video connections
**Usage**:
- Create RTCPeerConnection
- Create offer/answer
- Handle ICE candidates
- Display video stream

### 6.3 Secure Storage
**Package**: `flutter_secure_storage`
**Purpose**: Store JWT tokens securely
**Usage**:
- Save token after generation
- Load token on app start
- Delete token on logout

### 6.4 JSON Web Token (Optional)
**Package**: `jwt_decoder` (if you need to decode tokens client-side)
**Purpose**: Decode JWT to check expiration
**Usage**:
- Check if token is expired before connecting
- Extract clientId and role from token

---

## 🔧 Step 7: Implementation Checklist

### KIOSK App Checklist
- [ ] Generate/load JWT token with KIOSK role
- [ ] Connect to Socket.IO with token
- [ ] Emit `register-kiosk` on connection
- [ ] Implement heartbeat ping every 30 seconds
- [ ] Listen for `offer` event from monitors
- [ ] Implement WebRTC answer creation
- [ ] Exchange ICE candidates
- [ ] Emit `crew-sign-on` when crew signs on
- [ ] Emit `crew-sign-off` when crew signs off
- [ ] Handle `error` events gracefully
- [ ] Handle disconnect/reconnection

### MONITOR App Checklist
- [ ] Generate/load JWT token with MONITOR role
- [ ] Connect to Socket.IO with token
- [ ] Emit `register-monitor` on connection
- [ ] Display list of online kiosks
- [ ] Implement `start-monitoring` when user selects kiosk
- [ ] Create WebRTC offer and emit it
- [ ] Handle WebRTC answer from kiosk
- [ ] Exchange ICE candidates
- [ ] Display video stream in UI
- [ ] Listen for `crew-sign-on` and `crew-sign-off` events
- [ ] Listen for `kiosk-online` and `kiosk-offline` events
- [ ] Handle `session-ended` and `session-timeout` events
- [ ] Implement `stop-monitoring` functionality
- [ ] Handle `error` events gracefully
- [ ] Handle disconnect/reconnection

---

## 🎯 Step 8: Best Practices

### 8.1 Connection Management
- **Always check connection status** before emitting events
- **Implement reconnection logic** with exponential backoff
- **Handle connection errors** gracefully
- **Show connection status** to users

### 8.2 Session Management
- **Always start session** before WebRTC signaling
- **Validate session exists** before sending signaling messages
- **Handle session timeouts** gracefully
- **Clean up sessions** on app close

### 8.3 WebRTC Best Practices
- **Wait for session confirmation** before creating offer
- **Handle ICE candidate failures** gracefully
- **Clean up peer connections** on disconnect
- **Test with different network conditions**

### 8.4 Error Handling
- **Always listen for error events**
- **Parse error codes** for specific handling
- **Show user-friendly messages**
- **Log errors** for debugging

### 8.5 Security
- **Store tokens securely** (flutter_secure_storage)
- **Never expose tokens** in logs or UI
- **Validate tokens** before use
- **Handle token expiration** gracefully

---

## 📊 Step 9: Event Reference

### Events KIOSK App Should Handle
- `connect` - Connection established
- `kiosk-registered` - Registration confirmed
- `heartbeat-pong` - Heartbeat response
- `offer` - WebRTC offer from monitor
- `answer` - WebRTC answer (if monitor responds)
- `ice-candidate` - ICE candidate from monitor
- `crew-sign-on-ack` - Crew event acknowledgment
- `crew-sign-off-ack` - Crew event acknowledgment
- `error` - Error occurred
- `disconnect` - Connection lost

### Events MONITOR App Should Handle
- `connect` - Connection established
- `monitor-registered` - Registration confirmed with kiosk list
- `kiosk-online` - New kiosk available
- `kiosk-offline` - Kiosk went offline
- `monitoring-started` - Session started successfully
- `monitoring-stopped` - Session stopped successfully
- `offer` - WebRTC offer (if kiosk initiates)
- `answer` - WebRTC answer from kiosk
- `ice-candidate` - ICE candidate from kiosk
- `crew-sign-on` - Crew member signed on
- `crew-sign-off` - Crew member signed off
- `session-ended` - Session ended (various reasons)
- `session-timeout` - Session timed out
- `error` - Error occurred
- `disconnect` - Connection lost

### Events KIOSK App Should Emit
- `register-kiosk` - Register as kiosk
- `heartbeat-ping` - Send heartbeat
- `answer` - WebRTC answer
- `ice-candidate` - ICE candidate
- `crew-sign-on` - Crew sign-on event
- `crew-sign-off` - Crew sign-off event

### Events MONITOR App Should Emit
- `register-monitor` - Register as monitor
- `start-monitoring` - Start monitoring session
- `stop-monitoring` - Stop monitoring session
- `offer` - WebRTC offer
- `ice-candidate` - ICE candidate

---

## 🚀 Step 10: Testing Flow

### 10.1 Test Scenarios

**Basic Connection**:
1. Start backend server
2. Launch KIOSK app → Should connect and register
3. Launch MONITOR app → Should connect and see kiosk in list

**Session Management**:
1. MONITOR starts monitoring → Should receive confirmation
2. Try second MONITOR → Should receive error (session exists)
3. Stop monitoring → Should receive confirmation

**WebRTC Signaling**:
1. Start session
2. Monitor creates offer → Kiosk receives offer
3. Kiosk creates answer → Monitor receives answer
4. Exchange ICE candidates → Connection established
5. Video stream should appear

**Crew Events**:
1. Kiosk emits crew-sign-on → Monitor receives event
2. Verify rate limiting (send 11 events quickly) → Should get error on 11th

**Heartbeat**:
1. Kiosk sends heartbeat → Should receive pong
2. Stop sending heartbeat → After 90s, monitor should see kiosk offline

**Error Handling**:
1. Use invalid token → Should get authentication error
2. Try signaling without session → Should get session error
3. Try monitoring offline kiosk → Should get error

---

## 📝 Summary

### Key Concepts

1. **Backend is Signaling Only**: Never touches video streams, only forwards signaling messages
2. **Session Required**: Must start monitoring session before WebRTC signaling
3. **One Monitor Per Kiosk**: Backend enforces this rule
4. **Heartbeat Required**: Kiosks must send heartbeat every 30s
5. **Rate Limited**: Crew events and signaling are rate limited
6. **Error Codes**: All errors have structured codes for handling

### Integration Steps

1. **Setup**: Install packages, configure Socket.IO client
2. **Authentication**: Generate and store JWT tokens
3. **Connection**: Connect with token, register based on role
4. **Session**: Monitor starts session before WebRTC
5. **WebRTC**: Exchange signaling messages through backend
6. **Events**: Handle crew events and status updates
7. **Errors**: Implement error handling for all scenarios

### Success Criteria

- ✅ Kiosk connects and registers successfully
- ✅ Monitor sees kiosk in available list
- ✅ Monitor can start monitoring session
- ✅ WebRTC connection establishes successfully
- ✅ Video stream displays in monitor app
- ✅ Crew events broadcast correctly
- ✅ Heartbeat keeps kiosk online
- ✅ Errors handled gracefully
- ✅ Sessions managed correctly
- ✅ Disconnects handled cleanly

---

This guide provides the complete flow for integrating your Flutter applications with the hardened backend. Follow the steps sequentially and test each component before moving to the next.
