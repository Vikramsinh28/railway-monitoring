/**
 * Socket.IO Event Handlers
 * 
 * Hardened, production-ready Socket.IO event handling with:
 * - Centralized state management
 * - Explicit session lifecycle
 * - WebRTC signaling validation
 * - Standardized error handling
 * - Rate limiting
 * - Heartbeat/keep-alive
 * - Clean disconnect handling
 * 
 * Architecture Note: This backend is VIEW-ONLY and does NOT process
 * video streams. It only forwards WebRTC signaling messages between
 * clients and broadcasts crew events to MONITOR clients.
 */

import { ROLES } from '../auth/auth.middleware.js';
import { broadcastCrewSignOn, broadcastCrewSignOff, validateCrewEventPayload } from '../events/crew.events.js';
import { emitError, validateOrError, ERROR_CODES } from '../errors/socket.error.js';
import * as kiosksState from '../state/kiosks.state.js';
import * as monitorsState from '../state/monitors.state.js';
import * as sessionsState from '../state/sessions.state.js';
import { checkRateLimit, resetAllRateLimits } from '../utils/rate.limiter.js';
import { processHeartbeatPing, removeHeartbeat, startHeartbeatChecker } from '../utils/heartbeat.js';
import { logInfo, logWarn, logError, logDebug } from '../utils/logger.js';

/**
 * Initialize Socket.IO connection handling
 * 
 * @param {Object} io - Socket.IO server instance
 */
export const initializeSocket = (io) => {
  // Start periodic heartbeat timeout checking
  startHeartbeatChecker(io);

  // Start periodic session timeout checking
  // Check every 30 seconds for timed-out sessions
  setInterval(() => {
    const timedOutSessions = sessionsState.getTimedOutSessions();
    
    if (timedOutSessions.length > 0) {
      logInfo('Session', `Checking for timed-out sessions: ${timedOutSessions.length} found`);
    }
    
    for (const session of timedOutSessions) {
      logWarn('Session', 'Session timeout detected', {
        kioskId: session.kioskId,
        monitorId: session.monitorId,
        monitorSocketId: session.monitorSocketId,
        startedAt: session.startedAt,
        lastActivityAt: session.lastActivityAt
      });
      
      // End the session
      sessionsState.endSession(session.kioskId);
      
      // Notify monitors
      io.to('monitors').emit('session-ended', {
        kioskId: session.kioskId,
        monitorId: session.monitorId,
        reason: 'session-timeout',
        timestamp: new Date().toISOString()
      });

      // Notify the monitor that owned the session
      const monitorSocket = io.sockets.sockets.get(session.monitorSocketId);
      if (monitorSocket) {
        monitorSocket.emit('session-timeout', {
          kioskId: session.kioskId,
          timestamp: new Date().toISOString()
        });
        logInfo('Session', 'Session timeout notification sent to monitor', {
          monitorId: session.monitorId,
          kioskId: session.kioskId
        });
      }
    }
  }, 30000); // Check every 30 seconds

  logInfo('Session', 'Session timeout checker started', { interval: '30s' });

  io.on('connection', (socket) => {
    const { role, clientId } = socket.data;

    logInfo('Socket', 'Client connected', {
      clientId,
      role,
      socketId: socket.id,
      transport: socket.conn.transport.name
    });

    // Join role-specific room for targeted broadcasts
    if (role === ROLES.MONITOR) {
      socket.join('monitors');
      logInfo('Socket', 'Monitor joined monitors room', { clientId, socketId: socket.id });
    } else if (role === ROLES.KIOSK) {
      socket.join('kiosks');
      logInfo('Socket', 'Kiosk joined kiosks room', { clientId, socketId: socket.id });
    }

    /**
     * Register KIOSK client
     * Emits kiosk-online event to all MONITOR clients
     */
    socket.on('register-kiosk', () => {
      logInfo('Socket', 'Register kiosk request received', { clientId, socketId: socket.id });
      
      // Guard: Only KIOSK role can register as kiosk
      if (!validateOrError(socket, role === ROLES.KIOSK, ERROR_CODES.AUTH_INVALID_ROLE, 
          'Unauthorized: Only KIOSK clients can register as kiosk')) {
        logWarn('Socket', 'Register kiosk failed: Invalid role', { clientId, role });
        return;
      }

      try {
        // Register kiosk in state
        const kioskData = kiosksState.registerKiosk(clientId, socket.id);

        // Notify all monitors that this kiosk is online
        io.to('monitors').emit('kiosk-online', {
          kioskId: clientId,
          timestamp: new Date().toISOString()
        });

        socket.emit('kiosk-registered', {
          kioskId: clientId,
          timestamp: new Date().toISOString()
        });

        logInfo('Socket', 'Kiosk registered successfully', {
          clientId,
          socketId: socket.id,
          registeredAt: kioskData.registeredAt
        });
      } catch (error) {
        logError('Socket', 'Failed to register kiosk', {
          clientId,
          socketId: socket.id,
          error: error.message
        });
        emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to register kiosk', { error: error.message });
      }
    });

    /**
     * Register MONITOR client
     */
    socket.on('register-monitor', () => {
      logInfo('Socket', 'Register monitor request received', { clientId, socketId: socket.id });
      
      // Guard: Only MONITOR role can register as monitor
      if (!validateOrError(socket, role === ROLES.MONITOR, ERROR_CODES.AUTH_INVALID_ROLE,
          'Unauthorized: Only MONITOR clients can register as monitor')) {
        logWarn('Socket', 'Register monitor failed: Invalid role', { clientId, role });
        return;
      }

      try {
        // Register monitor in state
        const monitorData = monitorsState.registerMonitor(clientId, socket.id);

        // Send list of online kiosks
        const onlineKiosks = kiosksState.getAllKiosks()
          .filter(kiosk => kiosk.status === 'online')
          .map(kiosk => ({
            kioskId: kiosk.kioskId,
            connectedAt: kiosk.registeredAt.toISOString()
          }));

        socket.emit('monitor-registered', {
          monitorId: clientId,
          onlineKiosks,
          timestamp: new Date().toISOString()
        });

        logInfo('Socket', 'Monitor registered successfully', {
          clientId,
          socketId: socket.id,
          registeredAt: monitorData.registeredAt,
          onlineKiosksCount: onlineKiosks.length
        });
      } catch (error) {
        logError('Socket', 'Failed to register monitor', {
          clientId,
          socketId: socket.id,
          error: error.message
        });
        emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to register monitor', { error: error.message });
      }
    });

    /**
     * Start Monitoring Session
     * Only MONITOR can start monitoring
     * Only one MONITOR per KIOSK at a time
     */
    socket.on('start-monitoring', (data) => {
      const { kioskId } = data || {};
      
      logInfo('Session', 'Start monitoring request received', {
        monitorId: clientId,
        kioskId,
        socketId: socket.id
      });

      // Guard: Only MONITOR role can start monitoring
      if (!validateOrError(socket, role === ROLES.MONITOR, ERROR_CODES.OPERATION_NOT_ALLOWED,
          'Unauthorized: Only MONITOR clients can start monitoring')) {
        logWarn('Session', 'Start monitoring failed: Invalid role', { clientId, role, kioskId });
        return;
      }

      // Guard: kioskId is required
      if (!validateOrError(socket, kioskId, ERROR_CODES.INVALID_REQUEST,
          'Invalid request: kioskId is required')) {
        logWarn('Session', 'Start monitoring failed: Missing kioskId', { clientId });
        return;
      }

      // Guard: Kiosk must be registered and online
      if (!validateOrError(socket, kiosksState.isKioskOnline(kioskId), ERROR_CODES.SESSION_KIOSK_OFFLINE,
          `Kiosk ${kioskId} is not online`)) {
        logWarn('Session', 'Start monitoring failed: Kiosk offline', { clientId, kioskId });
        return;
      }

      // Guard: Check if session already exists for this kiosk
      if (sessionsState.hasActiveSession(kioskId)) {
        const existingSession = sessionsState.getSession(kioskId);
        // Only allow if this monitor already owns the session
        if (existingSession.monitorSocketId !== socket.id) {
          logWarn('Session', 'Start monitoring failed: Session already exists', {
            clientId,
            kioskId,
            existingMonitorId: existingSession.monitorId
          });
          emitError(socket, ERROR_CODES.SESSION_ALREADY_EXISTS,
              `Kiosk ${kioskId} is already being monitored by another monitor`,
              { existingMonitorId: existingSession.monitorId });
          return;
        }
        // If monitor already owns session, just update activity
        sessionsState.updateSessionActivity(kioskId);
        socket.emit('monitoring-started', {
          kioskId,
          sessionId: kioskId, // Using kioskId as session identifier
          timestamp: new Date().toISOString()
        });
        logInfo('Session', 'Monitoring session activity updated', {
          monitorId: clientId,
          kioskId
        });
        return;
      }

      try {
        // Create new session
        const session = sessionsState.createSession(kioskId, clientId, socket.id);

        socket.emit('monitoring-started', {
          kioskId,
          sessionId: kioskId,
          startedAt: session.startedAt.toISOString(),
          timestamp: new Date().toISOString()
        });

        logInfo('Session', 'Monitoring session started', {
          monitorId: clientId,
          kioskId,
          sessionId: kioskId,
          startedAt: session.startedAt
        });
      } catch (error) {
        logError('Session', 'Failed to start monitoring session', {
          monitorId: clientId,
          kioskId,
          error: error.message
        });
        emitError(socket, ERROR_CODES.SESSION_NOT_AUTHORIZED, error.message);
      }
    });

    /**
     * Stop Monitoring Session
     * Only MONITOR can stop monitoring
     * Only the monitor that owns the session can stop it
     */
    socket.on('stop-monitoring', (data) => {
      const { kioskId } = data || {};
      
      logInfo('Session', 'Stop monitoring request received', {
        monitorId: clientId,
        kioskId,
        socketId: socket.id
      });

      // Guard: Only MONITOR role can stop monitoring
      if (!validateOrError(socket, role === ROLES.MONITOR, ERROR_CODES.OPERATION_NOT_ALLOWED,
          'Unauthorized: Only MONITOR clients can stop monitoring')) {
        logWarn('Session', 'Stop monitoring failed: Invalid role', { clientId, role, kioskId });
        return;
      }

      // Guard: kioskId is required
      if (!validateOrError(socket, kioskId, ERROR_CODES.INVALID_REQUEST,
          'Invalid request: kioskId is required')) {
        logWarn('Session', 'Stop monitoring failed: Missing kioskId', { clientId });
        return;
      }

      // Guard: Session must exist
      if (!validateOrError(socket, sessionsState.hasActiveSession(kioskId), ERROR_CODES.SESSION_NOT_FOUND,
          `No active session found for kiosk ${kioskId}`)) {
        logWarn('Session', 'Stop monitoring failed: Session not found', { clientId, kioskId });
        return;
      }

      // Guard: Monitor must own the session
      if (!validateOrError(socket, sessionsState.validateSessionOwnership(kioskId, socket.id),
          ERROR_CODES.SESSION_NOT_AUTHORIZED,
          'Unauthorized: You do not own this monitoring session')) {
        logWarn('Session', 'Stop monitoring failed: Session ownership invalid', {
          clientId,
          kioskId,
          socketId: socket.id
        });
        return;
      }

      try {
        // End session
        const endedSession = sessionsState.endSession(kioskId);

        socket.emit('monitoring-stopped', {
          kioskId,
          timestamp: new Date().toISOString()
        });

        logInfo('Session', 'Monitoring session stopped', {
          monitorId: clientId,
          kioskId,
          startedAt: endedSession.startedAt,
          endedAt: endedSession.endedAt
        });
      } catch (error) {
        logError('Session', 'Failed to stop monitoring session', {
          monitorId: clientId,
          kioskId,
          error: error.message
        });
        emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to stop monitoring', { error: error.message });
      }
    });

    /**
     * WebRTC Signaling: Forward offer
     * 
     * Validates:
     * - Both sender and receiver are registered
     * - An active session exists
     * - Sender belongs to the session
     * - KIOSK ↔ MONITOR pairing is correct
     */
    socket.on('offer', (data) => {
      const { targetId, offer } = data || {};
      
      logDebug('WebRTC', 'Offer received', {
        fromId: clientId,
        targetId,
        role
      });

      // Guard: Required fields
      if (!validateOrError(socket, targetId && offer, ERROR_CODES.SIGNALING_MISSING_DATA,
          'Invalid offer: targetId and offer are required')) {
        logWarn('WebRTC', 'Offer failed: Missing required fields', {
          clientId,
          targetId: !!targetId,
          offer: !!offer
        });
        return;
      }

      // Rate limiting
      const rateLimit = checkRateLimit(clientId, 'offer');
      if (!rateLimit.allowed) {
        logWarn('WebRTC', 'Offer rate limit exceeded', {
          clientId,
          current: rateLimit.current,
          limit: rateLimit.limit,
          resetAt: rateLimit.resetAt
        });
        emitError(socket, ERROR_CODES.RATE_LIMIT_EXCEEDED,
            `Rate limit exceeded: ${rateLimit.current}/${rateLimit.limit} offers per minute`,
            { resetAt: rateLimit.resetAt.toISOString() });
        return;
      }

      // Determine sender and receiver roles
      const senderRole = role;
      const targetKiosk = kiosksState.getKiosk(targetId);
      const targetMonitor = monitorsState.getMonitor(targetId);

      // Guard: Target must exist
      if (!targetKiosk && !targetMonitor) {
        emitError(socket, ERROR_CODES.SIGNALING_INVALID_TARGET, `Target client not found: ${targetId}`);
        return;
      }

      const targetRole = targetKiosk ? ROLES.KIOSK : ROLES.MONITOR;
      const targetSocketId = targetKiosk ? targetKiosk.socketId : targetMonitor.socketId;

      // Guard: Must be KIOSK ↔ MONITOR pairing
      if (!validateOrError(socket,
          (senderRole === ROLES.KIOSK && targetRole === ROLES.MONITOR) ||
          (senderRole === ROLES.MONITOR && targetRole === ROLES.KIOSK),
          ERROR_CODES.SIGNALING_INVALID_PAIRING,
          'Invalid pairing: Offers can only be sent between KIOSK and MONITOR')) {
        return;
      }

      // Determine kioskId for session validation
      const kioskId = senderRole === ROLES.KIOSK ? clientId : targetId;

      // Guard: Active session must exist
      if (!validateOrError(socket, sessionsState.hasActiveSession(kioskId),
          ERROR_CODES.SIGNALING_NO_SESSION,
          `No active monitoring session for kiosk ${kioskId}`)) {
        return;
      }

      // Guard: Validate session ownership
      const session = sessionsState.getSession(kioskId);
      if (senderRole === ROLES.MONITOR) {
        // Monitor must own the session
        if (!validateOrError(socket, session.monitorSocketId === socket.id,
            ERROR_CODES.SIGNALING_UNAUTHORIZED_SENDER,
            'Unauthorized: You do not own the monitoring session for this kiosk')) {
          return;
        }
      } else {
        // KIOSK must be the kiosk in the session
        if (!validateOrError(socket, session.kioskId === clientId,
            ERROR_CODES.SIGNALING_UNAUTHORIZED_SENDER,
            'Unauthorized: Invalid kiosk for this session')) {
          return;
        }
      }

      // Update session activity
      sessionsState.updateSessionActivity(kioskId);

      // Forward offer to target client
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.emit('offer', {
          fromId: clientId,
          offer
        });
        logInfo('WebRTC', 'Offer forwarded successfully', {
          fromId: clientId,
          toId: targetId,
          kioskId
        });
      } else {
        logWarn('WebRTC', 'Offer failed: Target socket not found', {
          clientId,
          targetId,
          targetSocketId
        });
        emitError(socket, ERROR_CODES.SIGNALING_INVALID_TARGET, `Target socket not found: ${targetId}`);
      }
    });

    /**
     * WebRTC Signaling: Forward answer
     * 
     * Validates:
     * - Both sender and receiver are registered
     * - An active session exists
     * - Sender belongs to the session
     * - KIOSK ↔ MONITOR pairing is correct
     */
    socket.on('answer', (data) => {
      const { targetId, answer } = data || {};
      
      logDebug('WebRTC', 'Answer received', {
        fromId: clientId,
        targetId,
        role
      });

      // Guard: Required fields
      if (!validateOrError(socket, targetId && answer, ERROR_CODES.SIGNALING_MISSING_DATA,
          'Invalid answer: targetId and answer are required')) {
        logWarn('WebRTC', 'Answer failed: Missing required fields', {
          clientId,
          targetId: !!targetId,
          answer: !!answer
        });
        return;
      }

      // Rate limiting
      const rateLimit = checkRateLimit(clientId, 'answer');
      if (!rateLimit.allowed) {
        logWarn('WebRTC', 'Answer rate limit exceeded', {
          clientId,
          current: rateLimit.current,
          limit: rateLimit.limit,
          resetAt: rateLimit.resetAt
        });
        emitError(socket, ERROR_CODES.RATE_LIMIT_EXCEEDED,
            `Rate limit exceeded: ${rateLimit.current}/${rateLimit.limit} answers per minute`,
            { resetAt: rateLimit.resetAt.toISOString() });
        return;
      }

      // Determine sender and receiver roles
      const senderRole = role;
      const targetKiosk = kiosksState.getKiosk(targetId);
      const targetMonitor = monitorsState.getMonitor(targetId);

      // Guard: Target must exist
      if (!targetKiosk && !targetMonitor) {
        emitError(socket, ERROR_CODES.SIGNALING_INVALID_TARGET, `Target client not found: ${targetId}`);
        return;
      }

      const targetRole = targetKiosk ? ROLES.KIOSK : ROLES.MONITOR;
      const targetSocketId = targetKiosk ? targetKiosk.socketId : targetMonitor.socketId;

      // Guard: Must be KIOSK ↔ MONITOR pairing
      if (!validateOrError(socket,
          (senderRole === ROLES.KIOSK && targetRole === ROLES.MONITOR) ||
          (senderRole === ROLES.MONITOR && targetRole === ROLES.KIOSK),
          ERROR_CODES.SIGNALING_INVALID_PAIRING,
          'Invalid pairing: Answers can only be sent between KIOSK and MONITOR')) {
        return;
      }

      // Determine kioskId for session validation
      const kioskId = senderRole === ROLES.KIOSK ? clientId : targetId;

      // Guard: Active session must exist
      if (!validateOrError(socket, sessionsState.hasActiveSession(kioskId),
          ERROR_CODES.SIGNALING_NO_SESSION,
          `No active monitoring session for kiosk ${kioskId}`)) {
        return;
      }

      // Guard: Validate session ownership
      const session = sessionsState.getSession(kioskId);
      if (senderRole === ROLES.MONITOR) {
        // Monitor must own the session
        if (!validateOrError(socket, session.monitorSocketId === socket.id,
            ERROR_CODES.SIGNALING_UNAUTHORIZED_SENDER,
            'Unauthorized: You do not own the monitoring session for this kiosk')) {
          return;
        }
      } else {
        // KIOSK must be the kiosk in the session
        if (!validateOrError(socket, session.kioskId === clientId,
            ERROR_CODES.SIGNALING_UNAUTHORIZED_SENDER,
            'Unauthorized: Invalid kiosk for this session')) {
          return;
        }
      }

      // Update session activity
      sessionsState.updateSessionActivity(kioskId);

      // Forward answer to target client
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.emit('answer', {
          fromId: clientId,
          answer
        });
        logInfo('WebRTC', 'Answer forwarded successfully', {
          fromId: clientId,
          toId: targetId,
          kioskId
        });
      } else {
        logWarn('WebRTC', 'Answer failed: Target socket not found', {
          clientId,
          targetId,
          targetSocketId
        });
        emitError(socket, ERROR_CODES.SIGNALING_INVALID_TARGET, `Target socket not found: ${targetId}`);
      }
    });

    /**
     * WebRTC Signaling: Forward ICE candidate
     * 
     * Validates:
     * - Both sender and receiver are registered
     * - An active session exists
     * - Sender belongs to the session
     * - KIOSK ↔ MONITOR pairing is correct
     */
    socket.on('ice-candidate', (data) => {
      const { targetId, candidate } = data || {};
      
      logDebug('WebRTC', 'ICE candidate received', {
        fromId: clientId,
        targetId,
        role
      });

      // Guard: Required fields
      if (!validateOrError(socket, targetId && candidate, ERROR_CODES.SIGNALING_MISSING_DATA,
          'Invalid ice-candidate: targetId and candidate are required')) {
        logWarn('WebRTC', 'ICE candidate failed: Missing required fields', {
          clientId,
          targetId: !!targetId,
          candidate: !!candidate
        });
        return;
      }

      // Rate limiting
      const rateLimit = checkRateLimit(clientId, 'ice-candidate');
      if (!rateLimit.allowed) {
        logWarn('WebRTC', 'ICE candidate rate limit exceeded', {
          clientId,
          current: rateLimit.current,
          limit: rateLimit.limit,
          resetAt: rateLimit.resetAt
        });
        emitError(socket, ERROR_CODES.RATE_LIMIT_EXCEEDED,
            `Rate limit exceeded: ${rateLimit.current}/${rateLimit.limit} ICE candidates per minute`,
            { resetAt: rateLimit.resetAt.toISOString() });
        return;
      }

      // Determine sender and receiver roles
      const senderRole = role;
      const targetKiosk = kiosksState.getKiosk(targetId);
      const targetMonitor = monitorsState.getMonitor(targetId);

      // Guard: Target must exist
      if (!targetKiosk && !targetMonitor) {
        emitError(socket, ERROR_CODES.SIGNALING_INVALID_TARGET, `Target client not found: ${targetId}`);
        return;
      }

      const targetRole = targetKiosk ? ROLES.KIOSK : ROLES.MONITOR;
      const targetSocketId = targetKiosk ? targetKiosk.socketId : targetMonitor.socketId;

      // Guard: Must be KIOSK ↔ MONITOR pairing
      if (!validateOrError(socket,
          (senderRole === ROLES.KIOSK && targetRole === ROLES.MONITOR) ||
          (senderRole === ROLES.MONITOR && targetRole === ROLES.KIOSK),
          ERROR_CODES.SIGNALING_INVALID_PAIRING,
          'Invalid pairing: ICE candidates can only be sent between KIOSK and MONITOR')) {
        return;
      }

      // Determine kioskId for session validation
      const kioskId = senderRole === ROLES.KIOSK ? clientId : targetId;

      // Guard: Active session must exist
      if (!validateOrError(socket, sessionsState.hasActiveSession(kioskId),
          ERROR_CODES.SIGNALING_NO_SESSION,
          `No active monitoring session for kiosk ${kioskId}`)) {
        return;
      }

      // Guard: Validate session ownership
      const session = sessionsState.getSession(kioskId);
      if (senderRole === ROLES.MONITOR) {
        // Monitor must own the session
        if (!validateOrError(socket, session.monitorSocketId === socket.id,
            ERROR_CODES.SIGNALING_UNAUTHORIZED_SENDER,
            'Unauthorized: You do not own the monitoring session for this kiosk')) {
          return;
        }
      } else {
        // KIOSK must be the kiosk in the session
        if (!validateOrError(socket, session.kioskId === clientId,
            ERROR_CODES.SIGNALING_UNAUTHORIZED_SENDER,
            'Unauthorized: Invalid kiosk for this session')) {
          return;
        }
      }

      // Update session activity
      sessionsState.updateSessionActivity(kioskId);

      // Forward ICE candidate to target client
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.emit('ice-candidate', {
          fromId: clientId,
          candidate
        });
        logDebug('WebRTC', 'ICE candidate forwarded', {
          fromId: clientId,
          toId: targetId,
          kioskId
        });
      } else {
        logWarn('WebRTC', 'ICE candidate failed: Target socket not found', {
          clientId,
          targetId,
          targetSocketId
        });
        emitError(socket, ERROR_CODES.SIGNALING_INVALID_TARGET, `Target socket not found: ${targetId}`);
      }
    });

    /**
     * Heartbeat Ping
     * KIOSK clients send heartbeat to keep connection alive
     */
    socket.on('heartbeat-ping', () => {
      logDebug('Heartbeat', 'Heartbeat ping received', { clientId });
      
      // Guard: Only KIOSK can send heartbeat
      if (!validateOrError(socket, role === ROLES.KIOSK, ERROR_CODES.OPERATION_NOT_ALLOWED,
          'Unauthorized: Only KIOSK clients can send heartbeat')) {
        logWarn('Heartbeat', 'Heartbeat ping failed: Invalid role', { clientId, role });
        return;
      }

      try {
        // Process heartbeat
        const result = processHeartbeatPing(clientId);
        
        if (result.valid) {
          // Update last seen timestamp
          kiosksState.updateLastSeen(clientId);
          
          // Respond with pong
          socket.emit('heartbeat-pong', {
            timestamp: result.timestamp
          });
          
          logDebug('Heartbeat', 'Heartbeat pong sent', {
            clientId,
            timestamp: result.timestamp
          });
        }
      } catch (error) {
        logError('Heartbeat', 'Failed to process heartbeat', {
          clientId,
          error: error.message
        });
        emitError(socket, ERROR_CODES.INTERNAL_ERROR, 'Failed to process heartbeat', { error: error.message });
      }
    });

    /**
     * Crew Sign-On Event
     * Only KIOSK clients can emit crew sign-on events
     * Events are broadcast to all MONITOR clients
     */
    socket.on('crew-sign-on', (payload) => {
      logInfo('CrewEvent', 'Crew sign-on event received', {
        clientId,
        employeeId: payload?.employeeId,
        name: payload?.name
      });
      
      // Guard: Only KIOSK role can emit crew events
      if (!validateOrError(socket, role === ROLES.KIOSK, ERROR_CODES.CREW_EVENT_UNAUTHORIZED,
          'Unauthorized: Only KIOSK clients can emit crew sign-on events')) {
        logWarn('CrewEvent', 'Crew sign-on failed: Invalid role', { clientId, role });
        return;
      }

      // Guard: Kiosk must be registered
      if (!validateOrError(socket, kiosksState.getKiosk(clientId), ERROR_CODES.CLIENT_NOT_REGISTERED,
          'Kiosk not registered')) {
        logWarn('CrewEvent', 'Crew sign-on failed: Kiosk not registered', { clientId });
        return;
      }

      // Rate limiting
      const rateLimit = checkRateLimit(clientId, 'crew-sign-on');
      if (!rateLimit.allowed) {
        logWarn('CrewEvent', 'Crew sign-on rate limit exceeded', {
          clientId,
          current: rateLimit.current,
          limit: rateLimit.limit,
          resetAt: rateLimit.resetAt
        });
        emitError(socket, ERROR_CODES.RATE_LIMIT_EXCEEDED,
            `Rate limit exceeded: ${rateLimit.current}/${rateLimit.limit} sign-ons per minute`,
            { resetAt: rateLimit.resetAt.toISOString() });
        return;
      }

      // Validate payload
      const validation = validateCrewEventPayload(payload);
      if (!validation.isValid) {
        logWarn('CrewEvent', 'Crew sign-on failed: Invalid payload', {
          clientId,
          errors: validation.errors
        });
        emitError(socket, ERROR_CODES.CREW_EVENT_INVALID_PAYLOAD,
            'Invalid payload', { errors: validation.errors });
        return;
      }

      // Ensure kioskId matches the authenticated client (security: override client-provided kioskId)
      const eventPayload = {
        ...payload,
        kioskId: clientId
      };

      // Broadcast to all MONITOR clients
      broadcastCrewSignOn(io, eventPayload);

      // Acknowledge receipt
      socket.emit('crew-sign-on-ack', {
        employeeId: payload.employeeId,
        timestamp: new Date().toISOString()
      });
      
      logInfo('CrewEvent', 'Crew sign-on acknowledged', {
        clientId,
        employeeId: payload.employeeId
      });
    });

    /**
     * Crew Sign-Off Event
     * Only KIOSK clients can emit crew sign-off events
     * Events are broadcast to all MONITOR clients
     */
    socket.on('crew-sign-off', (payload) => {
      logInfo('CrewEvent', 'Crew sign-off event received', {
        clientId,
        employeeId: payload?.employeeId,
        name: payload?.name
      });
      
      // Guard: Only KIOSK role can emit crew events
      if (!validateOrError(socket, role === ROLES.KIOSK, ERROR_CODES.CREW_EVENT_UNAUTHORIZED,
          'Unauthorized: Only KIOSK clients can emit crew sign-off events')) {
        logWarn('CrewEvent', 'Crew sign-off failed: Invalid role', { clientId, role });
        return;
      }

      // Guard: Kiosk must be registered
      if (!validateOrError(socket, kiosksState.getKiosk(clientId), ERROR_CODES.CLIENT_NOT_REGISTERED,
          'Kiosk not registered')) {
        logWarn('CrewEvent', 'Crew sign-off failed: Kiosk not registered', { clientId });
        return;
      }

      // Rate limiting
      const rateLimit = checkRateLimit(clientId, 'crew-sign-off');
      if (!rateLimit.allowed) {
        logWarn('CrewEvent', 'Crew sign-off rate limit exceeded', {
          clientId,
          current: rateLimit.current,
          limit: rateLimit.limit,
          resetAt: rateLimit.resetAt
        });
        emitError(socket, ERROR_CODES.RATE_LIMIT_EXCEEDED,
            `Rate limit exceeded: ${rateLimit.current}/${rateLimit.limit} sign-offs per minute`,
            { resetAt: rateLimit.resetAt.toISOString() });
        return;
      }

      // Validate payload
      const validation = validateCrewEventPayload(payload);
      if (!validation.isValid) {
        logWarn('CrewEvent', 'Crew sign-off failed: Invalid payload', {
          clientId,
          errors: validation.errors
        });
        emitError(socket, ERROR_CODES.CREW_EVENT_INVALID_PAYLOAD,
            'Invalid payload', { errors: validation.errors });
        return;
      }

      // Ensure kioskId matches the authenticated client (security: override client-provided kioskId)
      const eventPayload = {
        ...payload,
        kioskId: clientId
      };

      // Broadcast to all MONITOR clients
      broadcastCrewSignOff(io, eventPayload);

      // Acknowledge receipt
      socket.emit('crew-sign-off-ack', {
        employeeId: payload.employeeId,
        timestamp: new Date().toISOString()
      });
      
      logInfo('CrewEvent', 'Crew sign-off acknowledged', {
        clientId,
        employeeId: payload.employeeId
      });
    });

    /**
     * Handle client disconnect
     * 
     * Clean disconnect handling:
     * - Remove client from state
     * - End active sessions
     * - Notify relevant clients
     * - Release all references
     * - Clean up rate limits
     */
    socket.on('disconnect', (reason) => {
      logInfo('Socket', 'Client disconnected', {
        clientId,
        role,
        socketId: socket.id,
        reason
      });

      try {
        if (role === ROLES.KIOSK) {
          // Remove heartbeat tracking
          removeHeartbeat(clientId);
          logInfo('Socket', 'Heartbeat tracking removed', { clientId });

          // Mark kiosk as offline
          kiosksState.markOffline(clientId);

          // End any active sessions for this kiosk
          const endedSession = sessionsState.endSessionByKiosk(clientId);
          
          // Notify monitors of kiosk going offline
          io.to('monitors').emit('kiosk-offline', {
            kioskId: clientId,
            timestamp: new Date().toISOString(),
            reason: 'disconnect'
          });
          logInfo('Socket', 'Kiosk offline notification sent to monitors', { clientId });

          // Notify monitors of session end if session existed
          if (endedSession) {
            io.to('monitors').emit('session-ended', {
              kioskId: clientId,
              monitorId: endedSession.monitorId,
              reason: 'kiosk-disconnect',
              timestamp: new Date().toISOString()
            });
            logInfo('Socket', 'Session ended notification sent (kiosk disconnect)', {
              clientId,
              monitorId: endedSession.monitorId,
              kioskId: clientId
            });
          }

          // Remove kiosk from state
          kiosksState.removeKiosk(clientId);
          logInfo('Socket', 'Kiosk removed from state', { clientId });

        } else if (role === ROLES.MONITOR) {
          // End all active sessions owned by this monitor (one monitor can have multiple kiosk sessions)
          const endedSessions = sessionsState.endSessionByMonitorSocket(socket.id);
          for (const endedSession of endedSessions) {
            io.to('monitors').emit('session-ended', {
              kioskId: endedSession.kioskId,
              monitorId: clientId,
              reason: 'monitor-disconnect',
              timestamp: new Date().toISOString()
            });
            logInfo('Socket', 'Session ended notification sent (monitor disconnect)', {
              clientId,
              kioskId: endedSession.kioskId
            });
          }

          // Remove monitor from state
          monitorsState.removeMonitor(clientId);
          logInfo('Socket', 'Monitor removed from state', { clientId });
        }

        // Clean up rate limits
        resetAllRateLimits(clientId);
        logInfo('Socket', 'Rate limits reset', { clientId });

        logInfo('Socket', 'Disconnect cleanup completed', { clientId, role });
      } catch (error) {
        logError('Socket', 'Error during disconnect cleanup', {
          clientId,
          role,
          error: error.message,
          stack: error.stack
        });
      }
    });

    /**
     * Handle socket errors
     * Never crash the server
     */
    socket.on('error', (error) => {
      logError('Socket', 'Socket error occurred', {
        clientId,
        role,
        socketId: socket.id,
        error: error.message,
        stack: error.stack
      });
      // Log but don't crash - defensive coding
    });
  });
};
