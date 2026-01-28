#!/usr/bin/env node

/**
 * Token Generation Script
 * 
 * Helper script to generate JWT tokens for testing/demo purposes.
 * 
 * Usage:
 *   node scripts/generate-token.js <clientId> <role>
 * 
 * Example:
 *   node scripts/generate-token.js KIOSK_01 KIOSK
 *   node scripts/generate-token.js MONITOR_01 MONITOR
 */

import { generateToken } from '../src/auth/auth.middleware.js';

const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage: node scripts/generate-token.js <clientId> <role>');
  console.error('Example: node scripts/generate-token.js KIOSK_01 KIOSK');
  process.exit(1);
}

const [clientId, role] = args;

if (role !== 'KIOSK' && role !== 'MONITOR') {
  console.error('Error: Role must be either KIOSK or MONITOR');
  process.exit(1);
}

try {
  const token = generateToken(clientId, role);
  
  console.log('\n✅ Token generated successfully!\n');
  console.log('Client ID:', clientId);
  console.log('Role:', role);
  console.log('\nToken:');
  console.log(token);
  console.log('\nUse this token in your Socket.IO client:\n');
  console.log(`const socket = io('http://localhost:3000', {`);
  console.log(`  auth: { token: '${token}' }`);
  console.log(`});\n`);
} catch (error) {
  console.error('Error generating token:', error.message);
  process.exit(1);
}
