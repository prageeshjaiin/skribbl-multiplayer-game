export interface Player {
  id: string;          // Stable Player ID (e.g. p_xxxx)
  name: string;        // Player display name
  isHost: boolean;     // Whether this player is the room host
  score: number;       // Current score
  isConnected: boolean;// Whether transport connection is currently active
  hasGuessedThisTurn?: boolean; // Whether player guessed the word in the active turn
}

// Server-internal player structure that keeps reconnectToken & current socketId private
export interface InternalPlayer extends Player {
  socketId: string | null;
  reconnectToken: string;
}

export interface RoomSettings {
  maxPlayers: number;    // 2 - 20
  rounds: number;        // 2 - 10
  drawTime: number;      // 15 - 240 seconds
  wordChoices: number;   // 1 - 5 words
  hints: number;         // 0 - 5 hints
}

export type GamePhase =
  | 'LOBBY'
  | 'WORD_SELECTION'
  | 'DRAWING'
  | 'TURN_END'
  | 'GAME_OVER';

export interface Point {
  x: number; // Normalized coordinate: 0.0 to 1.0
  y: number; // Normalized coordinate: 0.0 to 1.0
}

export interface Stroke {
  id: string;
  points: Point[];
  color: string;
  size: number;
  isEraser: boolean;
}

export interface RoomState {
  code: string;
  hostId: string;
  currentDrawerId: string | null;
  players: Player[];
  settings: RoomSettings;
  phase: GamePhase;
  currentRound: number;
  totalRounds: number;
  maskedWord: string | null;
  wordLength: number | null;
  revealedWord: string | null;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface RoomJoinData {
  room: RoomState;
  player: Player;
  reconnectToken: string;
}

export interface ResumeRoomPayload {
  roomId: string;
  playerId: string;
  reconnectToken: string;
}

export interface ResumeRoomData {
  room: RoomState;
  player: Player;
  reconnectToken: string;
  privateData?: {
    wordChoices?: string[];
    drawerWord?: string;
  };
  strokes: Stroke[];
  chatHistory?: ChatMessage[];
}

export interface GameTimerUpdate {
  timeLeft: number;
  totalTime: number;
  phase: GamePhase;
}

export interface WordChoicesPayload {
  choices: string[];
  selectionTime: number;
}

export interface ScoreChange {
  playerId: string;
  playerName: string;
  pointsEarned: number;
  totalScore: number;
  isDrawer: boolean;
}

export interface TurnEndPayload {
  word: string;
  nextDrawerId?: string | null;
  nextDrawerName?: string | null;
  isRoundEnd: boolean;
  isGameOver: boolean;
  scoreChanges: ScoreChange[];
}

export interface GameOverPayload {
  totalRounds: number;
  players: Player[];
  message: string;
}

export type ChatMessageType = 'chat' | 'system' | 'correct_guess' | 'close_guess';

export interface ChatMessage {
  id: string;
  senderId?: string;
  senderName: string;
  text: string;
  type: ChatMessageType;
  timestamp: string;
  pointsEarned?: number;
}

export interface SubmitGuessPayload {
  roomId: string;
  text: string;
}

export interface GuessFeedbackPayload {
  success: boolean;
  isCorrect?: boolean;
  isClose?: boolean;
  message?: string;
}

export interface CorrectGuessPayload {
  playerId: string;
  playerName: string;
  pointsEarned: number;
  totalScore: number;
}

export interface DrawStartPayload {
  roomId: string;
  strokeId: string;
  point: Point;
  color: string;
  size: number;
  isEraser: boolean;
}

export interface DrawMovePayload {
  roomId: string;
  strokeId: string;
  point: Point;
}

export interface DrawEndPayload {
  roomId: string;
  strokeId: string;
}
