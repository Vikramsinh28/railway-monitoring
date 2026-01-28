/**
 * Rate Limiter
 * 
 * In-memory rate limiting for critical events.
 * Prevents abuse and ensures predictable behavior.
 * 
 * Architecture: Redis-ready (currently in-memory)
 * - Per-client rate limiting
 * - Sliding window approach
 * - Ready for Redis adapter in future
 */

// Rate limit storage: Map<clientId, Array<timestamps>>
const rateLimitStore = new Map();

// Default rate limits (events per minute)
const DEFAULT_LIMITS = {
  'crew-sign-on': 10,      // 10 sign-ons per minute per kiosk
  'crew-sign-off': 10,     // 10 sign-offs per minute per kiosk
  'offer': 30,             // 30 offers per minute per client
  'answer': 30,            // 30 answers per minute per client
  'ice-candidate': 60      // 60 ICE candidates per minute per client
};

/**
 * Clean up old entries from rate limit store
 * Removes entries older than 1 minute
 * 
 * @param {string} clientId - Client identifier
 * @param {string} eventType - Event type
 */
const cleanupOldEntries = (clientId, eventType) => {
  const key = `${clientId}:${eventType}`;
  const entries = rateLimitStore.get(key);
  
  if (!entries) {
    return;
  }

  const oneMinuteAgo = Date.now() - 60000;
  const filtered = entries.filter(timestamp => timestamp > oneMinuteAgo);
  
  if (filtered.length === 0) {
    rateLimitStore.delete(key);
  } else {
    rateLimitStore.set(key, filtered);
  }
};

/**
 * Check if rate limit is exceeded
 * 
 * @param {string} clientId - Client identifier
 * @param {string} eventType - Event type (e.g., 'crew-sign-on')
 * @param {number} limit - Maximum events per minute (optional, uses default if not provided)
 * @returns {Object} { allowed: boolean, remaining: number, resetAt: Date }
 */
export const checkRateLimit = (clientId, eventType, limit = null) => {
  if (!clientId || !eventType) {
    return { allowed: false, remaining: 0, resetAt: null };
  }

  // Get limit for event type
  const eventLimit = limit !== null ? limit : (DEFAULT_LIMITS[eventType] || 60);
  
  const key = `${clientId}:${eventType}`;
  const now = Date.now();
  const oneMinuteAgo = now - 60000;

  // Clean up old entries
  cleanupOldEntries(clientId, eventType);

  // Get current entries
  const entries = rateLimitStore.get(key) || [];
  const recentEntries = entries.filter(timestamp => timestamp > oneMinuteAgo);

  // Check if limit exceeded
  const allowed = recentEntries.length < eventLimit;
  const remaining = Math.max(0, eventLimit - recentEntries.length);
  const resetAt = recentEntries.length > 0 
    ? new Date(recentEntries[0] + 60000) 
    : new Date(now + 60000);

  // If allowed, add current timestamp
  if (allowed) {
    recentEntries.push(now);
    rateLimitStore.set(key, recentEntries);
  }

  return {
    allowed,
    remaining,
    resetAt,
    current: recentEntries.length,
    limit: eventLimit
  };
};

/**
 * Reset rate limit for a client and event type
 * 
 * @param {string} clientId - Client identifier
 * @param {string} eventType - Event type
 */
export const resetRateLimit = (clientId, eventType) => {
  if (!clientId || !eventType) {
    return;
  }

  const key = `${clientId}:${eventType}`;
  rateLimitStore.delete(key);
};

/**
 * Reset all rate limits for a client
 * Used when client disconnects
 * 
 * @param {string} clientId - Client identifier
 */
export const resetAllRateLimits = (clientId) => {
  if (!clientId) {
    return;
  }

  const keysToDelete = [];
  for (const key of rateLimitStore.keys()) {
    if (key.startsWith(`${clientId}:`)) {
      keysToDelete.push(key);
    }
  }

  keysToDelete.forEach(key => rateLimitStore.delete(key));
};

/**
 * Set custom rate limit for an event type
 * 
 * @param {string} eventType - Event type
 * @param {number} limit - Maximum events per minute
 */
export const setRateLimit = (eventType, limit) => {
  if (eventType && limit > 0) {
    DEFAULT_LIMITS[eventType] = limit;
  }
};

/**
 * Get current rate limit for an event type
 * 
 * @param {string} eventType - Event type
 * @returns {number} Rate limit (events per minute)
 */
export const getRateLimit = (eventType) => {
  return DEFAULT_LIMITS[eventType] || 60;
};
