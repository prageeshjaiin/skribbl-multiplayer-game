import { useState, useEffect } from 'react';
import { socket } from '../socket';
import type { ApiResponse, RoomState, RoomJoinData } from '../types';
import './HomePage.css';

interface HomePageProps {
  onRoomJoined: (room: RoomState, playerName: string, playerId: string, reconnectToken: string) => void;
  initialError?: string;
}

// Skribbl-style avatar customization options
const AVATAR_COLORS = [
  '#facc15', // Skribbl Yellow
  '#38bdf8', // Sky Blue
  '#4ade80', // Mint Green
  '#f87171', // Coral Red
  '#c084fc', // Lavender Purple
  '#fb923c', // Warm Orange
  '#f472b6', // Bubblegum Pink
  '#2dd4bf', // Teal
];

export function HomePage({ onRoomJoined, initialError }: HomePageProps) {
  const [playerName, setPlayerName] = useState<string>('');
  const [roomCode, setRoomCode] = useState<string>('');
  const [loadingAction, setLoadingAction] = useState<'create' | 'join' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>(initialError || '');

  // Skribbl-style avatar state
  const [avatarColorIdx, setAvatarColorIdx] = useState<number>(0);
  const [avatarEyeIdx, setAvatarEyeIdx] = useState<number>(0);
  const [avatarMouthIdx, setAvatarMouthIdx] = useState<number>(0);

  // Detect ?room=CODE in URL query params on initial mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const queryRoom = params.get('room');
    if (queryRoom) {
      setRoomCode(queryRoom.trim().toUpperCase());
    }
  }, []);

  useEffect(() => {
    if (initialError) {
      setErrorMessage(initialError);
    }
  }, [initialError]);

  const cycleColor = (direction: 1 | -1) => {
    setAvatarColorIdx((prev) => (prev + direction + AVATAR_COLORS.length) % AVATAR_COLORS.length);
  };

  const cycleEyes = (direction: 1 | -1) => {
    setAvatarEyeIdx((prev) => (prev + direction + 4) % 4);
  };

  const cycleMouth = (direction: 1 | -1) => {
    setAvatarMouthIdx((prev) => (prev + direction + 4) % 4);
  };

  const randomizeAvatar = () => {
    setAvatarColorIdx(Math.floor(Math.random() * AVATAR_COLORS.length));
    setAvatarEyeIdx(Math.floor(Math.random() * 4));
    setAvatarMouthIdx(Math.floor(Math.random() * 4));
  };

  const handleCreateRoom = () => {
    const trimmedName = playerName.trim();
    if (!trimmedName) {
      setErrorMessage('Please enter your name first.');
      return;
    }

    setErrorMessage('');
    setLoadingAction('create');

    socket.emit(
      'create_room',
      { playerName: trimmedName },
      (response: ApiResponse<RoomJoinData>) => {
        setLoadingAction(null);
        if (response.success && response.data) {
          onRoomJoined(
            response.data.room,
            response.data.player.name,
            response.data.player.id,
            response.data.reconnectToken
          );
        } else {
          setErrorMessage(response.error || 'Failed to create room.');
        }
      }
    );
  };

  const handleJoinRoom = () => {
    const trimmedName = playerName.trim();
    const cleanCode = roomCode.trim().toUpperCase();

    if (!trimmedName) {
      setErrorMessage('Please enter your name first.');
      return;
    }
    if (!cleanCode) {
      setErrorMessage('Please enter a 6-character room code.');
      return;
    }

    setErrorMessage('');
    setLoadingAction('join');

    socket.emit(
      'join_room',
      { roomId: cleanCode, playerName: trimmedName },
      (response: ApiResponse<RoomJoinData>) => {
        setLoadingAction(null);
        if (response.success && response.data) {
          onRoomJoined(
            response.data.room,
            response.data.player.name,
            response.data.player.id,
            response.data.reconnectToken
          );
        } else {
          setErrorMessage(response.error || 'Could not join room.');
        }
      }
    );
  };

  const currentColor = AVATAR_COLORS[avatarColorIdx];

  return (
    <div className="home-page-root">
      {/* Background Sketched Doodles (skribbl.io aesthetic) */}
      <div className="bg-doodles-container" aria-hidden="true">
        {/* Sketched Pencil with squiggle */}
        <svg className="bg-sketch sketch-pencil" viewBox="0 0 100 80" fill="none">
          <path d="M10 70 Q 30 60, 50 72 T 90 65" stroke="#94a3b8" strokeWidth="2.5" strokeDasharray="4 4" strokeLinecap="round" />
          <g transform="translate(45, 15) rotate(25)">
            <rect x="0" y="0" width="12" height="35" rx="2" fill="#fbbf24" stroke="#475569" strokeWidth="2" />
            <polygon points="0,35 12,35 6,48" fill="#fde68a" stroke="#475569" strokeWidth="2" />
            <polygon points="4,44 8,44 6,48" fill="#1e293b" />
            <rect x="0" y="-8" width="12" height="8" rx="2" fill="#f43f5e" stroke="#475569" strokeWidth="2" />
          </g>
        </svg>

        {/* Sketched Paint Palette */}
        <svg className="bg-sketch sketch-palette" viewBox="0 0 90 80" fill="none">
          <path d="M45 10 C 65 10, 80 25, 80 45 C 80 65, 65 75, 45 75 C 35 75, 25 70, 20 60 C 15 50, 18 40, 15 35 C 10 25, 25 10, 45 10 Z" fill="#ffffff" stroke="#64748b" strokeWidth="2.5" />
          <circle cx="35" cy="25" r="5" fill="#ef4444" />
          <circle cx="55" cy="25" r="5" fill="#3b82f6" />
          <circle cx="68" cy="42" r="5" fill="#10b981" />
          <circle cx="58" cy="60" r="5" fill="#f59e0b" />
          <circle cx="28" cy="45" r="5" fill="#8b5cf6" />
        </svg>

        {/* Sketched Speech Bubble with "cat?" */}
        <svg className="bg-sketch sketch-bubble" viewBox="0 0 90 60" fill="none">
          <path d="M10 15 C 10 5, 80 5, 80 15 C 80 30, 60 35, 45 35 L 30 48 L 32 35 C 15 35, 10 30, 10 15 Z" fill="#ffffff" stroke="#64748b" strokeWidth="2" strokeLinejoin="round" />
          <text x="32" y="24" fontFamily="'Comic Sans MS', 'Chalkboard SE', cursive, sans-serif" fontSize="13" fontWeight="bold" fill="#2563eb">cat? 🐱</text>
        </svg>

        {/* Sketched Stars & Lightbulb */}
        <svg className="bg-sketch sketch-star-1" viewBox="0 0 40 40" fill="none">
          <path d="M20 2 L 24 14 L 38 16 L 27 24 L 31 38 L 20 29 L 9 38 L 13 24 L 2 16 L 16 14 Z" stroke="#eab308" strokeWidth="2.5" fill="#fef08a" strokeLinejoin="round" />
        </svg>

        <svg className="bg-sketch sketch-star-2" viewBox="0 0 30 30" fill="none">
          <path d="M15 2 L 18 10 L 27 12 L 20 18 L 22 27 L 15 21 L 8 27 L 10 18 L 3 12 L 12 10 Z" stroke="#3b82f6" strokeWidth="2" fill="#dbeafe" strokeLinejoin="round" />
        </svg>
      </div>

      <div className="home-layout-grid">
        {/* ==================================================================
            LEFT COLUMN — HERO SECTION
            ================================================================== */}
        <div className="hero-column">
          <div className="hero-eyebrow">
            <span className="eyebrow-sparkle">✏️</span>
            <span>DRAW • GUESS • REPEAT</span>
          </div>

          <h1 className="hero-title">
            A little drawing.<br />
            <span className="hero-highlight">A lot of guessing.</span>
          </h1>

          <p className="hero-subtitle">
            Create private rooms, invite your friends, sketch wacky clues, and race the clock to guess the secret word in real time!
          </p>

          {/* Three Feature / Benefit Badges */}
          <div className="hero-benefits">
            <div className="benefit-card">
              <div className="benefit-icon-wrapper blue" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                </svg>
              </div>
              <div className="benefit-text-group">
                <span className="benefit-title">Real-Time Multiplayer</span>
                <span className="benefit-desc">Low-latency canvas stroke broadcasting for ultra-smooth live drawing.</span>
              </div>
            </div>

            <div className="benefit-card">
              <div className="benefit-icon-wrapper emerald" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
              </div>
              <div className="benefit-text-group">
                <span className="benefit-title">Private Rooms with Friends</span>
                <span className="benefit-desc">Custom rounds, flexible draw timers, and shareable 6-character room codes.</span>
              </div>
            </div>

            <div className="benefit-card">
              <div className="benefit-icon-wrapper amber" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9"></path>
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                </svg>
              </div>
              <div className="benefit-text-group">
                <span className="benefit-title">Live Drawing & Guessing</span>
                <span className="benefit-desc">Progressive letter reveals, fast-guesser bonus points, and live chat.</span>
              </div>
            </div>
          </div>

          {/* Sketchpad Illustration Card with Hand-Drawn Theme */}
          <div className="hero-illustration-card">
            <span className="floating-doodle doodle-star" aria-hidden="true">⭐</span>
            <span className="floating-doodle doodle-palette" aria-hidden="true">🎨</span>

            <div className="illustration-canvas-wrap">
              {/* Skribbl-style hand-drawn easel canvas */}
              <svg className="sketchpad-svg" viewBox="0 0 140 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                {/* Clipboard Backing */}
                <rect x="10" y="10" width="120" height="100" rx="10" fill="#f8fafc" stroke="#475569" strokeWidth="2.5" />
                {/* Canvas Sheet */}
                <rect x="18" y="20" width="104" height="82" rx="4" fill="#ffffff" stroke="#cbd5e1" strokeWidth="1.5" />
                {/* Clip at top */}
                <rect x="52" y="6" width="36" height="12" rx="3" fill="#334155" />
                <rect x="62" y="9" width="16" height="6" rx="2" fill="#94a3b8" />
                {/* Skribbl Word Blanks at Top */}
                <text x="32" y="36" fontFamily="monospace" fontSize="11" fontWeight="bold" fill="#64748b">_ _ N _ _ _</text>
                {/* Drawn Doodle: Smiling Sunflower with sunglasses */}
                <circle cx="70" cy="62" r="15" fill="#fef08a" stroke="#ca8a04" strokeWidth="2" />
                {/* Petals */}
                <path d="M70 42 C67 46, 73 46, 70 42 Z M70 82 C67 78, 73 78, 70 82 Z M50 62 C54 59, 54 65, 50 62 Z M90 62 C86 59, 86 65, 90 62 Z" fill="#eab308" />
                {/* Sunglasses */}
                <path d="M62 60 H78" stroke="#0f172a" strokeWidth="2.5" strokeLinecap="round" />
                <rect x="62" y="60" width="6" height="5" rx="1.5" fill="#0f172a" />
                <rect x="71" y="60" width="6" height="5" rx="1.5" fill="#0f172a" />
                {/* Smile */}
                <path d="M66 69 Q 70 73, 74 69" stroke="#0f172a" strokeWidth="1.8" strokeLinecap="round" />
                {/* Color swatches */}
                <circle cx="28" cy="94" r="4" fill="#ef4444" />
                <circle cx="40" cy="94" r="4" fill="#3b82f6" />
                <circle cx="52" cy="94" r="4" fill="#10b981" />
                <circle cx="64" cy="94" r="4" fill="#f59e0b" />
                <circle cx="76" cy="94" r="4" fill="#8b5cf6" />
                {/* Pencil */}
                <line x1="88" y1="92" x2="114" y2="78" stroke="#f97316" strokeWidth="4" strokeLinecap="round" />
                <polygon points="114,78 118,76 115,80" fill="#facc15" />
              </svg>

              <div className="illustration-caption-group">
                <span className="caption-tag">
                  <span>✓</span> Turn Complete!
                </span>
                <span className="caption-quote">"Is it a sunflower wearing shades? 🌻"</span>
                <span className="caption-sub">Player Bob guessed the secret word (+500 pts)</span>
              </div>
            </div>
          </div>
        </div>

        {/* ==================================================================
            RIGHT COLUMN — PLAY CARD (Skribbl.io Style)
            ================================================================== */}
        <div className="play-card">
          {/* Classic Skribbl.io Hand-Drawn Avatar Customizer */}
          <div className="skribbl-avatar-customizer">
            <div className="avatar-preview-box">
              {/* Interactive Vector Skribbl Avatar Doodle */}
              <svg className="skribbl-avatar-svg" viewBox="0 0 100 100" fill="none">
                {/* Body blob with hand-drawn wobble */}
                <path
                  d="M50 12 C 72 12, 88 28, 88 50 C 88 72, 72 88, 50 88 C 28 88, 12 72, 12 50 C 12 28, 28 12, 50 12 Z"
                  fill={currentColor}
                  stroke="#1e293b"
                  strokeWidth="3.5"
                  strokeLinejoin="round"
                />
                {/* Subtle highlight */}
                <path
                  d="M26 28 C 34 20, 48 18, 56 18"
                  stroke="#ffffff"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  opacity="0.6"
                />

                {/* Eyes Variants */}
                {avatarEyeIdx === 0 && (
                  /* Classic big dots */
                  <g fill="#0f172a">
                    <circle cx="38" cy="44" r="5" />
                    <circle cx="62" cy="44" r="5" />
                    <circle cx="40" cy="42" r="1.5" fill="#ffffff" />
                    <circle cx="64" cy="42" r="1.5" fill="#ffffff" />
                  </g>
                )}
                {avatarEyeIdx === 1 && (
                  /* Wink */
                  <g stroke="#0f172a" strokeWidth="3" strokeLinecap="round">
                    <circle cx="38" cy="44" r="4.5" fill="#0f172a" stroke="none" />
                    <path d="M57 44 Q 63 40, 68 44" fill="none" />
                  </g>
                )}
                {avatarEyeIdx === 2 && (
                  /* Cool Sunglasses */
                  <g>
                    <path d="M30 42 H70" stroke="#0f172a" strokeWidth="3" strokeLinecap="round" />
                    <rect x="32" y="41" width="14" height="11" rx="3" fill="#0f172a" />
                    <rect x="54" y="41" width="14" height="11" rx="3" fill="#0f172a" />
                    <line x1="34" y1="44" x2="42" y2="44" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
                  </g>
                )}
                {avatarEyeIdx === 3 && (
                  /* Happy curved eyes ^ ^ */
                  <g stroke="#0f172a" strokeWidth="3.5" strokeLinecap="round" fill="none">
                    <path d="M32 46 Q 38 38, 44 46" />
                    <path d="M56 46 Q 62 38, 68 46" />
                  </g>
                )}

                {/* Mouth Variants */}
                {avatarMouthIdx === 0 && (
                  /* Classic Smile */
                  <path d="M40 60 Q 50 72, 60 60" stroke="#0f172a" strokeWidth="3.5" strokeLinecap="round" fill="none" />
                )}
                {avatarMouthIdx === 1 && (
                  /* Big Open Grin */
                  <path d="M38 58 Q 50 78, 62 58 Z" fill="#0f172a" stroke="#0f172a" strokeWidth="2" strokeLinejoin="round" />
                )}
                {avatarMouthIdx === 2 && (
                  /* Tongue Out (Classic skribbl.io) */
                  <g>
                    <path d="M38 60 Q 50 70, 62 60" stroke="#0f172a" strokeWidth="3.5" strokeLinecap="round" fill="none" />
                    <path d="M47 65 C 47 74, 53 74, 53 65 Z" fill="#f43f5e" stroke="#0f172a" strokeWidth="2" />
                  </g>
                )}
                {avatarMouthIdx === 3 && (
                  /* Cheeky Smirk */
                  <path d="M42 63 Q 54 67, 60 57" stroke="#0f172a" strokeWidth="3.5" strokeLinecap="round" fill="none" />
                )}
              </svg>
            </div>

            {/* Skribbl Arrow Controls (< and > for Color, Eyes, Mouth) */}
            <div className="avatar-controls-grid">
              {/* Color Control */}
              <div className="customizer-row">
                <button
                  type="button"
                  className="arrow-btn"
                  onClick={() => cycleColor(-1)}
                  aria-label="Previous color"
                >
                  ◀
                </button>
                <span className="control-label">Color</span>
                <button
                  type="button"
                  className="arrow-btn"
                  onClick={() => cycleColor(1)}
                  aria-label="Next color"
                >
                  ▶
                </button>
              </div>

              {/* Eyes Control */}
              <div className="customizer-row">
                <button
                  type="button"
                  className="arrow-btn"
                  onClick={() => cycleEyes(-1)}
                  aria-label="Previous eyes"
                >
                  ◀
                </button>
                <span className="control-label">Eyes</span>
                <button
                  type="button"
                  className="arrow-btn"
                  onClick={() => cycleEyes(1)}
                  aria-label="Next eyes"
                >
                  ▶
                </button>
              </div>

              {/* Mouth Control */}
              <div className="customizer-row">
                <button
                  type="button"
                  className="arrow-btn"
                  onClick={() => cycleMouth(-1)}
                  aria-label="Previous mouth"
                >
                  ◀
                </button>
                <span className="control-label">Mouth</span>
                <button
                  type="button"
                  className="arrow-btn"
                  onClick={() => cycleMouth(1)}
                  aria-label="Next mouth"
                >
                  ▶
                </button>
              </div>

              {/* Randomize Button */}
              <button
                type="button"
                className="randomize-avatar-btn"
                onClick={randomizeAvatar}
                title="Randomize avatar"
              >
                🎲 Random
              </button>
            </div>
          </div>

          {/* Error Message Box */}
          {errorMessage && (
            <div className="home-error-banner" role="alert" aria-live="polite">
              <span className="error-banner-icon" aria-hidden="true">⚠️</span>
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Nickname Input */}
          <div className="form-field-group">
            <div className="form-label-row">
              <label htmlFor="playerNameInput" className="form-field-label">
                Your Nickname
              </label>
              <span className="form-field-counter" aria-hidden="true">
                {playerName.length}/18
              </span>
            </div>
            <div className="input-with-icon">
              <span className="input-icon-prefix" aria-hidden="true">✏️</span>
              <input
                id="playerNameInput"
                type="text"
                className="text-input-field"
                placeholder="Enter your player name..."
                maxLength={18}
                value={playerName}
                onChange={(e) => {
                  setPlayerName(e.target.value);
                  if (errorMessage) setErrorMessage('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (roomCode.trim()) {
                      handleJoinRoom();
                    } else {
                      handleCreateRoom();
                    }
                  }
                }}
                autoFocus
                autoComplete="nickname"
                spellCheck={false}
              />
            </div>
          </div>

          {/* Action Cards Container */}
          <div className="actions-container">
            {/* Create Room Box */}
            <div className="action-panel-card action-panel-create">
              <div className="panel-header-row">
                <h3 className="panel-title">
                  <span>✨</span> Start a New Game
                </h3>
                <span className="panel-badge host">Host</span>
              </div>
              <p className="panel-desc">
                Create a private room with customizable settings and invite friends to play.
              </p>
              <button
                type="button"
                className="btn-action-primary"
                onClick={handleCreateRoom}
                disabled={loadingAction !== null}
              >
                {loadingAction === 'create' ? (
                  <>
                    <span className="spinner-icon" aria-hidden="true" />
                    <span>Creating Room...</span>
                  </>
                ) : (
                  <span>✨ Create Private Room</span>
                )}
              </button>
            </div>

            {/* Divider with Sketched Squiggle */}
            <div className="or-divider" aria-hidden="true">
              <span>OR JOIN WITH CODE</span>
            </div>

            {/* Join Room Box */}
            <div className="action-panel-card action-panel-join">
              <div className="panel-header-row">
                <h3 className="panel-title">
                  <span>🚀</span> Join an Existing Game
                </h3>
                <span className="panel-badge friend">Friend</span>
              </div>
              <p className="panel-desc">
                Have a 6-character code from a host? Enter it below to join the room.
              </p>
              <div className="room-code-input-group">
                <input
                  type="text"
                  className="room-code-input"
                  placeholder="ROOM CODE"
                  maxLength={6}
                  value={roomCode}
                  onChange={(e) => {
                    setRoomCode(e.target.value.toUpperCase());
                    if (errorMessage) setErrorMessage('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleJoinRoom();
                  }}
                  aria-label="6-character room code"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="btn-action-join"
                  onClick={handleJoinRoom}
                  disabled={loadingAction !== null}
                >
                  {loadingAction === 'join' ? (
                    <>
                      <span className="spinner-icon" aria-hidden="true" />
                      <span>Joining...</span>
                    </>
                  ) : (
                    <span>🚀 Join Room</span>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Footer Tip */}
          <div className="play-card-footer">
            <span className="footer-tip-icon" aria-hidden="true">💡</span>
            <p className="footer-tip-text">
              Rooms are private by default. As host, you can customize round count, draw duration, and letter hints in the lobby.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
