/**
 * Crew Event Broadcasting System
 * 
 * This module handles crew sign-on and sign-off events.
 * Events are broadcast to all connected MONITOR clients.
 * 
 * Architecture Note: This backend does NOT process video streams.
 * It only handles event broadcasting and WebRTC signaling.
 */

/**
 * Broadcast crew sign-on event to all MONITOR clients
 * 
 * @param {Object} io - Socket.IO server instance
 * @param {Object} payload - Event payload
 * @param {string} payload.employeeId - Employee identifier
 * @param {string} payload.name - Employee name
 * @param {string} payload.timestamp - ISO timestamp
 * @param {string} payload.kioskId - Kiosk identifier that generated the event
 */
export const broadcastCrewSignOn = (io, payload) => {
  const eventData = {
    employeeId: payload.employeeId,
    name: payload.name,
    timestamp: payload.timestamp || new Date().toISOString(),
    kioskId: payload.kioskId,
    eventType: 'crew-sign-on'
  };

  // Broadcast only to MONITOR clients
  io.to('monitors').emit('crew-sign-on', eventData);
  
  console.log(`[Crew Event] Sign-on: ${payload.name} (${payload.employeeId}) from ${payload.kioskId}`);
};

/**
 * Broadcast crew sign-off event to all MONITOR clients
 * 
 * @param {Object} io - Socket.IO server instance
 * @param {Object} payload - Event payload
 * @param {string} payload.employeeId - Employee identifier
 * @param {string} payload.name - Employee name
 * @param {string} payload.timestamp - ISO timestamp
 * @param {string} payload.kioskId - Kiosk identifier that generated the event
 */
export const broadcastCrewSignOff = (io, payload) => {
  const eventData = {
    employeeId: payload.employeeId,
    name: payload.name,
    timestamp: payload.timestamp || new Date().toISOString(),
    kioskId: payload.kioskId,
    eventType: 'crew-sign-off'
  };

  // Broadcast only to MONITOR clients
  io.to('monitors').emit('crew-sign-off', eventData);
  
  console.log(`[Crew Event] Sign-off: ${payload.name} (${payload.employeeId}) from ${payload.kioskId}`);
};

/**
 * Validate crew event payload
 * 
 * @param {Object} payload - Event payload to validate
 * @returns {Object} Validation result with isValid and errors
 */
export const validateCrewEventPayload = (payload) => {
  const errors = [];

  if (!payload.employeeId || typeof payload.employeeId !== 'string') {
    errors.push('employeeId is required and must be a string');
  }

  if (!payload.name || typeof payload.name !== 'string') {
    errors.push('name is required and must be a string');
  }

  if (!payload.kioskId || typeof payload.kioskId !== 'string') {
    errors.push('kioskId is required and must be a string');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};
