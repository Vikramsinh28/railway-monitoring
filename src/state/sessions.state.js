/**
 * Session State Management
 * 
 * Centralized state management for monitoring sessions.
 * A session represents an active monitoring relationship between
 * a MONITOR client and a KIOSK client.
 * 
 * Architecture: Redis-ready (currently in-memory)
 * - Functions only, no direct mutation
 * - Encapsulates all data access
 * - Ready for Redis adapter in future
 * 
 * Session Rules:
 * - Only one MONITOR per KIOSK at a time
 * - Backend is the single authority for session state
 * - Sessions track activity for timeout detection
 */

// In-memory storage: Map<kioskId, sessionData>
const sessions = new Map();

// Session timeout configuration (in milliseconds)
let SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes default

/**
 * Create a new monitoring session
 * 
 * @param {string} kioskId - Kiosk identifier being monitored
 * @param {string} monitorId - Monitor identifier
 * @param {string} monitorSocketId - Monitor's socket ID
 * @returns {Object} Created session data
 * @throws {Error} If session already exists for this kiosk
 */
export const createSession = (kioskId, monitorId, monitorSocketId) => {
  if (!kioskId || !monitorId || !monitorSocketId) {
    throw new Error('kioskId, monitorId, and monitorSocketId are required');
  }

  // Check if session already exists for this kiosk
  if (sessions.has(kioskId)) {
    throw new Error(`Session already exists for kiosk: ${kioskId}`);
  }

  const sessionData = {
    kioskId,
    monitorId,
    monitorSocketId,
    startedAt: new Date(),
    lastActivityAt: new Date(),
    status: 'active'
  };

  sessions.set(kioskId, sessionData);
  
  console.log(`[State] Session created: ${monitorId} monitoring ${kioskId}`);
  
  return { ...sessionData };
};

/**
 * End a monitoring session
 * 
 * @param {string} kioskId - Kiosk identifier
 * @returns {Object|null} Ended session data or null if not found
 */
export const endSession = (kioskId) => {
  if (!kioskId) {
    return null;
  }

  const session = sessions.get(kioskId);
  if (!session) {
    return null;
  }

  const endedSession = {
    ...session,
    endedAt: new Date(),
    status: 'ended'
  };

  sessions.delete(kioskId);
  
  console.log(`[State] Session ended: ${endedSession.monitorId} -> ${kioskId}`);
  
  return endedSession;
};

/**
 * End session by monitor socket ID
 * Used when monitor disconnects
 * 
 * @param {string} monitorSocketId - Monitor's socket ID
 * @returns {Object|null} Ended session data or null if not found
 */
export const endSessionByMonitorSocket = (monitorSocketId) => {
  if (!monitorSocketId) {
    return null;
  }

  for (const [kioskId, session] of sessions.entries()) {
    if (session.monitorSocketId === monitorSocketId) {
      return endSession(kioskId);
    }
  }

  return null;
};

/**
 * End all sessions for a kiosk
 * Used when kiosk disconnects
 * 
 * @param {string} kioskId - Kiosk identifier
 * @returns {Object|null} Ended session data or null if not found
 */
export const endSessionByKiosk = (kioskId) => {
  return endSession(kioskId);
};

/**
 * Get session for a kiosk
 * 
 * @param {string} kioskId - Kiosk identifier
 * @returns {Object|null} Session data or null if not found
 */
export const getSession = (kioskId) => {
  if (!kioskId) {
    return null;
  }

  const session = sessions.get(kioskId);
  return session ? { ...session } : null;
};

/**
 * Get session by monitor socket ID
 * 
 * @param {string} monitorSocketId - Monitor's socket ID
 * @returns {Object|null} Session data or null if not found
 */
export const getSessionByMonitorSocket = (monitorSocketId) => {
  if (!monitorSocketId) {
    return null;
  }

  for (const session of sessions.values()) {
    if (session.monitorSocketId === monitorSocketId) {
      return { ...session };
    }
  }

  return null;
};

/**
 * Update session activity timestamp
 * 
 * @param {string} kioskId - Kiosk identifier
 * @returns {boolean} True if updated, false if session not found
 */
export const updateSessionActivity = (kioskId) => {
  if (!kioskId) {
    return false;
  }

  const session = sessions.get(kioskId);
  if (!session) {
    return false;
  }

  session.lastActivityAt = new Date();
  return true;
};

/**
 * Check if session exists and is active
 * 
 * @param {string} kioskId - Kiosk identifier
 * @returns {boolean} True if active session exists
 */
export const hasActiveSession = (kioskId) => {
  if (!kioskId) {
    return false;
  }

  const session = sessions.get(kioskId);
  return session && session.status === 'active';
};

/**
 * Validate that a monitor owns the session for a kiosk
 * 
 * @param {string} kioskId - Kiosk identifier
 * @param {string} monitorSocketId - Monitor's socket ID
 * @returns {boolean} True if monitor owns the session
 */
export const validateSessionOwnership = (kioskId, monitorSocketId) => {
  if (!kioskId || !monitorSocketId) {
    return false;
  }

  const session = sessions.get(kioskId);
  if (!session || session.status !== 'active') {
    return false;
  }

  return session.monitorSocketId === monitorSocketId;
};

/**
 * Get all active sessions
 * 
 * @returns {Array} Array of active session data objects
 */
export const getAllActiveSessions = () => {
  return Array.from(sessions.values())
    .filter(session => session.status === 'active')
    .map(session => ({ ...session }));
};

/**
 * Check for timed-out sessions
 * 
 * @param {number} timeoutMs - Timeout threshold in milliseconds
 * @returns {Array} Array of timed-out session data objects
 */
export const getTimedOutSessions = (timeoutMs = SESSION_TIMEOUT_MS) => {
  const now = Date.now();
  const timedOut = [];

  for (const [kioskId, session] of sessions.entries()) {
    if (session.status !== 'active') {
      continue;
    }

    const inactivityMs = now - session.lastActivityAt.getTime();
    if (inactivityMs > timeoutMs) {
      timedOut.push({ ...session, kioskId });
    }
  }

  return timedOut;
};

/**
 * Set session timeout configuration
 * 
 * @param {number} timeoutMs - Timeout in milliseconds
 */
export const setSessionTimeout = (timeoutMs) => {
  if (timeoutMs > 0) {
    SESSION_TIMEOUT_MS = timeoutMs;
  }
};
