import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { authenticateSocket } from './auth/auth.middleware.js';
import { initializeSocket } from './socket/index.js';

const app = express();
const server = createServer(app);

// Configure CORS for Express
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));

app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'kiosk-monitor-signaling-server'
  });
});

/**
 * Socket.IO Configuration
 * 
 * Architecture Note: This backend is VIEW-ONLY and does NOT process
 * video streams. It only handles:
 * - WebRTC signaling (offer, answer, ice-candidate forwarding)
 * - Crew event broadcasting (sign-on/sign-off)
 * 
 * All video data flows directly between clients via WebRTC peer connections.
 * This server never touches video streams.
 */
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  // Use authentication middleware for all connections
  // This ensures only authenticated clients can connect
  allowEIO3: true
});

// Apply authentication middleware to Socket.IO
io.use(authenticateSocket);

// Initialize socket event handlers
initializeSocket(io);

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║   KIOSK-MONITOR Signaling Server (Hardened)               ║
║   Port: ${PORT}                                                  ║
║                                                           ║
║   Architecture: VIEW-ONLY                                 ║
║   • WebRTC signaling only                                ║
║   • Crew event broadcasting                              ║
║   • NO video stream processing                           ║
║                                                           ║
║   Security Features:                                      ║
║   • Session ownership validation                         ║
║   • Explicit session lifecycle                           ║
║   • Standardized error handling                          ║
║   • Heartbeat / keep-alive                               ║
║   • Rate limiting                                        ║
║   • Clean disconnect handling                            ║
╚═══════════════════════════════════════════════════════════╝
  `);
  console.log(`[Server] Listening on port ${PORT}`);
  console.log(`[Server] Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('[Server] Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[Server] SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('[Server] Server closed');
    process.exit(0);
  });
});
