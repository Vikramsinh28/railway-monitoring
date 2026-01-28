import { ERROR_CODES } from './error.codes.js';

/**
 * Standardized Socket Error Handler
 * 
 * Provides structured error responses for Socket.IO events.
 * All errors follow a consistent format and never crash the server.
 */

/**
 * Create a structured error response
 * 
 * @param {string} code - Error code from ERROR_CODES
 * @param {string} message - Human-readable error message
 * @param {Object} details - Optional additional error details
 * @returns {Object} Structured error object
 */
export const createError = (code, message, details = {}) => {
  return {
    code,
    message,
    timestamp: new Date().toISOString(),
    ...details
  };
};

/**
 * Emit error to socket and log it
 * 
 * @param {Object} socket - Socket.IO socket instance
 * @param {string} code - Error code from ERROR_CODES
 * @param {string} message - Human-readable error message
 * @param {Object} details - Optional additional error details
 */
export const emitError = (socket, code, message, details = {}) => {
  const error = createError(code, message, details);
  
  // Log error for debugging (in production, use structured logging)
  console.error(`[Error] ${code}: ${message}`, details);
  
  // Emit error to client
  socket.emit('error', error);
  
  return error;
};

/**
 * Validate and emit error if validation fails
 * 
 * @param {Object} socket - Socket.IO socket instance
 * @param {boolean} isValid - Whether validation passed
 * @param {string} code - Error code if validation fails
 * @param {string} message - Error message if validation fails
 * @returns {boolean} True if valid, false if error was emitted
 */
export const validateOrError = (socket, isValid, code, message, details = {}) => {
  if (!isValid) {
    emitError(socket, code, message, details);
    return false;
  }
  return true;
};

export { ERROR_CODES };
