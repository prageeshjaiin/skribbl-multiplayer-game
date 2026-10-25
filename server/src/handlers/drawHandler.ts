import { Server as SocketIOServer, Socket } from 'socket.io';
import { RoomManager } from '../managers/RoomManager.js';
import { RateLimiter } from '../utils/RateLimiter.js';
import {
  DrawStartPayload,
  DrawMovePayload,
  DrawEndPayload,
  ApiResponse,
  Stroke,
  Point,
} from '../types/index.js';

// Rate limiter on high-frequency draw_move events: max 120 events/sec per socket
const drawMoveLimiter = new RateLimiter(120, 1000);

// Helper to clamp numbers safely
function clamp(val: number, min: number, max: number): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, val));
}

// Helper to validate and clamp normalized points. Rejects non-finite numbers (NaN, Infinity).
function sanitizePoint(pt: any): Point | null {
  const x = Number(pt?.x);
  const y = Number(pt?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return {
    x: clamp(x, 0, 1),
    y: clamp(y, 0, 1),
  };
}

// Regex to validate hex color format
const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function registerDrawHandlers(
  io: SocketIOServer,
  socket: Socket,
  roomManager: RoomManager
): void {
  /**
   * Event: draw_start
   * Authorized drawer begins a new stroke on the canvas.
   */
  socket.on('draw_start', (payload: DrawStartPayload) => {
    try {
      if (!payload?.roomId || !payload?.strokeId || typeof payload.strokeId !== 'string') return;

      const room = roomManager.getRoom(payload.roomId);
      if (!room || !room.isAuthorizedDrawer(socket.id)) {
        // Reject unauthorized drawing attempts silently
        return;
      }

      const clampedPoint = sanitizePoint(payload.point);
      if (!clampedPoint) return;

      const rawSize = Number(payload.size);
      const clampedSize = Number.isFinite(rawSize) ? clamp(rawSize, 1, 64) : 6;
      
      const safeColor =
        typeof payload.color === 'string' && HEX_COLOR_REGEX.test(payload.color.trim())
          ? payload.color.trim()
          : '#000000';
      const isEraser = Boolean(payload.isEraser);

      const stroke: Stroke = {
        id: String(payload.strokeId).trim().slice(0, 36),
        points: [clampedPoint],
        color: safeColor,
        size: clampedSize,
        isEraser,
      };

      room.startStroke(stroke);

      // Broadcast to other players in the room (not to sender, to prevent double rendering)
      socket.to(room.code).emit('draw_start', {
        strokeId: stroke.id,
        point: clampedPoint,
        color: safeColor,
        size: clampedSize,
        isEraser,
      });
    } catch (err) {
      console.error('[Draw] Error in draw_start:', err);
    }
  });

  /**
   * Event: draw_move
   * Authorized drawer moves their pointer, adding points to the active stroke.
   */
  socket.on('draw_move', (payload: DrawMovePayload) => {
    try {
      if (!payload?.roomId || !payload?.strokeId || typeof payload.strokeId !== 'string') return;

      // Rate limit check: drop excessive events beyond 120/sec safely
      if (!drawMoveLimiter.check(socket.id)) {
        return;
      }

      const room = roomManager.getRoom(payload.roomId);
      if (!room || !room.isAuthorizedDrawer(socket.id)) {
        return;
      }

      const clampedPoint = sanitizePoint(payload.point);
      if (!clampedPoint) return;

      const strokeId = String(payload.strokeId).trim().slice(0, 36);
      const added = room.addStrokePoint(strokeId, clampedPoint);

      if (added) {
        socket.to(room.code).emit('draw_move', {
          strokeId,
          point: clampedPoint,
        });
      }
    } catch (err) {
      console.error('[Draw] Error in draw_move:', err);
    }
  });

  /**
   * Event: draw_end
   * Authorized drawer finishes the stroke.
   */
  socket.on('draw_end', (payload: DrawEndPayload) => {
    try {
      if (!payload?.roomId || !payload?.strokeId) return;

      const room = roomManager.getRoom(payload.roomId);
      if (!room || !room.isAuthorizedDrawer(socket.id)) {
        return;
      }

      room.endStroke(payload.strokeId);

      socket.to(room.code).emit('draw_end', {
        strokeId: payload.strokeId,
      });
    } catch (err) {
      console.error('[Draw] Error in draw_end:', err);
    }
  });

  /**
   * Event: draw_undo
   * Authorized drawer undoes the last stroke.
   */
  socket.on(
    'draw_undo',
    (payload: { roomId: string }, callback?: (response: ApiResponse<null>) => void) => {
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

        if (!room.isAuthorizedDrawer(socket.id)) {
          if (callback) callback({ success: false, error: 'Only the active drawer can undo strokes' });
          return;
        }

        const undone = room.undoStroke();
        if (undone) {
          // Broadcast to everyone in the room (including drawer so all clients stay 100% in sync)
          io.to(room.code).emit('draw_undo');
        }

        if (callback) callback({ success: true });
      } catch (err) {
        console.error('[Draw] Error in draw_undo:', err);
        if (callback) callback({ success: false, error: 'Failed to undo stroke' });
      }
    }
  );

  /**
   * Event: canvas_clear
   * Authorized drawer clears the entire canvas.
   */
  socket.on(
    'canvas_clear',
    (payload: { roomId: string }, callback?: (response: ApiResponse<null>) => void) => {
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

        if (!room.isAuthorizedDrawer(socket.id)) {
          if (callback) callback({ success: false, error: 'Only the active drawer can clear the canvas' });
          return;
        }

        room.clearCanvas();

        // Broadcast to everyone in the room
        io.to(room.code).emit('canvas_clear');

        if (callback) callback({ success: true });
      } catch (err) {
        console.error('[Draw] Error in canvas_clear:', err);
        if (callback) callback({ success: false, error: 'Failed to clear canvas' });
      }
    }
  );

  /**
   * Event: get_canvas_state
   * Reconnecting or newly joined client requests the current canvas stroke history.
   */
  socket.on(
    'get_canvas_state',
    (payload: { roomId: string }, callback?: (response: ApiResponse<Stroke[]>) => void) => {
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

        const strokes = room.getStrokes();

        if (callback) {
          callback({
            success: true,
            data: strokes,
          });
        } else {
          socket.emit('canvas_state', strokes);
        }
      } catch (err) {
        console.error('[Draw] Error in get_canvas_state:', err);
        if (callback) callback({ success: false, error: 'Failed to retrieve canvas state' });
      }
    }
  );

  socket.on('disconnect', () => {
    drawMoveLimiter.reset(socket.id);
  });
}
