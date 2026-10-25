import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { RoomManager } from './managers/RoomManager.js';
import { registerRoomHandlers } from './handlers/roomHandler.js';
import { registerDrawHandlers } from './handlers/drawHandler.js';
import { registerChatHandlers } from './handlers/chatHandler.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * Build explicit allowed origins list from environment variables with safe dev defaults.
 */
function getAllowedOrigins(): string[] {
  const envOrigins = [
    ...(process.env.CLIENT_URL || '').split(','),
    ...(process.env.ALLOWED_ORIGINS || '').split(','),
    ...(process.env.RENDER_EXTERNAL_URL ? [process.env.RENDER_EXTERNAL_URL] : []),
  ]
    .map((o) => o.trim())
    .filter(Boolean);

  if (IS_PROD) {
    if (envOrigins.length === 0) {
      console.warn(
        '[Security Warning] Running in production without configured CLIENT_URL or ALLOWED_ORIGINS! Please configure allowed origins.'
      );
    }
    return Array.from(new Set(envOrigins));
  }

  const defaultDevOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ];

  return Array.from(new Set([...defaultDevOrigins, ...envOrigins]));
}

const allowedOrigins = getAllowedOrigins();

function isOriginAllowed(origin: string | undefined): boolean {
  // Allow requests without Origin header (e.g. server-to-server health checks, curl, local tools)
  if (!origin) return true;
  return allowedOrigins.includes(origin);
}

// Express CORS Middleware
app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    credentials: false,
  })
);
app.use(express.json());

// In-memory room manager instance
const roomManager = new RoomManager();

// Health check endpoint (reports operational health without leaking credentials)
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    environment: IS_PROD ? 'production' : 'development',
    uptime: Math.floor(process.uptime()),
    activeRooms: roomManager.getActiveRoomCount(),
    timestamp: new Date().toISOString(),
  });
});

// Optional static file serving for unified full-stack deployments (e.g. Render / Railway single-dyno)
function getClientDistPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'client/dist'),
    path.resolve(process.cwd(), '../client/dist'),
    path.resolve(process.cwd(), '../../client/dist'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const clientDistPath = getClientDistPath();
if (IS_PROD && clientDistPath) {
  console.log(`[Server] Serving production static client build from: ${clientDistPath}`);
  app.use(express.static(clientDistPath));
}

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO with strict CORS and handshake origin validation
const io = new SocketIOServer(server, {
  cors: {
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    methods: ['GET', 'POST'],
    credentials: false,
  },
  allowRequest: (req, callback) => {
    const origin = req.headers.origin;
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      console.warn(`[Socket.IO] Blocked connection attempt from unapproved origin: ${origin}`);
      callback('Origin not allowed', false);
    }
  },
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`[Socket.IO] Client connected: ${socket.id}`);

  // Register Phase 2 Room and Lobby handlers
  registerRoomHandlers(io, socket, roomManager);

  // Register Phase 3 Drawing handlers
  registerDrawHandlers(io, socket, roomManager);

  // Register Phase 5 Chat and Guessing handlers
  registerChatHandlers(io, socket, roomManager);

  // Disconnection logging
  socket.on('disconnect', (reason) => {
    console.log(`[Socket.IO] Client disconnected: ${socket.id} (Reason: ${reason})`);
  });
});

// SPA wildcard fallback for static client routing in unified mode
if (IS_PROD && clientDistPath) {
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/health') || req.path.startsWith('/socket.io')) {
      return next();
    }
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// Start the server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(
    `Accepting connections from allowed origins: ${allowedOrigins.length > 0 ? allowedOrigins.join(', ') : '(None configured)'}`
  );
});

// Graceful process shutdown handling
const handleShutdown = (signal: string) => {
  console.log(`[Server] Received ${signal}. Closing server gracefully...`);
  server.close(() => {
    console.log('[Server] HTTP and Socket.IO server closed.');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('[Server] Forcefully shutting down after timeout.');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
