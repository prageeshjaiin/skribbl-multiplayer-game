import crypto from 'crypto';
import { Server as SocketIOServer } from 'socket.io';
import {
  Player,
  InternalPlayer,
  RoomSettings,
  RoomState,
  GamePhase,
  Stroke,
  Point,
  ChatMessage,
  ScoreChange,
} from '../types/index.js';
import { wordManager } from '../managers/WordManager.js';

export const DEFAULT_SETTINGS: RoomSettings = {
  maxPlayers: 8,
  rounds: 3,
  drawTime: 80,
  wordChoices: 3,
  hints: 2,
};

const MAX_STROKES_PER_ROOM = 500;
const MAX_POINTS_PER_STROKE = 2000;
export const RECONNECT_GRACE_PERIOD_MS = 15000;

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

function isCloseGuess(guess: string, target: string): boolean {
  if (guess.length < 3 || target.length < 3) return false;
  const dist = levenshteinDistance(guess, target);
  if (dist === 0) return false;
  if (target.length <= 4) return dist === 1;
  if (target.length <= 6) return dist === 1;
  return dist <= 2;
}

export class Room {
  public readonly code: string;
  public hostId: string; // Stable playerId of host
  public currentDrawerId: string | null; // Stable playerId of active drawer
  public players: Map<string, InternalPlayer>; // Keyed by stable playerId
  public settings: RoomSettings;
  public phase: GamePhase;
  public strokes: Stroke[];
  public currentInProgressStroke: Stroke | null;
  public readonly createdAt: Date;

  // Phase 4 Engine State
  public currentRound: number;
  public turnQueue: string[]; // Stable playerIds scheduled to draw
  public currentWordChoices: string[];
  private currentWord: string | null;
  public revealedWord: string | null;
  private timer: NodeJS.Timeout | null;
  public timerTimeLeft: number;
  public timerTotalTime: number;

  // Progressive Letter Hints
  public revealedLetterIndices: Set<number>;
  private hintSchedule: Array<{ index: number; triggerTimeLeft: number }>;

  // Phase 5 Guessing, Chat & Authoritative Scoring
  public guessedPlayerIds: Set<string>;
  public turnScoreChanges: Map<string, number>;
  private isEndingTurn: boolean;
  public chatHistory: ChatMessage[];
  private messageRateLimits: Map<string, { count: number; resetTime: number }>;

  // Reconnection Disconnect Timers (playerId -> Timeout)
  public playerDisconnectTimers: Map<string, NodeJS.Timeout>;

  constructor(code: string, hostPlayer: InternalPlayer, initialSettings?: Partial<RoomSettings>) {
    this.code = code;
    this.hostId = hostPlayer.id;
    this.currentDrawerId = null;
    this.players = new Map();
    this.players.set(hostPlayer.id, hostPlayer);
    this.settings = this.sanitizeSettings(initialSettings);
    this.phase = 'LOBBY';
    this.strokes = [];
    this.currentInProgressStroke = null;
    this.createdAt = new Date();

    this.currentRound = 1;
    this.turnQueue = [];
    this.currentWordChoices = [];
    this.currentWord = null;
    this.revealedWord = null;
    this.timer = null;
    this.timerTimeLeft = 0;
    this.timerTotalTime = 0;
    this.playerDisconnectTimers = new Map();

    this.revealedLetterIndices = new Set();
    this.hintSchedule = [];

    this.guessedPlayerIds = new Set();
    this.turnScoreChanges = new Map();
    this.isEndingTurn = false;
    this.chatHistory = [];
    this.messageRateLimits = new Map();
  }

  private sanitizeSettings(settings?: Partial<RoomSettings>): RoomSettings {
    const merged = { ...DEFAULT_SETTINGS, ...(settings || {}) };

    return {
      maxPlayers: Math.max(2, Math.min(20, Math.floor(merged.maxPlayers || DEFAULT_SETTINGS.maxPlayers))),
      rounds: Math.max(2, Math.min(10, Math.floor(merged.rounds || DEFAULT_SETTINGS.rounds))),
      drawTime: Math.max(15, Math.min(240, Math.floor(merged.drawTime || DEFAULT_SETTINGS.drawTime))),
      wordChoices: Math.max(1, Math.min(5, Math.floor(merged.wordChoices || DEFAULT_SETTINGS.wordChoices))),
      hints: Math.max(0, Math.min(5, Math.floor(merged.hints ?? DEFAULT_SETTINGS.hints))),
    };
  }

  public updateSettings(newSettings: Partial<RoomSettings>): {
    success: boolean;
    settings: RoomSettings;
    error?: string;
  } {
    if (newSettings.maxPlayers !== undefined) {
      const requestedMax = Math.floor(Number(newSettings.maxPlayers));
      const currentOccupancy = this.players.size;

      if (isNaN(requestedMax) || requestedMax < 2 || requestedMax > 20) {
        return {
          success: false,
          settings: this.settings,
          error: 'Max Players must be between 2 and 20.',
        };
      }

      if (requestedMax < currentOccupancy) {
        return {
          success: false,
          settings: this.settings,
          error: `Cannot set Max Players to ${requestedMax}. There are currently ${currentOccupancy} players in the room.`,
        };
      }
    }

    if (newSettings.rounds !== undefined) {
      const r = Math.floor(Number(newSettings.rounds));
      if (isNaN(r) || r < 2 || r > 10) {
        return { success: false, settings: this.settings, error: 'Rounds must be between 2 and 10.' };
      }
    }

    if (newSettings.drawTime !== undefined) {
      const dt = Math.floor(Number(newSettings.drawTime));
      if (isNaN(dt) || dt < 15 || dt > 240) {
        return { success: false, settings: this.settings, error: 'Drawing time must be between 15 and 240 seconds.' };
      }
    }

    if (newSettings.wordChoices !== undefined) {
      const wc = Math.floor(Number(newSettings.wordChoices));
      if (isNaN(wc) || wc < 1 || wc > 5) {
        return { success: false, settings: this.settings, error: 'Word choices must be between 1 and 5.' };
      }
    }

    if (newSettings.hints !== undefined) {
      const h = Math.floor(Number(newSettings.hints));
      if (isNaN(h) || h < 0 || h > 5) {
        return { success: false, settings: this.settings, error: 'Hints must be between 0 and 5.' };
      }
    }

    this.settings = this.sanitizeSettings({ ...this.settings, ...newSettings });
    return { success: true, settings: this.settings };
  }

  public isFull(): boolean {
    return this.players.size >= this.settings.maxPlayers;
  }

  public isEmpty(): boolean {
    return this.players.size === 0;
  }

  public addPlayer(player: InternalPlayer): boolean {
    if (this.isFull() || this.phase !== 'LOBBY') {
      return false;
    }
    this.players.set(player.id, player);
    return true;
  }

  public getPlayer(playerId: string): InternalPlayer | undefined {
    return this.players.get(playerId);
  }

  public getPlayerBySocketId(socketId: string): InternalPlayer | undefined {
    for (const player of this.players.values()) {
      if (player.socketId === socketId) {
        return player;
      }
    }
    return undefined;
  }

  /**
   * Helper to emit a private event to a player via their active socketId
   */
  public emitToPlayer(io: SocketIOServer, playerId: string, event: string, ...args: any[]): void {
    const player = this.players.get(playerId);
    if (player && player.socketId && player.isConnected) {
      io.to(player.socketId).emit(event, ...args);
    }
  }

  // --------------------------------------------------------------------------
  // RECONNECTION LIFECYCLE & GRACE PERIOD
  // --------------------------------------------------------------------------

  /**
   * Called when a player's socket drops.
   * Marks player temporarily disconnected and initiates the 15-second grace period.
   */
  public markPlayerDisconnected(playerId: string, onExpired: () => void): void {
    const player = this.players.get(playerId);
    if (!player) return;

    // Clear any previous disconnect timer
    this.clearDisconnectTimer(playerId);

    player.isConnected = false;
    player.socketId = null;

    console.log(`[Room ${this.code}] Player "${player.name}" (${player.id}) disconnected. Starting 15s grace period.`);

    const timer = setTimeout(() => {
      this.playerDisconnectTimers.delete(playerId);
      onExpired();
    }, RECONNECT_GRACE_PERIOD_MS);

    this.playerDisconnectTimers.set(playerId, timer);
  }

  public clearDisconnectTimer(playerId: string): void {
    const timer = this.playerDisconnectTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      this.playerDisconnectTimers.delete(playerId);
    }
  }

  /**
   * Resumes an existing player session with token authentication.
   */
  public resumePlayer(
    playerId: string,
    reconnectToken: string,
    newSocketId: string
  ): { success: boolean; player?: InternalPlayer; oldSocketId?: string | null; error?: string } {
    const player = this.players.get(playerId);
    if (!player) {
      return { success: false, error: 'Player session not found in this room.' };
    }

    // Constant-time token verification to prevent timing attacks
    const isTokenMatch =
      typeof reconnectToken === 'string' &&
      typeof player.reconnectToken === 'string' &&
      reconnectToken.length === player.reconnectToken.length &&
      crypto.timingSafeEqual(
        Buffer.from(reconnectToken, 'utf8'),
        Buffer.from(player.reconnectToken, 'utf8')
      );

    if (!isTokenMatch) {
      console.warn(`[Room ${this.code}] Reconnection rejected: token mismatch for player ${playerId}`);
      return { success: false, error: 'Invalid reconnect credentials.' };
    }

    const oldSocketId = player.socketId;

    // Cancel removal timer
    this.clearDisconnectTimer(playerId);

    // Re-bind transport socket
    player.socketId = newSocketId;
    player.isConnected = true;

    console.log(`[Room ${this.code}] Player "${player.name}" (${player.id}) successfully resumed session on socket ${newSocketId} (previous socket: ${oldSocketId}).`);

    return { success: true, player, oldSocketId };
  }

  /**
   * Permanently removes a player (upon grace period expiry or voluntary leave).
   */
  public removePlayerPermanently(playerId: string, io?: SocketIOServer): InternalPlayer | null {
    this.clearDisconnectTimer(playerId);

    const player = this.players.get(playerId) || null;
    if (!player) return null;

    this.players.delete(playerId);

    this.guessedPlayerIds.delete(playerId);
    this.turnScoreChanges.delete(playerId);
    this.messageRateLimits.delete(playerId);

    // Remove from scheduled turn queue
    this.turnQueue = this.turnQueue.filter((id) => id !== playerId);

    // Reassign host if removed player was host
    if (this.hostId === playerId) {
      this.reassignHost();
    }

    if (io) {
      // If the removed player was the active drawer
      if (this.currentDrawerId === playerId) {
        if (this.phase === 'WORD_SELECTION' || this.phase === 'DRAWING') {
          console.log(`[Room ${this.code}] Active drawer ${player.name} removed. Advancing turn.`);
          this.clearTimer();
          this.endTurn(io, true);
        }
      } else if (this.phase === 'DRAWING') {
        // If a guesser left, check if all remaining eligible guessers have already guessed
        const eligibleGuessers = Array.from(this.players.values()).filter(
          (p) => p.id !== this.currentDrawerId && p.isConnected
        );
        if (
          eligibleGuessers.length > 0 &&
          eligibleGuessers.every((p) => this.guessedPlayerIds.has(p.id))
        ) {
          console.log(`[Game ${this.code}] All remaining eligible guessers guessed! Ending turn early.`);
          this.addSystemMessage('All players guessed the word! Turn complete.', io);
          this.endTurn(io);
        }
      }

      // If active game now has fewer than 2 players, drop back to LOBBY
      if (this.phase !== 'LOBBY' && this.players.size < 2) {
        console.log(`[Room ${this.code}] Fewer than 2 players remaining. Resetting to LOBBY.`);
        this.returnToLobby(io);
        io.to(this.code).emit('error_message', {
          message: 'The game ended because there are fewer than 2 players remaining.',
        });
      }
    }

    return player;
  }

  public reassignHost(): InternalPlayer | null {
    if (this.players.size === 0) {
      this.hostId = '';
      return null;
    }
    // Prefer the first connected player, or first remaining
    const connected = Array.from(this.players.values()).find((p) => p.isConnected);
    const newHost = connected || this.players.values().next().value;
    if (newHost) {
      newHost.isHost = true;
      this.hostId = newHost.id;
      return newHost;
    }
    return null;
  }

  public canStart(requesterSocketId: string): { canStart: boolean; error?: string } {
    const requester = this.getPlayerBySocketId(requesterSocketId);
    if (!requester || requester.id !== this.hostId) {
      return { canStart: false, error: 'Only the room host can start the game.' };
    }
    if (this.players.size < 2) {
      return { canStart: false, error: 'At least 2 players are required to start the game.' };
    }
    if (this.phase !== 'LOBBY') {
      return { canStart: false, error: 'The game has already started.' };
    }
    return { canStart: true };
  }

  // --------------------------------------------------------------------------
  // GAME ENGINE STATE MACHINE
  // --------------------------------------------------------------------------

  public startGame(io: SocketIOServer): void {
    this.clearTimer();
    this.currentRound = 1;
    this.strokes = [];
    this.currentInProgressStroke = null;
    this.turnQueue = Array.from(this.players.keys());
    this.guessedPlayerIds.clear();
    this.turnScoreChanges.clear();
    this.isEndingTurn = false;

    // Reset scores for all players at the start of a new game
    for (const player of this.players.values()) {
      player.score = 0;
    }

    this.addSystemMessage('The game has started! Round 1 begins.', io);

    console.log(`[Game ${this.code}] Starting game. Round 1 of ${this.settings.rounds}. Queue:`, this.turnQueue);
    this.startTurn(io);
  }

  public startTurn(io: SocketIOServer): void {
    this.clearTimer();
    this.isEndingTurn = false;
    this.guessedPlayerIds.clear();
    this.turnScoreChanges.clear();
    this.revealedLetterIndices.clear();
    this.hintSchedule = [];

    // Remove any permanently dropped players from the queue
    while (this.turnQueue.length > 0 && !this.players.has(this.turnQueue[0])) {
      this.turnQueue.shift();
    }

    if (this.turnQueue.length === 0) {
      if (this.currentRound < this.settings.rounds) {
        this.currentRound++;
        this.turnQueue = Array.from(this.players.keys());
        console.log(`[Game ${this.code}] Advancing to Round ${this.currentRound}/${this.settings.rounds}`);
        this.addSystemMessage(`Round ${this.currentRound} of ${this.settings.rounds} has started!`, io);
      } else {
        this.endGame(io);
        return;
      }
    }

    const nextDrawerId = this.turnQueue.shift() || null;
    if (!nextDrawerId || !this.players.has(nextDrawerId)) {
      if (this.players.size >= 2) {
        this.startTurn(io);
      } else {
        this.returnToLobby(io);
      }
      return;
    }

    this.currentDrawerId = nextDrawerId;
    this.phase = 'WORD_SELECTION';
    this.currentWord = null;
    this.revealedWord = null;
    this.clearCanvas();

    const drawer = this.players.get(this.currentDrawerId);
    if (drawer) {
      this.addSystemMessage(`Round ${this.currentRound}: ${drawer.name} is choosing a word.`, io);
    }

    // Generate secret word choices
    this.currentWordChoices = wordManager.getRandomWords(this.settings.wordChoices);

    console.log(`[Game ${this.code}] Word selection for drawer ${this.currentDrawerId}. Choices:`, this.currentWordChoices);

    // Broadcast updated public room state to everyone so GamePage mounts
    io.to(this.code).emit('room_updated', this.getState());

    // Send word choices ONLY to the drawer's private socket
    const sendChoices = () => {
      if (this.currentDrawerId && this.phase === 'WORD_SELECTION') {
        this.emitToPlayer(io, this.currentDrawerId, 'word_choices', {
          choices: this.currentWordChoices,
          selectionTime: 10,
        });
      }
    };

    sendChoices();
    setTimeout(sendChoices, 50);

    // 10-second countdown for word selection
    this.startTimer(io, 10, 'WORD_SELECTION', () => {
      if (this.phase === 'WORD_SELECTION') {
        const autoChoice =
          this.currentWordChoices[
            Math.floor(Math.random() * this.currentWordChoices.length)
          ] || 'APPLE';
        console.log(`[Game ${this.code}] Drawer selection timed out. Auto-selected: ${autoChoice}`);
        this.selectWord(autoChoice, io);
      }
    });
  }

  public initHintSchedule(): void {
    this.revealedLetterIndices.clear();
    this.hintSchedule = [];

    if (!this.currentWord) return;

    // Find all indices of characters that are letters (not spaces or punctuation)
    const letterIndices: number[] = [];
    for (let i = 0; i < this.currentWord.length; i++) {
      const char = this.currentWord[i];
      if (/[A-Z0-9]/i.test(char)) {
        letterIndices.push(i);
      }
    }

    // Never reveal more letters than permitted, and never reveal the full word (leave at least 1 letter masked)
    const maxPossibleHints = Math.max(0, letterIndices.length - 1);
    const configuredHints = Math.max(0, Math.min(5, Math.floor(this.settings.hints ?? DEFAULT_SETTINGS.hints)));
    const totalHintsToReveal = Math.min(configuredHints, maxPossibleHints);

    if (totalHintsToReveal <= 0 || letterIndices.length <= 1) {
      return;
    }

    // Shuffle letter indices to select random, distinct positions
    const shuffled = [...letterIndices].sort(() => 0.5 - Math.random());
    const selectedIndices = shuffled.slice(0, totalHintsToReveal);

    // Spread hint revelations across the drawing duration
    const totalDuration = Math.max(15, this.settings.drawTime);
    for (let i = 0; i < totalHintsToReveal; i++) {
      // For K hints, trigger each hint at totalDuration * (K + 1 - (i + 1)) / (K + 1)
      const triggerTimeLeft = Math.floor(
        (totalDuration * (totalHintsToReveal - i)) / (totalHintsToReveal + 1)
      );
      this.hintSchedule.push({
        index: selectedIndices[i],
        triggerTimeLeft,
      });
    }

    console.log(
      `[Game ${this.code}] Initialized hint schedule for "${this.currentWord}" (${totalHintsToReveal} hints):`,
      this.hintSchedule.map((h) => `index ${h.index} ('${this.currentWord![h.index]}') at ${h.triggerTimeLeft}s`)
    );
  }

  public selectWord(word: string, io: SocketIOServer): boolean {
    if (this.phase !== 'WORD_SELECTION') return false;

    const cleanWord = word.trim().toUpperCase();
    if (!this.currentWordChoices.includes(cleanWord)) {
      return false;
    }

    this.clearTimer();
    this.isEndingTurn = false;
    this.guessedPlayerIds.clear();
    this.turnScoreChanges.clear();
    this.currentWord = cleanWord;
    this.phase = 'DRAWING';
    this.clearCanvas();
    this.initHintSchedule();

    const drawer = this.currentDrawerId ? this.players.get(this.currentDrawerId) : null;
    if (drawer) {
      this.addSystemMessage(`${drawer.name} is now drawing! Guess the word in chat.`, io);
    }

    console.log(`[Game ${this.code}] Word chosen: "${this.currentWord}". Drawing timer: ${this.settings.drawTime}s`);

    // Notify drawer privately of their chosen word
    if (this.currentDrawerId) {
      this.emitToPlayer(io, this.currentDrawerId, 'your_turn', { word: this.currentWord });
    }

    // Broadcast canvas clear
    io.to(this.code).emit('canvas_clear');

    // Broadcast public state update (word is masked)
    io.to(this.code).emit('room_updated', this.getState());

    // Start drawing timer
    const drawDuration = this.settings.drawTime;
    this.startTimer(io, drawDuration, 'DRAWING', () => {
      this.endTurn(io);
    });

    return true;
  }

  public endTurn(io: SocketIOServer, drawerDisconnected = false): void {
    if (this.isEndingTurn) return;
    this.isEndingTurn = true;

    this.clearTimer();
    this.phase = 'TURN_END';
    this.revealedWord = this.currentWord;

    const nextId = this.turnQueue[0] || null;
    const nextDrawerPlayer = nextId ? this.players.get(nextId) : null;
    const isRoundEnd = this.turnQueue.length === 0;
    const isGameOver = isRoundEnd && this.currentRound >= this.settings.rounds;

    console.log(`[Game ${this.code}] Turn ended. Revealed word: "${this.revealedWord}". Next: ${nextDrawerPlayer?.name || 'Round change'}`);

    // Compile authoritative score changes for this turn
    const scoreChanges: ScoreChange[] = Array.from(this.players.values())
      .map((p) => ({
        playerId: p.id,
        playerName: p.name,
        pointsEarned: this.turnScoreChanges.get(p.id) || 0,
        totalScore: p.score,
        isDrawer: p.id === this.currentDrawerId,
      }))
      .sort((a, b) => b.pointsEarned - a.pointsEarned);

    const revealed = this.revealedWord || (drawerDisconnected ? 'Drawer Disconnected' : '—');
    this.addSystemMessage(`Time's up! The word was "${revealed}".`, io);

    // Broadcast turn_end with revealed word and score changes
    io.to(this.code).emit('turn_end', {
      word: revealed,
      nextDrawerId: nextDrawerPlayer?.id || null,
      nextDrawerName: nextDrawerPlayer?.name || null,
      isRoundEnd,
      isGameOver,
      scoreChanges,
    });

    io.to(this.code).emit('room_updated', this.getState());

    // 5-second reveal intermission
    this.startTimer(io, 5, 'TURN_END', () => {
      this.isEndingTurn = false;
      if (isGameOver) {
        this.endGame(io);
      } else {
        this.startTurn(io);
      }
    });
  }

  public endGame(io: SocketIOServer): void {
    this.clearTimer();
    this.phase = 'GAME_OVER';
    this.currentDrawerId = null;

    console.log(`[Game ${this.code}] Game Over! Total rounds completed: ${this.settings.rounds}`);

    // Ranked players with deterministic tie-breaking:
    // 1. Highest score first
    // 2. Alphabetical by name
    // 3. Stable player ID
    const rankedPlayers = Array.from(this.players.values())
      .map((p) => ({
        id: p.id,
        name: p.name,
        isHost: p.id === this.hostId,
        score: p.score,
        isConnected: p.isConnected,
      }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const nameDiff = a.name.localeCompare(b.name);
        if (nameDiff !== 0) return nameDiff;
        return a.id.localeCompare(b.id);
      });

    const winnerName = rankedPlayers[0] ? rankedPlayers[0].name : 'Nobody';
    this.addSystemMessage(`🏆 Game Over! Winner: ${winnerName} with ${rankedPlayers[0]?.score || 0} pts!`, io);

    io.to(this.code).emit('game_over', {
      totalRounds: this.settings.rounds,
      players: rankedPlayers,
      message: `All rounds completed! Winner is ${winnerName}!`,
    });

    io.to(this.code).emit('room_updated', this.getState());
  }

  public returnToLobby(io: SocketIOServer): void {
    this.clearTimer();
    this.phase = 'LOBBY';
    this.currentRound = 1;
    this.currentDrawerId = null;
    this.currentWord = null;
    this.revealedWord = null;
    this.turnQueue = [];
    this.clearCanvas();
    this.isEndingTurn = false;
    this.guessedPlayerIds.clear();
    this.turnScoreChanges.clear();
    this.revealedLetterIndices.clear();
    this.hintSchedule = [];
    this.chatHistory = [];

    // Reset scores for all players for a fresh game
    for (const player of this.players.values()) {
      player.score = 0;
    }

    this.addSystemMessage('Returned to lobby. Scores have been reset for the next game.', io);

    io.to(this.code).emit('canvas_clear');
    io.to(this.code).emit('room_updated', this.getState());
  }

  // --------------------------------------------------------------------------
  // GUESSING, CHAT & AUTHORITATIVE SCORING
  // --------------------------------------------------------------------------

  public hasPlayerGuessed(playerId: string): boolean {
    return this.guessedPlayerIds.has(playerId);
  }

  public checkRateLimit(playerId: string): boolean {
    const now = Date.now();
    const entry = this.messageRateLimits.get(playerId);
    if (!entry || now > entry.resetTime) {
      this.messageRateLimits.set(playerId, { count: 1, resetTime: now + 3000 });
      return true;
    }
    if (entry.count >= 5) {
      return false; // Rate limit exceeded (more than 5 messages in 3s)
    }
    entry.count++;
    return true;
  }

  public addChatMessage(msg: ChatMessage, io?: SocketIOServer): void {
    if (this.chatHistory.length >= 100) {
      this.chatHistory.shift();
    }
    this.chatHistory.push(msg);
    if (io) {
      io.to(this.code).emit('chat_message', msg);
    }
  }

  public addSystemMessage(text: string, io?: SocketIOServer): void {
    const msg: ChatMessage = {
      id: 'sys_' + Math.random().toString(36).substring(2, 9),
      senderName: 'System',
      text,
      type: 'system',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    this.addChatMessage(msg, io);
  }

  public getChatHistory(): ChatMessage[] {
    return [...this.chatHistory];
  }

  /**
   * Authoritative guess processing
   */
  public submitGuess(
    playerId: string,
    rawText: string,
    io: SocketIOServer
  ): {
    success: boolean;
    isCorrect?: boolean;
    isClose?: boolean;
    error?: string;
    message?: string;
    pointsEarned?: number;
  } {
    const player = this.players.get(playerId);
    if (!player) {
      return { success: false, error: 'Player not found in this room.' };
    }

    if (!this.checkRateLimit(playerId)) {
      return { success: false, error: 'You are typing too fast. Please wait a moment.' };
    }

    // Sanitize text
    const text = String(rawText || '')
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
      .trim();

    if (!text) {
      return { success: false, error: 'Guess cannot be empty.' };
    }
    if (text.length > 100) {
      return { success: false, error: 'Guess cannot exceed 100 characters.' };
    }

    // Only allow guesses during DRAWING phase
    if (this.phase !== 'DRAWING') {
      return { success: false, error: 'Guesses are only accepted during the drawing phase.' };
    }

    // Active drawer cannot guess
    if (this.currentDrawerId === playerId) {
      return { success: false, error: 'You are drawing! You cannot submit guesses.' };
    }

    // Player already guessed correctly this turn
    if (this.guessedPlayerIds.has(playerId)) {
      return { success: false, error: 'You have already guessed the word for this turn!' };
    }

    const targetWord = (this.currentWord || '').trim().toLowerCase();
    const cleanGuess = text.toLowerCase().replace(/\s+/g, ' ');

    // EXACT MATCH: Correct Guess!
    if (cleanGuess === targetWord && targetWord.length > 0) {
      this.guessedPlayerIds.add(playerId);

      // Server-authoritative scoring formula:
      // Time fraction between 0.0 and 1.0 based on remaining time
      const totalTime = Math.max(1, this.settings.drawTime);
      const timeLeft = Math.max(0, this.timerTimeLeft);
      const timeFraction = Math.min(1, timeLeft / totalTime);

      // Guesser points: 100 base + (timeFraction * 400) = 100 to 500 points
      const guesserPoints = Math.round(100 + timeFraction * 400);
      player.score += guesserPoints;
      this.turnScoreChanges.set(
        playerId,
        (this.turnScoreChanges.get(playerId) || 0) + guesserPoints
      );

      // Drawer bonus: 25% of guesser's score
      let drawerBonus = 0;
      if (this.currentDrawerId) {
        const drawer = this.players.get(this.currentDrawerId);
        if (drawer) {
          drawerBonus = Math.round(guesserPoints * 0.25);
          drawer.score += drawerBonus;
          this.turnScoreChanges.set(
            this.currentDrawerId,
            (this.turnScoreChanges.get(this.currentDrawerId) || 0) + drawerBonus
          );
        }
      }

      console.log(
        `[Game ${this.code}] Player "${player.name}" guessed correctly! +${guesserPoints} pts (Drawer bonus: +${drawerBonus} pts). Remaining: ${timeLeft}s`
      );

      // Broadcast correct_guess notification
      io.to(this.code).emit('correct_guess', {
        playerId: player.id,
        playerName: player.name,
        pointsEarned: guesserPoints,
        totalScore: player.score,
      });

      // Add announcement to chat history (NEVER reveals the secret word!)
      const correctMsg: ChatMessage = {
        id: 'guess_' + Math.random().toString(36).substring(2, 9),
        senderId: player.id,
        senderName: player.name,
        text: `${player.name} guessed the word! (+${guesserPoints} pts)`,
        type: 'correct_guess',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        pointsEarned: guesserPoints,
      };
      this.addChatMessage(correctMsg, io);

      // Broadcast room_updated with refreshed player scores
      io.to(this.code).emit('room_updated', this.getState());

      // Early Turn Completion:
      // Check if all connected eligible guessers have guessed
      const eligibleGuessers = Array.from(this.players.values()).filter(
        (p) => p.id !== this.currentDrawerId && p.isConnected
      );

      if (
        eligibleGuessers.length > 0 &&
        eligibleGuessers.every((p) => this.guessedPlayerIds.has(p.id))
      ) {
        console.log(`[Game ${this.code}] All eligible guessers guessed! Ending turn early.`);
        this.addSystemMessage('All players guessed the word! Turn complete.', io);
        this.endTurn(io);
      }

      return {
        success: true,
        isCorrect: true,
        pointsEarned: guesserPoints,
        message: 'You guessed the word!',
      };
    }

    // Check if the guess is close
    const close = isCloseGuess(cleanGuess, targetWord);
    if (close) {
      // Send private notification to the sender only
      this.emitToPlayer(io, playerId, 'close_guess', {
        message: "You're very close!",
      });
    }

    // Broadcast incorrect guess as standard chat message
    const chatMsg: ChatMessage = {
      id: 'msg_' + Math.random().toString(36).substring(2, 9),
      senderId: player.id,
      senderName: player.name,
      text,
      type: 'chat',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    this.addChatMessage(chatMsg, io);

    return {
      success: true,
      isCorrect: false,
      isClose: close,
      message: close ? "You're very close!" : undefined,
    };
  }

  // --------------------------------------------------------------------------
  // TIMER MANAGEMENT
  // --------------------------------------------------------------------------

  public startTimer(
    io: SocketIOServer,
    seconds: number,
    phase: GamePhase,
    onComplete: () => void
  ): void {
    this.clearTimer();
    this.timerTimeLeft = seconds;
    this.timerTotalTime = seconds;

    io.to(this.code).emit('game_timer', {
      timeLeft: this.timerTimeLeft,
      totalTime: this.timerTotalTime,
      phase,
    });

    this.timer = setInterval(() => {
      this.timerTimeLeft--;

      // Progressive letter hints during DRAWING phase
      if (phase === 'DRAWING' && this.hintSchedule.length > 0) {
        let hintRevealed = false;
        for (const hint of this.hintSchedule) {
          if (
            this.timerTimeLeft <= hint.triggerTimeLeft &&
            !this.revealedLetterIndices.has(hint.index)
          ) {
            this.revealedLetterIndices.add(hint.index);
            hintRevealed = true;
            console.log(
              `[Game ${this.code}] Progressive hint revealed at ${this.timerTimeLeft}s: letter '${this.currentWord?.[hint.index]}' at index ${hint.index}`
            );
          }
        }
        if (hintRevealed) {
          io.to(this.code).emit('room_updated', this.getState());
        }
      }

      if (this.timerTimeLeft >= 0) {
        io.to(this.code).emit('game_timer', {
          timeLeft: this.timerTimeLeft,
          totalTime: this.timerTotalTime,
          phase,
        });
      }

      if (this.timerTimeLeft <= 0) {
        this.clearTimer();
        onComplete();
      }
    }, 1000);
  }

  public clearTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.timerTimeLeft = 0;
  }

  public clearAllTimers(): void {
    this.clearTimer();
    for (const timer of this.playerDisconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.playerDisconnectTimers.clear();
  }

  // --------------------------------------------------------------------------
  // AUTHORIZATION & STROKES
  // --------------------------------------------------------------------------

  public isAuthorizedHost(socketId: string): boolean {
    const player = this.getPlayerBySocketId(socketId);
    return Boolean(
      player &&
      this.hostId === player.id &&
      player.isConnected &&
      player.socketId === socketId
    );
  }

  public isCurrentDrawer(socketId: string): boolean {
    const player = this.getPlayerBySocketId(socketId);
    return Boolean(
      player &&
      this.currentDrawerId === player.id &&
      player.isConnected &&
      player.socketId === socketId
    );
  }

  public isAuthorizedDrawer(socketId: string): boolean {
    return this.phase === 'DRAWING' && this.isCurrentDrawer(socketId);
  }

  public startStroke(stroke: Stroke): boolean {
    if (this.strokes.length >= MAX_STROKES_PER_ROOM) {
      this.strokes.shift();
    }
    this.currentInProgressStroke = {
      ...stroke,
      points: [...stroke.points],
    };
    return true;
  }

  public addStrokePoint(strokeId: string, point: Point): boolean {
    if (!this.currentInProgressStroke || this.currentInProgressStroke.id !== strokeId) {
      return false;
    }
    if (this.currentInProgressStroke.points.length >= MAX_POINTS_PER_STROKE) {
      return false;
    }
    this.currentInProgressStroke.points.push(point);
    return true;
  }

  public endStroke(strokeId: string): Stroke | null {
    if (this.currentInProgressStroke && this.currentInProgressStroke.id === strokeId) {
      const completed = this.currentInProgressStroke;
      this.strokes.push(completed);
      this.currentInProgressStroke = null;
      return completed;
    }
    return null;
  }

  public undoStroke(): Stroke | null {
    if (this.strokes.length === 0) {
      return null;
    }
    return this.strokes.pop() || null;
  }

  public clearCanvas(): void {
    this.strokes = [];
    this.currentInProgressStroke = null;
  }

  public getStrokes(): Stroke[] {
    return [...this.strokes];
  }

  public getSecretWord(): string | null {
    return this.currentWord;
  }

  /**
   * Returns a sanitized, safe RoomState.
   * NEVER reveals currentWord or reconnectToken to clients!
   */
  public getState(): RoomState {
    const isWordRevealed =
      this.phase === 'TURN_END' || this.phase === 'GAME_OVER';

    // Sorted leaderboard: highest score first, tie-break by name, then id
    const sortedPlayers = Array.from(this.players.values())
      .map((p) => ({
        id: p.id,
        name: p.name,
        isHost: p.id === this.hostId,
        score: p.score,
        isConnected: p.isConnected,
        hasGuessedThisTurn: this.guessedPlayerIds.has(p.id),
      }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const nameDiff = a.name.localeCompare(b.name);
        if (nameDiff !== 0) return nameDiff;
        return a.id.localeCompare(b.id);
      });

    return {
      code: this.code,
      hostId: this.hostId,
      currentDrawerId: this.currentDrawerId,
      players: sortedPlayers,
      settings: { ...this.settings },
      phase: this.phase,
      currentRound: this.currentRound,
      totalRounds: this.settings.rounds,
      maskedWord: this.currentWord
        ? wordManager.maskWord(this.currentWord, this.revealedLetterIndices)
        : null,
      wordLength: this.currentWord
        ? this.currentWord.replace(/[^A-Z0-9]/gi, '').length
        : null,
      revealedWord: isWordRevealed ? this.revealedWord : null,
    };
  }
}
