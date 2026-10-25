import { Server as SocketIOServer, Socket } from 'socket.io';
import { RoomManager } from '../managers/RoomManager.js';
import {
  SubmitGuessPayload,
  GuessFeedbackPayload,
  ApiResponse,
  ChatMessage,
} from '../types/index.js';

export function registerChatHandlers(
  io: SocketIOServer,
  socket: Socket,
  roomManager: RoomManager
): void {
  /**
   * Event: submit_guess / send_guess
   * Non-drawing player submits a guess during DRAWING phase.
   */
  const handleGuess = (
    payload: SubmitGuessPayload,
    callback?: (response: ApiResponse<GuessFeedbackPayload>) => void
  ) => {
    try {
      if (!payload?.roomId) {
        if (callback) callback({ success: false, error: 'Room ID is required.' });
        return;
      }

      const room = roomManager.getRoom(payload.roomId);
      if (!room) {
        if (callback) callback({ success: false, error: 'Room not found.' });
        return;
      }

      const player = roomManager.getPlayerBySocketId(socket.id);
      if (!player) {
        if (callback) callback({ success: false, error: 'Player identity not recognized in this room.' });
        return;
      }

      const result = room.submitGuess(player.id, payload.text, io);

      if (!result.success) {
        if (callback) {
          callback({
            success: false,
            error: result.error,
          });
        }
        return;
      }

      if (callback) {
        callback({
          success: true,
          data: {
            success: true,
            isCorrect: result.isCorrect,
            isClose: result.isClose,
            message: result.message,
          },
        });
      }
    } catch (err: any) {
      console.error('[Chat] submit_guess error:', err);
      if (callback) {
        callback({ success: false, error: 'Failed to process guess.' });
      }
    }
  };

  socket.on('submit_guess', handleGuess);
  socket.on('send_guess', handleGuess);

  /**
   * Event: get_chat_history
   * Player retrieves recent chat history for the room.
   */
  socket.on(
    'get_chat_history',
    (
      payload: { roomId: string },
      callback?: (response: ApiResponse<ChatMessage[]>) => void
    ) => {
      try {
        if (!payload?.roomId) {
          if (callback) callback({ success: false, error: 'Room ID is required.' });
          return;
        }

        const room = roomManager.getRoom(payload.roomId);
        if (!room) {
          if (callback) callback({ success: false, error: 'Room not found.' });
          return;
        }

        if (callback) {
          callback({
            success: true,
            data: room.getChatHistory(),
          });
        }
      } catch (err: any) {
        console.error('[Chat] get_chat_history error:', err);
        if (callback) {
          callback({ success: false, error: 'Failed to retrieve chat history.' });
        }
      }
    }
  );
}
