# Video Streaming & Live Streaming Explained
## How WebRTC Works in Railway Monitoring System

This document explains how video streaming works after authentication, without code implementation details.

---

## 🎯 Overview: The Big Picture

### Key Concept: **Peer-to-Peer (P2P) Video Streaming**

```
┌─────────────┐                    ┌─────────────┐
│   KIOSK     │                    │   MONITOR   │
│  (Camera)   │◄───Video Stream───►│  (Viewer)   │
│             │    (Direct P2P)    │             │
└─────────────┘                    └─────────────┘
      │                                    │
      └──────────────┬─────────────────────┘
                     │
              ┌──────────────┐
              │   Backend    │
              │  (Signaling) │
              └──────────────┘
         Only handles signaling,
         NEVER touches video data
```

**Critical Point:** The backend server **NEVER sees or processes video**. It only helps establish the connection between KIOSK and MONITOR.

---

## 📡 Step-by-Step: Complete Video Streaming Flow

### Phase 1: Authentication & Registration (Already Done)

1. **KIOSK App:**
   - Logs in → Gets JWT token
   - Connects to Socket.IO with token
   - Registers: `emit('register-kiosk')`
   - Backend marks kiosk as online

2. **MONITOR App:**
   - Logs in → Gets JWT token
   - Connects to Socket.IO with token
   - Registers: `emit('register-monitor')`
   - Receives list of online kiosks

**Result:** Both apps are authenticated and registered. Backend knows who's online.

---

### Phase 2: Session Establishment

#### Step 1: Monitor Starts Monitoring Session

**MONITOR App:**
- User selects a kiosk from the list
- Clicks "Start Monitoring"
- App sends: `emit('start-monitoring', { kioskId: 'KIOSK_01' })`

**Backend:**
- Validates: Monitor is authenticated
- Validates: Kiosk exists and is online
- Validates: No other monitor is already monitoring this kiosk
- Creates a **monitoring session** in memory
- Responds: `emit('monitoring-started')` to monitor

**Result:** A session is established. Backend tracks that MONITOR_01 is monitoring KIOSK_01.

---

### Phase 3: WebRTC Signaling (The Backend's Role)

**What is Signaling?**
Signaling is like a phone call setup - it helps two devices find each other and agree on how to connect, but the actual conversation (video) happens directly between them.

#### Step 2: Monitor Creates WebRTC Offer

**MONITOR App (WebRTC Side):**
1. Creates a **WebRTC Peer Connection** object
2. Configures it with STUN/TURN servers (for NAT traversal)
3. Creates an **offer** (like saying "I want to connect")
4. Sets this offer as its **local description**
5. Sends offer to backend via Socket.IO:
   ```
   emit('offer', {
     targetId: 'KIOSK_01',
     offer: { sdp: '...', type: 'offer' }
   })
   ```

**Backend:**
- Receives offer from MONITOR
- Validates: Session exists between MONITOR and KIOSK
- Validates: MONITOR owns the session
- **Forwards** offer to KIOSK:
  ```
  io.to(kioskSocketId).emit('offer', {
    fromId: 'MONITOR_01',
    offer: { sdp: '...', type: 'offer' }
  })
  ```

**Result:** KIOSK receives the offer.

---

#### Step 3: KIOSK Creates WebRTC Answer

**KIOSK App (WebRTC Side):**
1. Receives offer from MONITOR via Socket.IO
2. Sets offer as **remote description** (what MONITOR wants)
3. Accesses camera to get video stream
4. Adds video track to peer connection
5. Creates an **answer** (like saying "Yes, I agree to connect")
6. Sets answer as **local description**
7. Sends answer back via Socket.IO:
   ```
   emit('answer', {
     targetId: 'MONITOR_01',
     answer: { sdp: '...', type: 'answer' }
   })
   ```

**Backend:**
- Receives answer from KIOSK
- Validates: Session exists
- Validates: KIOSK is part of the session
- **Forwards** answer to MONITOR:
  ```
  io.to(monitorSocketId).emit('answer', {
    fromId: 'KIOSK_01',
    answer: { sdp: '...', type: 'answer' }
  })
  ```

**Result:** MONITOR receives the answer.

---

#### Step 4: ICE Candidate Exchange (Network Discovery)

**What are ICE Candidates?**
ICE (Interactive Connectivity Establishment) candidates are network addresses (IP + port) that each device can use to receive data. Devices exchange these to find the best path to connect.

**KIOSK App:**
- WebRTC discovers network addresses (local IP, public IP via STUN)
- For each address found, creates an **ICE candidate**
- Sends each candidate via Socket.IO:
  ```
  emit('ice-candidate', {
    targetId: 'MONITOR_01',
    candidate: {
      candidate: 'candidate:...',
      sdpMLineIndex: 0,
      sdpMid: '0'
    }
  })
  ```

**Backend:**
- Receives ICE candidates from KIOSK
- Validates: Session exists
- **Forwards** to MONITOR:
  ```
  io.to(monitorSocketId).emit('ice-candidate', {
    fromId: 'KIOSK_01',
    candidate: { ... }
  })
  ```

**MONITOR App:**
- Receives ICE candidates
- Adds them to peer connection
- WebRTC tries to establish connection using these addresses

**Same process in reverse:** MONITOR also sends ICE candidates to KIOSK.

**Result:** Both devices know how to reach each other.

---

### Phase 4: Direct Video Connection Established

**What Happens Now:**

1. **WebRTC Connection:**
   - Both devices have exchanged offers, answers, and ICE candidates
   - WebRTC libraries on both sides negotiate the best connection path
   - A **direct peer-to-peer connection** is established
   - This connection bypasses the backend completely

2. **Video Stream Flow:**
   ```
   KIOSK Camera
        ↓
   KIOSK WebRTC (encodes video)
        ↓
   Direct P2P Connection (encrypted)
        ↓
   MONITOR WebRTC (decodes video)
        ↓
   MONITOR Screen (displays video)
   ```

3. **Backend's Role:**
   - **NO involvement** in video data
   - Only tracks session status
   - Handles heartbeat pings
   - Broadcasts crew events
   - **Never sees video frames**

---

## 🔍 Technical Details

### What's in the Offer/Answer (SDP)?

**SDP (Session Description Protocol)** contains:
- Media types (video, audio)
- Codecs supported (H.264, VP8, VP9, etc.)
- Network information
- Encryption keys (DTLS)
- Bandwidth preferences

**Example SDP (simplified):**
```
v=0
o=- 1234567890 1234567890 IN IP4 192.168.1.100
s=-
t=0 0
m=video 9 UDP/TLS/RTP/SAVPF 96
a=rtpmap:96 VP8/90000
a=sendrecv
a=ice-ufrag:abc123
a=ice-pwd:xyz789
```

### What's in ICE Candidates?

**ICE Candidate contains:**
- IP address (local or public)
- Port number
- Protocol (UDP/TCP)
- Priority
- Type (host, srflx, relay)

**Example:**
```
candidate:1234567890 1 udp 2113667327 192.168.1.100 54321 typ host
```

---

## 🌐 Network Path Discovery

### How Devices Find Each Other

1. **STUN Server:**
   - Helps discover public IP address
   - Example: `stun:stun.l.google.com:19302`
   - Both devices query STUN to find their public IPs
   - These IPs are exchanged as ICE candidates

2. **NAT Traversal:**
   - Most devices are behind NAT (Network Address Translation)
   - STUN helps punch through NAT
   - If STUN fails, TURN server is used

3. **TURN Server (if needed):**
   - Acts as relay if direct connection fails
   - Video goes: KIOSK → TURN → MONITOR
   - Still encrypted end-to-end
   - Backend doesn't run TURN (separate service)

---

## 📊 Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    AUTHENTICATION PHASE                      │
├─────────────────────────────────────────────────────────────┤
│ KIOSK Login → Token → Socket.IO Connect → Register KIOSK    │
│ MONITOR Login → Token → Socket.IO Connect → Register MONITOR│
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    SESSION PHASE                            │
├─────────────────────────────────────────────────────────────┤
│ MONITOR: start-monitoring(KIOSK_01)                         │
│ Backend: Creates session, validates, responds              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              WEBRTC SIGNALING PHASE                        │
│              (Backend forwards messages)                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  MONITOR                    Backend                    KIOSK│
│     │                         │                         │  │
│     │───offer───────────────►│                         │  │
│     │                         │───offer───────────────►│  │
│     │                         │                         │  │
│     │                         │◄──answer───────────────│  │
│     │◄──answer────────────────│                         │  │
│     │                         │                         │  │
│     │───ice-candidate────────►│                         │  │
│     │                         │───ice-candidate───────►│  │
│     │                         │                         │  │
│     │◄──ice-candidate─────────│◄──ice-candidate────────│  │
│     │                         │                         │  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              DIRECT VIDEO CONNECTION                        │
│              (Backend NOT involved)                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  KIOSK Camera                                               │
│     │                                                       │
│     │ Video Stream (Encrypted, Direct P2P)                 │
│     │                                                       │
│     ▼                                                       │
│  MONITOR Screen                                             │
│                                                             │
│  Backend: Only sees heartbeat pings, crew events            │
│           NEVER sees video data                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔐 Security & Encryption

### Video Stream Security

1. **DTLS (Datagram Transport Layer Security):**
   - Video stream is encrypted end-to-end
   - Even if intercepted, cannot be decoded
   - Keys exchanged during SDP negotiation

2. **SRTP (Secure Real-time Transport Protocol):**
   - Video packets encrypted with SRTP
   - Keys derived from DTLS handshake
   - Backend never has these keys

3. **Session Validation:**
   - Backend validates session before forwarding signaling
   - Only authorized monitor can receive video
   - Prevents unauthorized access

---

## ⚡ Performance & Scalability

### Why This Architecture Scales

1. **Backend Load:**
   - Only handles signaling (small messages)
   - Video doesn't go through backend
   - Can support many concurrent sessions

2. **Bandwidth:**
   - Video goes directly between devices
   - Backend doesn't need high bandwidth
   - Each connection uses its own bandwidth

3. **Latency:**
   - Direct P2P connection = lower latency
   - No server processing delay
   - Real-time video streaming

---

## 🎥 Video Codecs & Quality

### Supported Codecs

WebRTC supports multiple video codecs:
- **VP8** - Good quality, open source
- **VP9** - Better compression, open source
- **H.264** - Widely supported, hardware accelerated
- **AV1** - Latest, best compression

### Quality Adaptation

- WebRTC automatically adjusts quality based on:
  - Available bandwidth
  - Network conditions
  - Device capabilities
- No backend involvement needed

---

## 🔄 What Happens During Streaming

### Continuous Operations

1. **Heartbeat (KIOSK):**
   - Every 30 seconds: `emit('heartbeat-ping')`
   - Backend responds: `emit('heartbeat-pong')`
   - Keeps session alive
   - Video continues independently

2. **Crew Events (KIOSK):**
   - When crew signs on/off: `emit('crew-sign-on')`
   - Backend broadcasts to all monitors
   - Video stream unaffected

3. **ICE Candidate Updates:**
   - If network changes, new candidates sent
   - WebRTC adapts connection
   - Video continues seamlessly

---

## 🛑 What Happens When Connection Ends

### Session Termination

1. **Monitor Stops Monitoring:**
   - `emit('stop-monitoring', { kioskId })`
   - Backend ends session
   - WebRTC connection closes
   - Video stops

2. **Kiosk Disconnects:**
   - Socket.IO disconnect event
   - Backend ends session
   - Notifies monitor
   - Video stops

3. **Network Issues:**
   - WebRTC detects connection loss
   - Attempts reconnection
   - If fails, connection ends
   - Backend may timeout session

---

## 📱 Device Requirements

### KIOSK Device Needs:
- Camera access permission
- WebRTC support (browser/Flutter)
- Network connection (upload bandwidth for video)
- STUN/TURN server access

### MONITOR Device Needs:
- WebRTC support (browser/Flutter)
- Network connection (download bandwidth for video)
- Display capability
- STUN/TURN server access

---

## 🌍 Network Scenarios

### Scenario 1: Same Network
- Both devices on same WiFi
- Direct connection via local IP
- Lowest latency
- No STUN/TURN needed

### Scenario 2: Different Networks
- Devices on different networks
- STUN discovers public IPs
- Direct connection via public IPs
- Slightly higher latency

### Scenario 3: Behind Strict NAT
- Direct connection fails
- TURN server relays traffic
- Higher latency, but works
- Still encrypted end-to-end

---

## 🔍 Monitoring & Debugging

### What You Can Monitor

1. **Backend Logs:**
   - Session creation/end
   - Signaling messages forwarded
   - Heartbeat pings
   - Crew events
   - **NOT video quality or frames**

2. **WebRTC Stats:**
   - Connection state
   - Bandwidth usage
   - Packet loss
   - Latency
   - Codec used
   - (Available in browser DevTools or Flutter WebRTC stats API)

---

## 💡 Key Takeaways

1. **Backend is Signaling-Only:**
   - Never processes video
   - Only forwards signaling messages
   - Validates sessions and permissions

2. **Video is Direct P2P:**
   - Goes directly from KIOSK to MONITOR
   - Encrypted end-to-end
   - Backend cannot see video content

3. **Signaling Flow:**
   - Offer → Answer → ICE candidates
   - Backend forwards each message
   - WebRTC libraries handle connection

4. **Session Management:**
   - Backend tracks who's monitoring whom
   - Validates before forwarding signaling
   - Handles timeouts and disconnects

5. **Scalability:**
   - Backend load is minimal (signaling only)
   - Video bandwidth doesn't affect backend
   - Can support many concurrent streams

---

## 🎯 Summary: The Complete Picture

**After Token Generation:**

1. ✅ **Authentication** - Both apps authenticated
2. ✅ **Registration** - Both apps registered
3. ✅ **Session** - Monitor starts monitoring kiosk
4. ✅ **Signaling** - Offer/Answer/ICE exchanged via backend
5. ✅ **Connection** - Direct P2P connection established
6. ✅ **Video** - Stream flows directly KIOSK → MONITOR
7. ✅ **Ongoing** - Heartbeat keeps session alive, crew events broadcast

**The Backend:**
- ✅ Handles authentication
- ✅ Manages sessions
- ✅ Forwards signaling
- ✅ Broadcasts events
- ❌ Never touches video data

**The Video:**
- ✅ Encrypted end-to-end
- ✅ Direct peer-to-peer
- ✅ Real-time streaming
- ✅ Quality adapts automatically
- ✅ Backend cannot intercept

This architecture ensures **scalability**, **security**, and **low latency** for video streaming!
