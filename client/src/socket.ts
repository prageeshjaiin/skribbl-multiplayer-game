import { io, Socket } from 'socket.io-client';

// Use environment variable if provided, otherwise default to same-origin in production or localhost:3001 in dev
const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ||
  (import.meta.env.DEV ? 'http://localhost:3001' : undefined);

export const socket: Socket = io(SERVER_URL, {
  autoConnect: true,
  transports: ['websocket', 'polling'],
});
