/**
 * Kiosk State Management
 * 
 * Centralized state management for KIOSK clients.
 * All kiosk data access goes through this module.
 * 
 * Architecture: Redis-ready (currently in-memory)
 * - Functions only, no direct mutation
 * - Encapsulates all data access
 * - Ready for Redis adapter in future
 */

// In-memory storage: Map<kioskId, kioskData>
const kiosks = new Map();

/**
 * Register a kiosk
 * 
 * @param {string} kioskId - Unique kiosk identifier
 * @param {string} socketId - Socket.IO socket ID
 * @returns {Object} Registered kiosk data
 */
export const registerKiosk = (kioskId, socketId) => {
  if (!kioskId || !socketId) {
    throw new Error('kioskId and socketId are required');
  }

  const kioskData = {
    kioskId,
    socketId,
    registeredAt: new Date(),
    lastSeenAt: new Date(),
    status: 'online'
  };

  kiosks.set(kioskId, kioskData);
  
  console.log(`[State] Kiosk registered: ${kioskId} (socket: ${socketId})`);
  
  return { ...kioskData };
};

/**
 * Remove a kiosk
 * 
 * @param {string} kioskId - Kiosk identifier to remove
 * @returns {boolean} True if kiosk was removed, false if not found
 */
export const removeKiosk = (kioskId) => {
  if (!kioskId) {
    return false;
  }

  const existed = kiosks.delete(kioskId);
  
  if (existed) {
    console.log(`[State] Kiosk removed: ${kioskId}`);
  }
  
  return existed;
};

/**
 * Get kiosk by ID
 * 
 * @param {string} kioskId - Kiosk identifier
 * @returns {Object|null} Kiosk data or null if not found
 */
export const getKiosk = (kioskId) => {
  if (!kioskId) {
    return null;
  }

  const kiosk = kiosks.get(kioskId);
  return kiosk ? { ...kiosk } : null;
};

/**
 * Get kiosk by socket ID
 * 
 * @param {string} socketId - Socket.IO socket ID
 * @returns {Object|null} Kiosk data or null if not found
 */
export const getKioskBySocketId = (socketId) => {
  if (!socketId) {
    return null;
  }

  for (const kiosk of kiosks.values()) {
    if (kiosk.socketId === socketId) {
      return { ...kiosk };
    }
  }

  return null;
};

/**
 * Get all online kiosks
 * 
 * @returns {Array} Array of kiosk data objects
 */
export const getAllKiosks = () => {
  return Array.from(kiosks.values()).map(kiosk => ({ ...kiosk }));
};

/**
 * Update kiosk last seen timestamp
 * 
 * @param {string} kioskId - Kiosk identifier
 * @returns {boolean} True if updated, false if kiosk not found
 */
export const updateLastSeen = (kioskId) => {
  if (!kioskId) {
    return false;
  }

  const kiosk = kiosks.get(kioskId);
  if (!kiosk) {
    return false;
  }

  kiosk.lastSeenAt = new Date();
  kiosk.status = 'online';
  
  return true;
};

/**
 * Mark kiosk as offline
 * 
 * @param {string} kioskId - Kiosk identifier
 * @returns {boolean} True if marked offline, false if kiosk not found
 */
export const markOffline = (kioskId) => {
  if (!kioskId) {
    return false;
  }

  const kiosk = kiosks.get(kioskId);
  if (!kiosk) {
    return false;
  }

  kiosk.status = 'offline';
  kiosk.lastSeenAt = new Date();
  
  console.log(`[State] Kiosk marked offline: ${kioskId}`);
  
  return true;
};

/**
 * Check if kiosk exists and is online
 * 
 * @param {string} kioskId - Kiosk identifier
 * @returns {boolean} True if kiosk exists and is online
 */
export const isKioskOnline = (kioskId) => {
  if (!kioskId) {
    return false;
  }

  const kiosk = kiosks.get(kioskId);
  return kiosk && kiosk.status === 'online';
};

/**
 * Get count of online kiosks
 * 
 * @returns {number} Number of online kiosks
 */
export const getOnlineKioskCount = () => {
  return Array.from(kiosks.values()).filter(k => k.status === 'online').length;
};
