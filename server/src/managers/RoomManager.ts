import crypto from 'crypto';
import { Server as SocketIOServer } from 'socket.io';
import { Room } from '../models/Room.js';
import { InternalPlayer, RoomSettings } from '../types/index.js';

export class RoomManager {
  private rooms: Map<string, Room>;
  private socketToRoom: Map<string, string>;
  private socketToPlayer: Map<string, string>;

  constructor() {
    this.rooms = new Map();
    this.socketToRoom = new Map();
    this.socketToPlayer = new Map();
  }

  /**
   * Generates a 6-character alphanumeric room code.
   * Excludes ambiguous characters (0, O, 1, I) for readability.
   */
  public generateUniqueRoomCode(): string {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    do {
      code = '';
      for (let i = 0; i < 6; i++) {
        const randomIndex = Math.floor(Math.random() * chars.length);
        code += chars[randomIndex];
      }
    } while (this.rooms.has(code));

    return code;
  }

  public createRoom(
    hostName: string,
    socketId: string,
    settings?: Partial<RoomSettings>
  ): { room: Room; player: InternalPlayer } {
    const code = this.generateUniqueRoomCode();
    const playerId = 'p_' + crypto.randomUUID().slice(0, 8);
    const reconnectToken = 'tok_' + crypto.randomUUID().replace(/-/g, '');

    const hostPlayer: InternalPlayer = {
      id: playerId,
      name: hostName.trim() || 'Host',
      isHost: true,
      score: 0,
      isConnected: true,
      socketId,
      reconnectToken,
    };

    const room = new Room(code, hostPlayer, settings);
    this.rooms.set(code, room);
    this.socketToRoom.set(socketId, code);
    this.socketToPlayer.set(socketId, playerId);

    return { room, player: hostPlayer };
  }

  public getRoom(code: string): Room | undefined {
    if (!code) return undefined;
    return this.rooms.get(code.trim().toUpperCase());
  }

  public getRoomBySocketId(socketId: string): Room | undefined {
    const code = this.socketToRoom.get(socketId);
    if (!code) return undefined;
    return this.rooms.get(code);
  }

  public getPlayerBySocketId(socketId: string): InternalPlayer | undefined {
    const code = this.socketToRoom.get(socketId);
    const playerId = this.socketToPlayer.get(socketId);
    if (!code || !playerId) return undefined;
    const room = this.rooms.get(code);
    return room?.getPlayer(playerId);
  }

  public joinRoom(
    code: string,
    playerName: string,
    socketId: string
  ): { success: boolean; room?: Room; player?: InternalPlayer; error?: string } {
    const cleanCode = code.trim().toUpperCase();
    const room = this.rooms.get(cleanCode);

    if (!room) {
      return { success: false, error: 'Room not found. Please check the room code.' };
    }

    if (room.isFull()) {
      return { success: false, error: 'Room is full (maximum capacity reached).' };
    }

    if (room.phase !== 'LOBBY') {
      return { success: false, error: 'Cannot join: game is already in progress.' };
    }

    const playerId = 'p_' + crypto.randomUUID().slice(0, 8);
    const reconnectToken = 'tok_' + crypto.randomUUID().replace(/-/g, '');

    const player: InternalPlayer = {
      id: playerId,
      name: playerName.trim() || 'Player',
      isHost: false,
      score: 0,
      isConnected: true,
      socketId,
      reconnectToken,
    };

    const added = room.addPlayer(player);
    if (!added) {
      return { success: false, error: 'Unable to join room.' };
    }

    this.socketToRoom.set(socketId, cleanCode);
    this.socketToPlayer.set(socketId, playerId);

    return { success: true, room, player };
  }

  public resumeRoom(
    roomId: string,
    playerId: string,
    reconnectToken: string,
    newSocketId: string,
    io?: SocketIOServer
  ): { success: boolean; room?: Room; player?: InternalPlayer; error?: string } {
    const cleanCode = roomId.trim().toUpperCase();
    const room = this.rooms.get(cleanCode);

    if (!room) {
      return { success: false, error: 'Room not found or session expired.' };
    }

    const result = room.resumePlayer(playerId, reconnectToken, newSocketId);
    if (!result.success || !result.player) {
      return { success: false, error: result.error || 'Failed to resume room session.' };
    }

    // Atomically evict previous socket mapping and disconnect old connection
    if (result.oldSocketId && result.oldSocketId !== newSocketId) {
      this.socketToRoom.delete(result.oldSocketId);
      this.socketToPlayer.delete(result.oldSocketId);

      if (io) {
        try {
          const oldSocket = io.sockets.sockets.get(result.oldSocketId);
          if (oldSocket) {
            oldSocket.leave(cleanCode);
            oldSocket.disconnect(true);
          }
        } catch (err) {
          console.warn(`[RoomManager] Error evicting superseded socket ${result.oldSocketId}:`, err);
        }
      }
    }

    // Bind new socket to room and player
    this.socketToRoom.set(newSocketId, cleanCode);
    this.socketToPlayer.set(newSocketId, playerId);

    return { success: true, room, player: result.player };
  }

  /**
   * Handles a socket disconnect by initiating the 15-second grace period.
   * Disconnect is ignored if the disconnecting socket is not the player's active socket.
   */
  public handleSocketDisconnect(
    socketId: string,
    onGraceExpired: (room: Room, player: InternalPlayer) => void
  ): { room: Room | null; player: InternalPlayer | null } {
    const code = this.socketToRoom.get(socketId);
    const playerId = this.socketToPlayer.get(socketId);

    this.socketToRoom.delete(socketId);
    this.socketToPlayer.delete(socketId);

    if (!code || !playerId) {
      return { room: null, player: null };
    }

    const room = this.rooms.get(code);
    if (!room) {
      return { room: null, player: null };
    }

    const player = room.getPlayer(playerId);
    if (!player) {
      return { room, player: null };
    }

    // Guard: Only initiate disconnection grace period if the disconnecting socket
    // is STILL the player's active authoritative socket!
    if (player.socketId !== socketId) {
      console.log(
        `[RoomManager] Disconnect ignored for superseded socket ${socketId} (Player "${player.name}" is active on socket ${player.socketId}).`
      );
      return { room: null, player: null };
    }

    room.markPlayerDisconnected(playerId, () => {
      onGraceExpired(room, player);
    });

    return { room, player };
  }

  /**
   * Voluntary departure: removes player permanently immediately.
   */
  public leaveRoom(
    socketId: string,
    io?: SocketIOServer
  ): { room: Room | null; player: InternalPlayer | null; roomDeleted: boolean } {
    const code = this.socketToRoom.get(socketId);
    const playerId = this.socketToPlayer.get(socketId);

    if (!code || !playerId) {
      return { room: null, player: null, roomDeleted: false };
    }

    this.socketToRoom.delete(socketId);
    this.socketToPlayer.delete(socketId);

    const room = this.rooms.get(code);
    if (!room) {
      return { room: null, player: null, roomDeleted: false };
    }

    const player = room.getPlayer(playerId);
    if (!player || player.socketId !== socketId) {
      return { room: null, player: null, roomDeleted: false };
    }

    const removedPlayer = room.removePlayerPermanently(playerId, io);

    if (room.isEmpty()) {
      room.clearAllTimers();
      this.rooms.delete(code);
      return { room: null, player: removedPlayer, roomDeleted: true };
    }

    return { room, player: removedPlayer, roomDeleted: false };
  }

  public deleteRoom(code: string): void {
    const cleanCode = code.trim().toUpperCase();
    const room = this.rooms.get(cleanCode);
    if (room) {
      room.clearAllTimers();
      this.rooms.delete(cleanCode);
    }
  }

  public getActiveRoomCount(): number {
    return this.rooms.size;
  }
}
