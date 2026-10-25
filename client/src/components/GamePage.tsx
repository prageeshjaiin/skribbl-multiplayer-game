import { useState, useEffect } from 'react';
import { DrawingCanvas } from './DrawingCanvas';
import { DrawingToolbar } from './DrawingToolbar';
import { ChatPanel } from './ChatPanel';
import { socket } from '../socket';
import type {
  RoomState,
  Stroke,
  ApiResponse,
  GameTimerUpdate,
  WordChoicesPayload,
  TurnEndPayload,
  GameOverPayload,
  ChatMessage,
  CorrectGuessPayload,
} from '../types';

interface GamePageProps {
  room: RoomState;
  currentPlayerId: string;
  currentSocketId?: string;
  onLeaveRoom: () => void;
  initialWordChoices?: string[];
  initialSecretWord?: string;
}

export function GamePage({
  room,
  currentPlayerId,
  onLeaveRoom,
  initialWordChoices,
  initialSecretWord,
}: GamePageProps) {
  // Drawing state
  const [color, setColor] = useState<string>('#000000');
  const [brushSize, setBrushSize] = useState<number>(8);
  const [isEraser, setIsEraser] = useState<boolean>(false);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [copiedCode, setCopiedCode] = useState(false);

  // Phase 4 Game Engine State
  const [timer, setTimer] = useState<GameTimerUpdate>({
    timeLeft: 0,
    totalTime: room.settings.drawTime,
    phase: room.phase,
  });
  const [wordChoices, setWordChoices] = useState<string[]>(initialWordChoices || []);
  const [drawerSecretWord, setDrawerSecretWord] = useState<string>(initialSecretWord || '');
  const [turnEndData, setTurnEndData] = useState<TurnEndPayload | null>(null);
  const [gameOverData, setGameOverData] = useState<GameOverPayload | null>(null);

  // Phase 5 Chat & Guessing State
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const isDrawer = room.currentDrawerId === currentPlayerId;
  const isHost = room.hostId === currentPlayerId;
  const currentDrawerPlayer = room.players.find((p) => p.id === room.currentDrawerId);
  const drawerName = currentDrawerPlayer?.name || 'Player';

  // Current user's guessed status for the turn
  const selfPlayer = room.players.find((p) => p.id === currentPlayerId);
  const hasGuessedThisTurn = Boolean(selfPlayer?.hasGuessedThisTurn);

  // Can draw ONLY during DRAWING phase by authorized drawer
  const canDraw = isDrawer && room.phase === 'DRAWING';

  // Sync initial props if updated in parent App
  useEffect(() => {
    if (initialWordChoices && initialWordChoices.length > 0) {
      setWordChoices(initialWordChoices);
    }
  }, [initialWordChoices]);

  useEffect(() => {
    if (initialSecretWord) {
      setDrawerSecretWord(initialSecretWord);
    }
  }, [initialSecretWord]);

  // Proactively fetch chat history on mount
  useEffect(() => {
    socket.emit(
      'get_chat_history',
      { roomId: room.code },
      (resp: ApiResponse<ChatMessage[]>) => {
        if (resp?.success && resp.data) {
          setChatMessages(resp.data);
        }
      }
    );
  }, [room.code]);

  // Proactively fetch word choices if missing during WORD_SELECTION (prevents any lifecycle race)
  useEffect(() => {
    if (isDrawer && room.phase === 'WORD_SELECTION' && wordChoices.length === 0) {
      socket.emit(
        'get_word_choices',
        { roomId: room.code },
        (resp: ApiResponse<{ choices: string[]; selectionTime: number }>) => {
          if (resp?.success && resp.data?.choices && resp.data.choices.length > 0) {
            setWordChoices(resp.data.choices);
          }
        }
      );
    }
  }, [isDrawer, room.phase, room.code, wordChoices.length]);

  // Proactively fetch secret word if missing during DRAWING (handles refreshes)
  useEffect(() => {
    if (isDrawer && room.phase === 'DRAWING' && !drawerSecretWord) {
      socket.emit(
        'get_drawer_word',
        { roomId: room.code },
        (resp: ApiResponse<{ word: string }>) => {
          if (resp?.success && resp.data?.word) {
            setDrawerSecretWord(resp.data.word);
          }
        }
      );
    }
  }, [isDrawer, room.phase, room.code, drawerSecretWord]);

  useEffect(() => {
    function onGameTimer(data: GameTimerUpdate) {
      setTimer(data);
    }

    function onWordChoices(data: WordChoicesPayload) {
      setWordChoices(data.choices || []);
      setTurnEndData(null);
    }

    function onYourTurn(data: { word: string }) {
      setDrawerSecretWord(data.word);
      setWordChoices([]);
      setTurnEndData(null);
    }

    function onTurnEnd(data: TurnEndPayload) {
      setTurnEndData(data);
      setWordChoices([]);
      setDrawerSecretWord('');
    }

    function onGameOver(data: GameOverPayload) {
      setGameOverData(data);
      setWordChoices([]);
      setDrawerSecretWord('');
    }

    function onChatMessage(msg: ChatMessage) {
      setChatMessages((prev) => [...prev.slice(-99), msg]);
    }

    function onCorrectGuess(_data: CorrectGuessPayload) {
      // Score changes are synchronized via room_updated
    }

    function onCloseGuess(data: { message: string }) {
      const closeMsg: ChatMessage = {
        id: 'close_' + Math.random().toString(36).substring(2, 9),
        senderName: 'System',
        text: data.message,
        type: 'close_guess',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setChatMessages((prev) => [...prev.slice(-99), closeMsg]);
    }

    socket.on('game_timer', onGameTimer);
    socket.on('word_choices', onWordChoices);
    socket.on('your_turn', onYourTurn);
    socket.on('turn_end', onTurnEnd);
    socket.on('game_over', onGameOver);
    socket.on('chat_message', onChatMessage);
    socket.on('correct_guess', onCorrectGuess);
    socket.on('close_guess', onCloseGuess);

    return () => {
      socket.off('game_timer', onGameTimer);
      socket.off('word_choices', onWordChoices);
      socket.off('your_turn', onYourTurn);
      socket.off('turn_end', onTurnEnd);
      socket.off('game_over', onGameOver);
      socket.off('chat_message', onChatMessage);
      socket.off('correct_guess', onCorrectGuess);
      socket.off('close_guess', onCloseGuess);
    };
  }, []);

  // When room phase resets to LOBBY or word selection, clear out prior turn values
  useEffect(() => {
    if (room.phase === 'WORD_SELECTION') {
      setTurnEndData(null);
      setGameOverData(null);
    }
    if (room.phase !== 'DRAWING' && !isDrawer) {
      setDrawerSecretWord('');
    }
  }, [room.phase, isDrawer]);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch (err) {
      console.error('Failed to copy room code:', err);
    }
  };

  const handleSelectWord = (word: string) => {
    socket.emit('choose_word', { roomId: room.code, word }, (resp: ApiResponse) => {
      if (!resp?.success) {
        console.error('Failed to choose word:', resp?.error);
      }
    });
  };

  const handleReturnToLobby = () => {
    if (!isHost) return;
    socket.emit('return_to_lobby', { roomId: room.code }, (resp: ApiResponse) => {
      if (!resp?.success) {
        console.error('Failed to return to lobby:', resp?.error);
      }
    });
  };

  const handleUndo = () => {
    if (!canDraw || strokes.length === 0) return;
    socket.emit('draw_undo', { roomId: room.code }, (resp: ApiResponse) => {
      if (!resp?.success) {
        console.error('Failed to undo:', resp?.error);
      }
    });
  };

  const handleClear = () => {
    if (!canDraw) return;
    socket.emit('canvas_clear', { roomId: room.code }, (resp: ApiResponse) => {
      if (!resp?.success) {
        console.error('Failed to clear canvas:', resp?.error);
      }
    });
  };

  const handleSendMessage = (text: string): Promise<{ success: boolean; error?: string }> => {
    return new Promise((resolve) => {
      socket.emit(
        'submit_guess',
        { roomId: room.code, text },
        (res: ApiResponse) => {
          if (res?.success) {
            resolve({ success: true });
          } else {
            resolve({ success: false, error: res?.error || 'Failed to send message' });
          }
        }
      );
    });
  };

  return (
    <div className="game-page-container">
      {/* Top Header Bar */}
      <header className="game-header">
        <div className="game-header-left">
          <span className="room-label">ROOM:</span>
          <span className="room-code-tag">{room.code}</span>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={handleCopyCode}
            title="Copy Room Code"
          >
            {copiedCode ? '✓ Copied' : '📋 Code'}
          </button>
        </div>

        {/* Status Pill: Round & Timer */}
        <div className="game-status-pill">
          <span className="phase-indicator">
            {room.phase === 'WORD_SELECTION' && '⏳ Word Selection'}
            {room.phase === 'DRAWING' && '🎨 Drawing'}
            {room.phase === 'TURN_END' && '🔔 Turn Ended'}
            {room.phase === 'GAME_OVER' && '🏆 Game Over'}
            {room.phase === 'LOBBY' && 'Lobby'}
          </span>
          <span className="round-indicator">
            Round {room.currentRound} of {room.totalRounds}
          </span>
          <span className={`timer-badge ${timer.timeLeft <= 5 ? 'timer-urgent' : ''}`}>
            ⏱️ {timer.timeLeft}s
          </span>
        </div>

        <div className="game-header-right">
          <button type="button" className="btn btn-sm btn-danger" onClick={onLeaveRoom}>
            Leave Game
          </button>
        </div>
      </header>

      {/* Main Game Arena (3-Column Layout: Players Roster, Canvas Arena, Chat & Guess Panel) */}
      <div className="game-arena">
        {/* Left Column: Authoritative Leaderboard & Player Roster */}
        <aside className="game-sidebar">
          <div className="sidebar-header">
            <h3>Leaderboard ({room.players.length}/{room.settings.maxPlayers})</h3>
          </div>
          <div className="player-roster">
            {room.players.map((p, idx) => {
              const isSelf = p.id === currentPlayerId;
              const isPlayerDrawing = p.id === room.currentDrawerId;
              const isPlayerHost = p.id === room.hostId;
              const hasGuessed = Boolean(p.hasGuessedThisTurn);

              return (
                <div
                  key={p.id}
                  className={`roster-item ${isSelf ? 'roster-item-self' : ''} ${
                    isPlayerDrawing ? 'roster-item-drawing' : ''
                  } ${hasGuessed ? 'roster-item-guessed' : ''}`}
                >
                  <div className="roster-rank">#{idx + 1}</div>
                  <div className="roster-avatar">
                    {['🐶', '🐱', '🦊', '🐻', '🐼', '🐯', '🦁', '🐸'][idx % 8]}
                  </div>

                  <div className="roster-details">
                    <div className="roster-name-row">
                      <span className="roster-name">
                        {p.name} {isSelf && <span className="you-tag">(You)</span>}
                        {!p.isConnected && (
                          <span style={{ fontSize: '0.75rem', color: '#e67e22', marginLeft: 4 }}>
                            (reconnecting...)
                          </span>
                        )}
                      </span>
                      {isPlayerHost && <span className="host-mini-badge" title="Host">👑</span>}
                    </div>

                    <div className="roster-role-row">
                      {isPlayerDrawing ? (
                        <span className="drawing-badge">✏️ Drawing</span>
                      ) : hasGuessed ? (
                        <span className="guessed-badge">✅ Guessed!</span>
                      ) : (
                        <span className="guesser-badge">Guesser</span>
                      )}
                      <span className="roster-score">{p.score || 0} pts</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Center Column: Canvas Arena, Banners, Controls */}
        <main className="canvas-wrapper-card">
          {/* Phase: WORD_SELECTION */}
          {room.phase === 'WORD_SELECTION' && (
            <div className="word-selection-overlay">
              {isDrawer ? (
                <div className="selection-modal">
                  <h3>Choose a word to draw</h3>
                  <p>Pick one of the words below before the timer runs out!</p>
                  <div className="word-choices-group">
                    {wordChoices.length === 0 ? (
                      <div className="spinner-group">
                        <div className="spinner" />
                        <span>Loading word choices...</span>
                      </div>
                    ) : (
                      wordChoices.map((choice) => (
                        <button
                          key={choice}
                          type="button"
                          className="btn btn-word-choice"
                          onClick={() => handleSelectWord(choice)}
                        >
                          {choice}
                        </button>
                      ))
                    )}
                  </div>
                  <span className="selection-timer">⏱️ {timer.timeLeft}s</span>
                </div>
              ) : (
                <div className="waiting-drawer-box">
                  <div className="spinner" />
                  <div className="waiting-text">
                    <strong>{drawerName}</strong> is choosing a word to draw...
                    <span className="timer-pill">⏱️ {timer.timeLeft}s left</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Phase: DRAWING */}
          {room.phase === 'DRAWING' && (
            <div className={`role-banner ${isDrawer ? 'role-drawer-banner' : 'role-viewer-banner'}`}>
              {isDrawer ? (
                <div className="banner-content">
                  <span className="banner-badge">🎨 YOUR WORD:</span>
                  <span className="secret-word-highlight">
                    {drawerSecretWord || 'DRAWING'}
                  </span>
                  <span className="banner-text">Draw it on the canvas for guessers!</span>
                </div>
              ) : (
                <div className="banner-content">
                  <span className="banner-badge">👀 GUESS THE WORD:</span>
                  <span className="masked-word-display">
                    {room.maskedWord || '—'}
                  </span>
                  <span className="word-length-hint">
                    ({room.wordLength || 0} letters)
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Phase: TURN_END */}
          {room.phase === 'TURN_END' && (
            <div className="turn-end-card">
              <span className="turn-end-icon">🔔</span>
              <div className="turn-end-details">
                <h3>Time's up!</h3>
                <p>
                  The secret word was:{' '}
                  <strong className="revealed-word">
                    {turnEndData?.word || room.revealedWord || '—'}
                  </strong>
                </p>
                {turnEndData?.nextDrawerName && (
                  <p className="next-drawer-text">
                    Next drawer: <strong>{turnEndData.nextDrawerName}</strong>
                  </p>
                )}

                {/* Score changes breakdown */}
                {turnEndData?.scoreChanges && turnEndData.scoreChanges.length > 0 && (
                  <div className="turn-end-scores">
                    <span className="scores-title">Points this turn:</span>
                    <div className="score-badges-row">
                      {turnEndData.scoreChanges.map((sc) => (
                        <div key={sc.playerId} className="sc-chip">
                          <span className="sc-name">{sc.playerName}</span>
                          <span className={`sc-delta ${sc.pointsEarned > 0 ? 'sc-delta-pos' : ''}`}>
                            {sc.pointsEarned > 0 ? `+${sc.pointsEarned}` : '0'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <span className="intermission-countdown">Next in {timer.timeLeft}s</span>
            </div>
          )}

          {/* Phase: GAME_OVER */}
          {room.phase === 'GAME_OVER' && (
            <div className="game-over-card">
              <span className="game-over-icon">🏆</span>
              <h2>Game Over!</h2>
              <p>All {room.totalRounds} rounds completed successfully.</p>

              {gameOverData && (
                <div className="final-roster">
                  <h4>Final Standings:</h4>
                  <div className="final-players-list">
                    {gameOverData.players.map((p, idx) => {
                      let rank = idx + 1;
                      if (idx > 0 && gameOverData.players[idx - 1].score === p.score) {
                        rank = idx; // Tied scores share rank
                      }
                      return (
                        <div key={p.id} className="final-player-item">
                          <span className={`rank-badge rank-${Math.min(rank, 3)}`}>#{rank}</span>
                          <span className="player-name">
                            {p.name} {idx === 0 ? '👑 Winner!' : ''}
                          </span>
                          <span className="player-score">{p.score} pts</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {isHost ? (
                <button
                  type="button"
                  className="btn btn-success btn-lg btn-return"
                  onClick={handleReturnToLobby}
                >
                  🔄 Return to Lobby
                </button>
              ) : (
                <div className="waiting-host-notice">
                  <div className="spinner" />
                  <span>Waiting for host to return to lobby...</span>
                </div>
              )}
            </div>
          )}

          {/* HTML5 Drawing Canvas */}
          <DrawingCanvas
            roomId={room.code}
            isDrawer={canDraw}
            currentColor={color}
            currentBrushSize={brushSize}
            isEraser={isEraser}
            strokes={strokes}
            onStrokesChange={setStrokes}
          />

          {/* Drawing Toolbar (Only rendered for authorized drawer during DRAWING) */}
          {canDraw && (
            <DrawingToolbar
              color={color}
              setColor={setColor}
              brushSize={brushSize}
              setBrushSize={setBrushSize}
              isEraser={isEraser}
              setIsEraser={setIsEraser}
              onUndo={handleUndo}
              onClear={handleClear}
              canUndo={strokes.length > 0}
            />
          )}

          {!canDraw && room.phase === 'DRAWING' && (
            <div className="viewer-hint-bar">
              <span>
                🔒 Drawing tools are locked. Only <strong>{drawerName}</strong> can draw this turn.
              </span>
            </div>
          )}
        </main>

        {/* Right Column: Live Chat & Guessing Panel */}
        <ChatPanel
          roomId={room.code}
          currentPlayerId={currentPlayerId}
          isDrawer={isDrawer}
          phase={room.phase}
          hasGuessedThisTurn={hasGuessedThisTurn}
          chatMessages={chatMessages}
          onSendMessage={handleSendMessage}
        />
      </div>
    </div>
  );
}
