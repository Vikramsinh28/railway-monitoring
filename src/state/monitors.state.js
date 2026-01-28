/**
 * Monitor State Management
 * 
 * Centralized state management for MONITOR clients.
 * All monitor data access goes through this module.
 * 
 * Architecture: Redis-ready (currently in-memory)
 * - Functions only, no direct mutation
 * - Encapsulates all data access
 * - Ready for Redis adapter in future
 */

// In-memory storage: Map<monitorId, monitorData>
const monitors = new Map();

/**
 * Register a monitor
 * 
 * @param {string} monitorId - Unique monitor identifier
 * @param {string} socketId - Socket.IO socket ID
 * @returns {Object} Registered monitor data
 */
export const registerMonitor = (monitorId, socketId) => {
  if (!monitorId || !socketId) {
    throw new Error('monitorId and socketId are required');
  }

  const monitorData = {
    monitorId,
    socketId,
    registeredAt: new Date(),
    lastSeenAt: new Date(),
    status: 'online'
  };

  monitors.set(monitorId, monitorData);
  
  console.log(`[State] Monitor registered: ${monitorId} (socket: ${socketId})`);
  
  return { ...monitorData };
};

/**
 * Remove a monitor
 * 
 * @param {string} monitorId - Monitor identifier to remove
 * @returns {boolean} True if monitor was removed, false if not found
 */
export const removeMonitor = (monitorId) => {
  if (!monitorId) {
    return false;
  }

  const existed = monitors.delete(monitorId);
  
  if (existed) {
    console.log(`[State] Monitor removed: ${monitorId}`);
  }
  
  return existed;
};

/**
 * Get monitor by ID
 * 
 * @param {string} monitorId - Monitor identifier
 * @returns {Object|null} Monitor data or null if not found
 */
export const getMonitor = (monitorId) => {
  if (!monitorId) {
    return null;
  }

  const monitor = monitors.get(monitorId);
  return monitor ? { ...monitor } : null;
};

/**
 * Get monitor by socket ID
 * 
 * @param {string} socketId - Socket.IO socket ID
 * @returns {Object|null} Monitor data or null if not found
 */
export const getMonitorBySocketId = (socketId) => {
  if (!socketId) {
    return null;
  }

  for (const monitor of monitors.values()) {
    if (monitor.socketId === socketId) {
      return { ...monitor };
    }
  }

  return null;
};

/**
 * Get all online monitors
 * 
 * @returns {Array} Array of monitor data objects
 */
export const getAllMonitors = () => {
  return Array.from(monitors.values()).map(monitor => ({ ...monitor }));
};

/**
 * Update monitor last seen timestamp
 * 
 * @param {string} monitorId - Monitor identifier
 * @returns {boolean} True if updated, false if monitor not found
 */
export const updateLastSeen = (monitorId) => {
  if (!monitorId) {
    return false;
  }

  const monitor = monitors.get(monitorId);
  if (!monitor) {
    return false;
  }

  monitor.lastSeenAt = new Date();
  monitor.status = 'online';
  
  return true;
};

/**
 * Mark monitor as offline
 * 
 * @param {string} monitorId - Monitor identifier
 * @returns {boolean} True if marked offline, false if monitor not found
 */
export const markOffline = (monitorId) => {
  if (!monitorId) {
    return false;
  }

  const monitor = monitors.get(monitorId);
  if (!monitor) {
    return false;
  }

  monitor.status = 'offline';
  monitor.lastSeenAt = new Date();
  
  console.log(`[State] Monitor marked offline: ${monitorId}`);
  
  return true;
};

/**
 * Check if monitor exists and is online
 * 
 * @param {string} monitorId - Monitor identifier
 * @returns {boolean} True if monitor exists and is online
 */
export const isMonitorOnline = (monitorId) => {
  if (!monitorId) {
    return false;
  }

  const monitor = monitors.get(monitorId);
  return monitor && monitor.status === 'online';
};
