import { Server as SocketIOServer, Socket } from 'socket.io';
import { RoomManager } from '../managers/RoomManager.js';
import { RateLimiter } from '../utils/RateLimiter.js';
import {
  Player,
  RoomSettings,
  ApiResponse,
  RoomJoinData,
  ResumeRoomPayload,
  ResumeRoomData,
} from '../types/index.js';

// Server-side rate limiter for room creations: max 5 rooms per 60 seconds per IP/socket
const roomCreationLimiter = new RateLimiter(5, 60000);

export function registerRoomHandlers(
  io: SocketIOServer,
  socket: Socket,
  roomManager: RoomManager
): void {
  /**
   * Helper to format an InternalPlayer into a sanitized public Player object
   */
  const toPublicPlayer = (p: { id: string; name: string; isHost: boolean; score: number; isConnected: boolean }): Player => ({
    id: p.id,
    name: p.name,
    isHost: p.isHost,
    score: p.score,
    isConnected: p.isConnected,
  });

  /**
   * Event: create_room
   * Host creates a room with their name and optional custom settings.
   */
  socket.on(
    'create_room',
    (
      payload: { playerName: string; settings?: Partial<RoomSettings> },
      callback?: (response: ApiResponse<RoomJoinData>) => void
    ) => {
      try {
        // Enforce rate limiting: max 5 rooms per 60 seconds per client IP/socket
        const clientIdentifier = socket.handshake.address || socket.id;
        if (!roomCreationLimiter.check(clientIdentifier)) {
          if (callback) {
            callback({
              success: false,
              error: 'Too many rooms created. Please wait a moment before creating a new room.',
            });
          }
          return;
        }

        // Sanitize player name: strip control characters and clamp length to 18
        const sanitizedRaw = String(payload?.playerName || '')
          .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
          .trim();
        const trimmedName = sanitizedRaw.slice(0, 18) || 'Host';

        const { room, player } = roomManager.createRoom(trimmedName, socket.id, payload?.settings);
        socket.join(room.code);

        console.log(`[Room] Created room ${room.code} by "${player.name}" (${player.id}, socket: ${socket.id}). Active rooms: ${roomManager.getActiveRoomCount()}`);

        if (callback) {
          callback({
            success: true,
            data: {
              room: room.getState(),
              player: toPublicPlayer(player),
              reconnectToken: player.reconnectToken,
            },
          });
        }
      } catch (err: any) {
        console.error('[Room] create_room error:', err);
        if (callback) {
          callback({ success: false, error: 'Failed to create room.' });
        }
      }
    }
  );

  /**
   * Event: join_room
   * Player joins an existing room using a 6-character room code.
   */
  socket.on(
    'join_room',
    (
      payload: { roomId: string; playerName: string },
      callback?: (response: ApiResponse<RoomJoinData>) => void
    ) => {
      try {
        if (!payload?.roomId || typeof payload.roomId !== 'string') {
          if (callback) callback({ success: false, error: 'Room code is required.' });
          return;
        }

        const cleanCode = payload.roomId.trim().toUpperCase();
        if (!/^[A-Z0-9]{6}$/.test(cleanCode)) {
          if (callback) callback({ success: false, error: 'Room code must be a 6-character alphanumeric code.' });
          return;
        }

        // Sanitize player name: strip control characters and clamp length to 18
        const sanitizedRaw = String(payload?.playerName || '')
          .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
          .trim();
        const trimmedName = sanitizedRaw.slice(0, 18) || 'Player';

        const result = roomManager.joinRoom(cleanCode, trimmedName, socket.id);

        if (!result.success || !result.room || !result.player) {
          if (callback) callback({ success: false, error: result.error });
          return;
        }

        const room = result.room;
        const player = result.player;
        socket.join(room.code);

        console.log(`[Room] Player "${player.name}" (${player.id}, socket: ${socket.id}) joined room ${room.code} (${room.players.size}/${room.settings.maxPlayers})`);

        const publicPlayer = toPublicPlayer(player);

        // Notify other room members
        socket.to(room.code).emit('player_joined', {
          player: publicPlayer,
          players: room.getState().players,
        });

        // Broadcast synchronized room state
        io.to(room.code).emit('room_updated', room.getState());

        if (callback) {
          callback({
            success: true,
            data: {
              room: room.getState(),
              player: publicPlayer,
              reconnectToken: player.reconnectToken,
            },
          });
        }
      } catch (err: any) {
        console.error('[Room] join_room error:', err);
        if (callback) {
          callback({ success: false, error: 'Failed to join room.' });
        }
      }
    }
  );

  /**
   * Event: resume_room
   * Player refreshes or reconnects to an active room using their stable credentials.
   */
  socket.on(
    'resume_room',
    (
      payload: ResumeRoomPayload,
      callback?: (response: ApiResponse<ResumeRoomData>) => void
    ) => {
      try {
        if (
          !payload?.roomId ||
          !payload?.playerId ||
          !payload?.reconnectToken ||
          typeof payload.roomId !== 'string' ||
          typeof payload.playerId !== 'string' ||
          typeof payload.reconnectToken !== 'string'
        ) {
          if (callback) callback({ success: false, error: 'Missing or invalid credentials to resume room.' });
          return;
        }

        const cleanCode = payload.roomId.trim().toUpperCase();
        if (!/^[A-Z0-9]{6}$/.test(cleanCode)) {
          if (callback) callback({ success: false, error: 'Invalid room code format.' });
          return;
        }

        const result = roomManager.resumeRoom(
          cleanCode,
          payload.playerId.trim(),
          payload.reconnectToken.trim(),
          socket.id,
          io
        );

        if (!result.success || !result.room || !result.player) {
          if (callback) callback({ success: false, error: result.error || 'Unable to resume session.' });
          return;
        }

        const room = result.room;
        const player = result.player;

        // Join the socket to the Socket.IO room channel
        socket.join(room.code);

        console.log(`[Room] Resumed player "${player.name}" (${player.id}) with new socket ${socket.id} in room ${room.code}`);

        const publicPlayer = toPublicPlayer(player);

        // Notify other players
        socket.to(room.code).emit('player_reconnected', {
          playerId: player.id,
          playerName: player.name,
          players: room.getState().players,
        });

        // Broadcast updated room state to all
        io.to(room.code).emit('room_updated', room.getState());

        // Gather private drawer information if the resumed player is the active drawer
        let privateData: { wordChoices?: string[]; drawerWord?: string } | undefined = undefined;
        if (room.currentDrawerId === player.id) {
          if (room.phase === 'WORD_SELECTION' && room.currentWordChoices.length > 0) {
            privateData = { wordChoices: room.currentWordChoices };
          } else if (room.phase === 'DRAWING' && room.getSecretWord()) {
            privateData = { drawerWord: room.getSecretWord() || undefined };
          }
        }

        if (callback) {
          callback({
            success: true,
            data: {
              room: room.getState(),
              player: publicPlayer,
              reconnectToken: player.reconnectToken,
              privateData,
              strokes: room.getStrokes(),
              chatHistory: room.getChatHistory(),
            },
          });
        }
      } catch (err: any) {
        console.error('[Room] resume_room error:', err);
        if (callback) callback({ success: false, error: 'Failed to resume room session.' });
      }
    }
  );

  /**
   * Event: update_settings
   * Host updates room settings (max players, rounds, draw time, word choices, hints).
   */
  socket.on(
    'update_settings',
    (
      payload: { roomId: string; settings: Partial<RoomSettings> },
      callback?: (response: ApiResponse<RoomSettings>) => void
    ) => {
      try {
        const room = roomManager.getRoom(payload?.roomId);
        if (!room) {
          if (callback) callback({ success: false, error: 'Room not found.' });
          return;
        }

        if (!room.isAuthorizedHost(socket.id)) {
          if (callback) callback({ success: false, error: 'Only the host can modify room settings.' });
          return;
        }

        const result = room.updateSettings(payload.settings);
        if (!result.success) {
          if (callback) {
            callback({
              success: false,
              error: result.error,
              data: result.settings,
            });
          }
          return;
        }

        console.log(`[Room] Settings updated for room ${room.code}:`, result.settings);

        // Broadcast updated state to all players in the room
        io.to(room.code).emit('room_updated', room.getState());

        if (callback) {
          callback({
            success: true,
            data: result.settings,
          });
        }
      } catch (err: any) {
        console.error('[Room] update_settings error:', err);
        if (callback) {
          callback({ success: false, error: 'Failed to update settings.' });
        }
      }
    }
  );

  /**
   * Event: start_game
   * Host triggers start game with server-side validation.
   */
  socket.on(
    'start_game',
    (
      payload: { roomId: string },
      callback?: (response: ApiResponse<{ message: string }>) => void
    ) => {
      try {
        const room = roomManager.getRoom(payload?.roomId);
        if (!room) {
          if (callback) callback({ success: false, error: 'Room not found.' });
          return;
        }

        const validation = room.canStart(socket.id);
        if (!validation.canStart) {
          if (callback) callback({ success: false, error: validation.error });
          return;
        }

        console.log(`[Room] Host started game in room ${room.code}. Initiating Game Engine.`);

        // Notify all players in room
        io.to(room.code).emit('game_started', {
          startedBy: socket.id,
          message: 'The game has started!',
        });

        // Launch server-authoritative turn rotation
        room.startGame(io);

        if (callback) {
          callback({
            success: true,
            data: { message: 'Game successfully started.' },
          });
        }
      } catch (err: any) {
        console.error('[Room] start_game error:', err);
        if (callback) {
          callback({ success: false, error: 'Failed to start game.' });
        }
      }
    }
  );

  /**
   * Event: choose_word
   * Active drawer submits their chosen secret word.
   */
  socket.on(
    'choose_word',
    (
      payload: { roomId: string; word: string },
      callback?: (response: ApiResponse<null>) => void
    ) => {
      try {
        if (!payload?.roomId || !payload?.word) {
          if (callback) callback({ success: false, error: 'Room ID and word choice are required.' });
          return;
        }

        const room = roomManager.getRoom(payload.roomId);
        if (!room) {
          if (callback) callback({ success: false, error: 'Room not found.' });
          return;
        }

        if (!room.isCurrentDrawer(socket.id)) {
          if (callback) callback({ success: false, error: 'Only the active drawer can choose a word.' });
          return;
        }

        if (room.phase !== 'WORD_SELECTION') {
          if (callback) callback({ success: false, error: 'Word selection is not active.' });
          return;
        }

        const selected = room.selectWord(payload.word, io);
        if (!selected) {
          if (callback) callback({ success: false, error: 'Selected word is not among offered options.' });
          return;
        }

        if (callback) callback({ success: true });
      } catch (err: any) {
        console.error('[Room] choose_word error:', err);
        if (callback) callback({ success: false, error: 'Failed to choose word.' });
      }
    }
  );

  /**
   * Event: get_word_choices
   * Active drawer requests their choices upon mounting GamePage or on reconnection.
   */
  socket.on(
    'get_word_choices',
    (
      payload: { roomId: string },
      callback?: (response: ApiResponse<{ choices: string[]; selectionTime: number }>) => void
    ) => {
      try {
        if (!payload?.roomId) {
          if (callback) callback({ success: false, error: 'Room ID required' });
          return;
        }

        const room = roomManager.getRoom(payload.roomId);
        if (!room) {
          if (callback) callback({ success: false, error: 'Room not found' });
          return;
        }

        if (!room.isCurrentDrawer(socket.id)) {
          if (callback) callback({ success: false, error: 'Only the active drawer can view word choices' });
          return;
        }

        if (room.phase !== 'WORD_SELECTION') {
          if (callback) callback({ success: false, error: 'Word selection is not currently active' });
          return;
        }

        if (callback) {
          callback({
            success: true,
            data: {
              choices: room.currentWordChoices,
              selectionTime: 10,
            },
          });
        }
      } catch (err: any) {
        console.error('[Room] get_word_choices error:', err);
        if (callback) callback({ success: false, error: 'Failed to get word choices' });
      }
    }
  );

  /**
   * Event: get_drawer_word
   * Active drawer requests their secret word upon mounting GamePage during DRAWING.
   */
  socket.on(
    'get_drawer_word',
    (
      payload: { roomId: string },
      callback?: (response: ApiResponse<{ word: string }>) => void
    ) => {
      try {
        if (!payload?.roomId) {
          if (callback) callback({ success: false, error: 'Room ID required' });
          return;
        }

        const room = roomManager.getRoom(payload.roomId);
        if (!room) {
          if (callback) callback({ success: false, error: 'Room not found' });
          return;
        }

        if (!room.isCurrentDrawer(socket.id)) {
          if (callback) callback({ success: false, error: 'Only the active drawer can view the word' });
          return;
        }

        if (room.phase !== 'DRAWING') {
          if (callback) callback({ success: false, error: 'Drawing phase is not currently active' });
          return;
        }

        const word = room.getSecretWord();
        if (callback) {
          callback({
            success: true,
            data: { word: word || '' },
          });
        }
      } catch (err: any) {
        console.error('[Room] get_drawer_word error:', err);
        if (callback) callback({ success: false, error: 'Failed to get drawer word' });
      }
    }
  );

  /**
   * Event: return_to_lobby
   * Host resets game back to lobby after game over.
   */
  socket.on(
    'return_to_lobby',
    (
      payload: { roomId: string },
      callback?: (response: ApiResponse<null>) => void
    ) => {
      try {
        const room = roomManager.getRoom(payload?.roomId);
        if (!room) {
          if (callback) callback({ success: false, error: 'Room not found.' });
          return;
        }

        if (!room.isAuthorizedHost(socket.id)) {
          if (callback) callback({ success: false, error: 'Only the host can return the room to lobby.' });
          return;
        }

        room.returnToLobby(io);
        if (callback) callback({ success: true });
      } catch (err: any) {
        console.error('[Room] return_to_lobby error:', err);
        if (callback) callback({ success: false, error: 'Failed to return to lobby.' });
      }
    }
  );

  /**
   * Event: leave_room
   * Player manually clicks Leave Room. This is an immediate, permanent departure.
   */
  socket.on('leave_room', (_payload, callback?: (response: ApiResponse<null>) => void) => {
    try {
      const { room, player, roomDeleted } = roomManager.leaveRoom(socket.id, io);
      if (player) {
        socket.leave(room ? room.code : '');
        console.log(`[Room] Player "${player.name}" (${player.id}) voluntarily left.`);

        if (room && !roomDeleted) {
          const newHost = room.players.get(room.hostId);
          io.to(room.code).emit('player_left', {
            playerId: player.id,
            playerName: player.name,
            newHostId: newHost?.id,
            players: room.getState().players,
          });
          io.to(room.code).emit('room_updated', room.getState());
        }
      }

      if (callback) {
        callback({ success: true });
      }
    } catch (err: any) {
      console.error('[Room] leave_room error:', err);
      if (callback) callback({ success: false, error: 'Failed to leave room.' });
    }
  });

  /**
   * Event: disconnect
   * Socket dropped (e.g. browser refreshed or momentary connection loss).
   * Initiates the 15-second grace period before permanent removal.
   */
  socket.on('disconnect', () => {
    try {
      const { room, player } = roomManager.handleSocketDisconnect(socket.id, (expiredRoom, expiredPlayer) => {
        // Grace period expired callback!
        console.log(`[Room ${expiredRoom.code}] 15-second grace period expired for player "${expiredPlayer.name}" (${expiredPlayer.id}). Removing permanently.`);
        
        const removed = expiredRoom.removePlayerPermanently(expiredPlayer.id, io);
        if (!removed) return;

        if (expiredRoom.isEmpty()) {
          roomManager.deleteRoom(expiredRoom.code);
          console.log(`[Room ${expiredRoom.code}] Room is empty. Closed room.`);
          return;
        }

        const newHost = expiredRoom.players.get(expiredRoom.hostId);
        io.to(expiredRoom.code).emit('player_left', {
          playerId: expiredPlayer.id,
          playerName: expiredPlayer.name,
          newHostId: newHost?.id,
          players: expiredRoom.getState().players,
        });

        io.to(expiredRoom.code).emit('room_updated', expiredRoom.getState());
      });

      if (room && player) {
        // Broadcast that player is temporarily disconnected
        io.to(room.code).emit('player_disconnected', {
          playerId: player.id,
          playerName: player.name,
          players: room.getState().players,
        });

        io.to(room.code).emit('room_updated', room.getState());
      }
    } catch (err: any) {
      console.error('[Room] disconnect error:', err);
    }
  });
}
