import { useEffect, useState, useRef } from 'react';
import { socket } from './socket';
import { HomePage } from './components/HomePage';
import { Lobby } from './components/Lobby';
import { GamePage } from './components/GamePage';
import type { RoomState, RoomSettings, ApiResponse, ResumeRoomData } from './types';
import './App.css';

interface LogEntry {
  id: string;
  timestamp: string;
  message: string;
  type: 'connect' | 'disconnect' | 'info';
}

const SESSION_STORAGE_KEY = 'skribbl_session';

interface StoredSession {
  roomId: string;
  playerId: string;
  playerName: string;
  reconnectToken: string;
}

function getStoredSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setStoredSession(session: StoredSession): void {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch (err) {
    console.error('Failed to save session:', err);
  }
}

function clearStoredSession(): void {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch (err) {
    console.error('Failed to clear session:', err);
  }
}

function App() {
  const [isConnected, setIsConnected] = useState<boolean>(socket.connected);
  const [socketId, setSocketId] = useState<string | undefined>(socket.id);
  const [currentRoom, setCurrentRoom] = useState<RoomState | null>(null);
  const [playerId, setPlayerId] = useState<string>('');
  const [playerName, setPlayerName] = useState<string>('');
  const [isResuming, setIsResuming] = useState<boolean>(() => Boolean(getStoredSession()));
  const [actionError, setActionError] = useState<string>('');
  const [wordChoices, setWordChoices] = useState<string[]>([]);
  const [drawerSecretWord, setDrawerSecretWord] = useState<string>('');
  const [showLogs, setShowLogs] = useState<boolean>(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  // Ref to track latest playerId to avoid stale closures in listeners
  const playerIdRef = useRef<string>(playerId);
  useEffect(() => {
    playerIdRef.current = playerId;
  }, [playerId]);

  const addLog = (message: string, type: 'connect' | 'disconnect' | 'info') => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [
      {
        id: Math.random().toString(36).substring(2, 9),
        timestamp: time,
        message,
        type,
      },
      ...prev.slice(0, 49),
    ]);
  };

  useEffect(() => {
    // Attempt session resumption on mount or connect
    const attemptResume = () => {
      const session = getStoredSession();
      if (!session) {
        setIsResuming(false);
        return;
      }

      console.log('[App] Found active session. Resuming room:', session.roomId);
      setIsResuming(true);

      socket.emit(
        'resume_room',
        {
          roomId: session.roomId,
          playerId: session.playerId,
          reconnectToken: session.reconnectToken,
        },
        (response: ApiResponse<ResumeRoomData>) => {
          setIsResuming(false);
          if (response?.success && response.data) {
            setCurrentRoom(response.data.room);
            setPlayerId(response.data.player.id);
            setPlayerName(response.data.player.name);

            if (response.data.privateData?.wordChoices) {
              setWordChoices(response.data.privateData.wordChoices);
            }
            if (response.data.privateData?.drawerWord) {
              setDrawerSecretWord(response.data.privateData.drawerWord);
            }

            addLog(
              `Session resumed in room ${response.data.room.code} as "${response.data.player.name}"`,
              'info'
            );
          } else {
            console.warn('[App] Session resume failed:', response?.error);
            clearStoredSession();
            addLog(`Session expired or room closed: ${response?.error || 'Unknown'}`, 'info');
          }
        }
      );
    };

    function onConnect() {
      setIsConnected(true);
      setSocketId(socket.id);
      addLog(`Connected with socket ID: ${socket.id}`, 'connect');
      setActionError((prev) => (prev.startsWith('Unable to connect') ? '' : prev));

      // Check if we need to resume session upon socket connection
      attemptResume();
    }

    function onDisconnect(reason: string) {
      setIsConnected(false);
      setSocketId(undefined);
      addLog(`Disconnected from server. Reason: ${reason}`, 'disconnect');
      // Notice: Do NOT immediately clear currentRoom! The server grants a 15-second grace period.
    }

    function onConnectError(error: Error) {
      addLog(`Connection error: ${error.message}`, 'disconnect');
      setIsResuming(false);
      setActionError('Unable to connect to game server. Please check your network or try again.');
    }

    function onRoomUpdated(updatedRoom: RoomState) {
      setCurrentRoom(updatedRoom);
      addLog(`Room ${updatedRoom.code} updated (${updatedRoom.players.length} players)`, 'info');
    }

    function onPlayerJoined(data: { player: { name: string }; players: any[] }) {
      addLog(`Player "${data.player.name}" entered the lobby`, 'info');
    }

    function onPlayerReconnected(data: { playerId: string; playerName: string }) {
      addLog(`Player "${data.playerName}" reconnected`, 'info');
    }

    function onPlayerDisconnected(data: { playerId: string; playerName: string }) {
      addLog(`Player "${data.playerName}" disconnected (grace period active)`, 'info');
    }

    function onPlayerLeft(data: { playerId: string; playerName: string; newHostId?: string }) {
      addLog(`Player "${data.playerName}" left the room`, 'info');

      // If current player was permanently removed (e.g. grace period expired)
      if (data.playerId === playerIdRef.current) {
        clearStoredSession();
        setCurrentRoom(null);
        setPlayerId('');
        setActionError('You were disconnected from the game.');
        return;
      }

      if (data.newHostId && playerIdRef.current === data.newHostId) {
        addLog('👑 You are now the room host!', 'info');
      }
    }

    function onGameStarted(data: { message: string }) {
      addLog(`Game started: ${data.message}`, 'info');
    }

    function onErrorMessage(data: { message: string }) {
      setActionError(data.message);
      addLog(`Notice: ${data.message}`, 'info');
    }

    function onWordChoices(data: { choices: string[] }) {
      setWordChoices(data.choices || []);
    }

    function onYourTurn(data: { word: string }) {
      setDrawerSecretWord(data.word || '');
      setWordChoices([]);
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('room_updated', onRoomUpdated);
    socket.on('player_joined', onPlayerJoined);
    socket.on('player_reconnected', onPlayerReconnected);
    socket.on('player_disconnected', onPlayerDisconnected);
    socket.on('player_left', onPlayerLeft);
    socket.on('game_started', onGameStarted);
    socket.on('error_message', onErrorMessage);
    socket.on('word_choices', onWordChoices);
    socket.on('your_turn', onYourTurn);

    if (socket.connected) {
      setIsConnected(true);
      setSocketId(socket.id);
      attemptResume();
    }

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('room_updated', onRoomUpdated);
      socket.off('player_joined', onPlayerJoined);
      socket.off('player_reconnected', onPlayerReconnected);
      socket.off('player_disconnected', onPlayerDisconnected);
      socket.off('player_left', onPlayerLeft);
      socket.off('game_started', onGameStarted);
      socket.off('error_message', onErrorMessage);
      socket.off('word_choices', onWordChoices);
      socket.off('your_turn', onYourTurn);
    };
  }, []);

  const handleRoomJoined = (
    room: RoomState,
    name: string,
    joinedPlayerId: string,
    token: string
  ) => {
    setCurrentRoom(room);
    setPlayerName(name);
    setPlayerId(joinedPlayerId);
    setActionError('');

    setStoredSession({
      roomId: room.code,
      playerId: joinedPlayerId,
      playerName: name,
      reconnectToken: token,
    });

    addLog(`Joined room ${room.code} as "${name}"`, 'info');

    // Update URL query parameter without full reload
    const newUrl = `${window.location.pathname}?room=${room.code}`;
    window.history.pushState({ path: newUrl }, '', newUrl);
  };

  const handleLeaveRoom = () => {
    if (currentRoom) {
      socket.emit('leave_room', { roomId: currentRoom.code });
      addLog(`Left room ${currentRoom.code}`, 'info');
    }
    clearStoredSession();
    setCurrentRoom(null);
    setPlayerId('');
    setActionError('');
    setWordChoices([]);
    setDrawerSecretWord('');

    // Clean URL query parameter
    window.history.pushState({}, '', window.location.pathname);
  };

  const handleUpdateSettings = (settings: Partial<RoomSettings>) => {
    if (!currentRoom) return;

    socket.emit(
      'update_settings',
      { roomId: currentRoom.code, settings },
      (response: ApiResponse<RoomSettings>) => {
        if (!response.success) {
          setActionError(response.error || 'Failed to update settings');
        }
      }
    );
  };

  const handleStartGame = () => {
    if (!currentRoom) return;
    setActionError('');

    socket.emit(
      'start_game',
      { roomId: currentRoom.code },
      (response: ApiResponse<{ message: string }>) => {
        if (!response.success) {
          setActionError(response.error || 'Failed to start game');
        }
      }
    );
  };

  const isDebugMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');

  return (
    <div className="app-layout">
      {/* Top Navigation Bar */}
      <nav className="top-nav">
        <div className="nav-brand">
          <div className="brand-logo-badge" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
            </svg>
          </div>
          <span className="brand-title">
            skribbl.io <span className="brand-badge">CLONE</span>
          </span>
        </div>

        <div className="nav-status">
          {playerName && (
            <span className="player-badge">👤 {playerName}</span>
          )}
          <div
            className="connection-pill"
            title={isConnected ? `Connected (Socket ID: ${socketId || 'unknown'})` : 'Disconnected from server'}
          >
            <span
              className={`status-dot ${isConnected ? 'status-connected' : 'status-disconnected'}`}
            />
            <span className="status-label">
              {isConnected ? 'Online' : 'Offline'}
            </span>
          </div>

          {isDebugMode && (
            <button
              className="btn btn-secondary btn-sm btn-logs-toggle"
              onClick={() => setShowLogs((prev) => !prev)}
              aria-label={showLogs ? 'Hide event logs' : 'Show event logs'}
            >
              {showLogs ? 'Hide Logs' : `Logs (${logs.length})`}
            </button>
          )}
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="main-content">
        {isResuming ? (
          <div className="home-container">
            <div className="home-card" style={{ textAlign: 'center', padding: '3rem 2rem' }}>
              <div className="avatar-preview">
                <span className="avatar-emoji">🔄</span>
              </div>
              <h2 style={{ marginBottom: '0.75rem', color: '#2c3e50' }}>Reconnecting to Game...</h2>
              <p style={{ color: '#7f8c8d' }}>Restoring your seat and game state, please wait.</p>
              <div style={{ marginTop: '1.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    clearStoredSession();
                    setIsResuming(false);
                    setCurrentRoom(null);
                  }}
                >
                  Cancel and Return to Home
                </button>
              </div>
            </div>
          </div>
        ) : !currentRoom ? (
          <HomePage onRoomJoined={handleRoomJoined} initialError={actionError} />
        ) : currentRoom.phase !== 'LOBBY' ? (
          <GamePage
            room={currentRoom}
            currentPlayerId={playerId}
            currentSocketId={socketId || ''}
            onLeaveRoom={handleLeaveRoom}
            initialWordChoices={wordChoices}
            initialSecretWord={drawerSecretWord}
          />
        ) : (
          <Lobby
            room={currentRoom}
            currentPlayerId={playerId}
            currentSocketId={socketId || ''}
            onLeaveRoom={handleLeaveRoom}
            onUpdateSettings={handleUpdateSettings}
            onStartGame={handleStartGame}
            actionError={actionError}
          />
        )}
      </main>

      {/* Collapsible Connection Log Drawer */}
      {showLogs && (
        <section className="logs-drawer">
          <div className="logs-header">
            <h3>Socket Activity Log</h3>
            <button className="btn btn-secondary btn-sm" onClick={() => setLogs([])}>
              Clear
            </button>
          </div>
          <div className="log-list">
            {logs.length === 0 ? (
              <p className="empty-log">No socket activity recorded yet.</p>
            ) : (
              logs.map((log) => (
                <div key={log.id} className={`log-item log-${log.type}`}>
                  <span className="log-time">[{log.timestamp}]</span>
                  <span className="log-message">{log.message}</span>
                </div>
              ))
            )}
          </div>
        </section>
      )}
    </div>
  );
}

export default App;
