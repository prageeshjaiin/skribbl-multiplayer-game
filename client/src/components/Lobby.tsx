import { useState } from 'react';
import type { RoomState, RoomSettings } from '../types';

interface LobbyProps {
  room: RoomState;
  currentPlayerId: string;
  currentSocketId?: string;
  onLeaveRoom: () => void;
  onUpdateSettings: (newSettings: Partial<RoomSettings>) => void;
  onStartGame: () => void;
  actionError?: string;
}

export function Lobby({
  room,
  currentPlayerId,
  onLeaveRoom,
  onUpdateSettings,
  onStartGame,
  actionError,
}: LobbyProps) {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const isHost = room.hostId === currentPlayerId;
  const canStart = isHost && room.players.length >= 2 && room.phase === 'LOBBY';

  const handleCopyLink = async () => {
    const inviteUrl = `${window.location.origin}/?room=${room.code}`;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (err) {
      console.error('Failed to copy invite URL:', err);
    }
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch (err) {
      console.error('Failed to copy room code:', err);
    }
  };

  const handleSettingChange = (key: keyof RoomSettings, value: number) => {
    if (!isHost) return;
    onUpdateSettings({ [key]: value });
  };

  return (
    <div className="lobby-container">
      {/* Top Bar */}
      <header className="lobby-header">
        <div className="lobby-room-badge-group">
          <span className="room-label">ROOM CODE</span>
          <span className="room-code-tag">{room.code}</span>
          <button
            className="btn btn-sm btn-outline"
            onClick={handleCopyCode}
            title="Copy Room Code"
          >
            {copiedCode ? '✓ Copied' : '📋 Code'}
          </button>
          <button
            className="btn btn-sm btn-outline"
            onClick={handleCopyLink}
            title="Copy Shareable Invite Link"
          >
            {copiedLink ? '✓ Copied Link' : '🔗 Invite Link'}
          </button>
        </div>

        <button className="btn btn-sm btn-danger" onClick={onLeaveRoom}>
          Leave Room
        </button>
      </header>

      {/* Action / Error Banner */}
      {actionError && (
        <div className="alert-box alert-error">
          <span>⚠️ {actionError}</span>
        </div>
      )}

      {/* Game Started Notice */}
      {room.phase !== 'LOBBY' && (
        <div className="alert-box alert-success game-started-banner">
          <span className="banner-icon">🎉</span>
          <div>
            <strong>The game has officially started!</strong>
            <p>Phase 2 room coordination and host validation succeeded. Phase 3 will introduce canvas drawing and guessing.</p>
          </div>
        </div>
      )}

      <div className="lobby-grid">
        {/* Left Card: Players List */}
        <section className="lobby-card players-card">
          <div className="card-title-row">
            <h2>Players ({room.players.length}/{room.settings.maxPlayers})</h2>
            <span className="badge-pill">
              {room.players.length < 2 ? 'Waiting for players' : 'Ready'}
            </span>
          </div>

          <div className="player-list">
            {room.players.map((player, idx) => {
              const isCurrentUser = player.id === currentPlayerId;
              const isPlayerHost = player.id === room.hostId;

              return (
                <div
                  key={player.id}
                  className={`player-item ${isCurrentUser ? 'player-item-self' : ''}`}
                >
                  <div className="player-avatar">
                    {['🐶', '🐱', '🦊', '🐻', '🐼', '🐯', '🦁', '🐸'][idx % 8]}
                  </div>
                  <div className="player-info">
                    <span className="player-name">
                      {player.name} {isCurrentUser && <span className="you-tag">(You)</span>}
                      {!player.isConnected && (
                        <span className="reconnecting-tag" style={{ marginLeft: 6, fontSize: '0.75rem', color: '#e67e22' }}>
                          (reconnecting...)
                        </span>
                      )}
                    </span>
                    <span className="player-role">
                      {isPlayerHost ? (
                        <span className="host-badge">👑 Room Host</span>
                      ) : (
                        <span className="guesser-badge">Player</span>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {room.players.length < 2 && (
            <p className="hint-text">
              💡 Share the invite link with at least 1 friend to begin!
            </p>
          )}
        </section>

        {/* Right Card: Room Settings */}
        <section className="lobby-card settings-card">
          <div className="card-title-row">
            <h2>Game Settings</h2>
            <span className="badge-pill">
              {isHost ? '👑 Host Controls' : '👀 Host-Configured'}
            </span>
          </div>

          {!isHost && (
            <p className="settings-notice">
              Only the room host can customize these settings. Updates sync live.
            </p>
          )}

          <div className="settings-form">
            {/* Setting: Max Players */}
            <div className="setting-item">
              <div className="setting-header">
                <label className="setting-label">Max Players</label>
                <span className="setting-value">{room.settings.maxPlayers} players</span>
              </div>
              {isHost ? (
                <>
                  <input
                    type="range"
                    min={2}
                    max={20}
                    step={1}
                    value={room.settings.maxPlayers}
                    onChange={(e) => handleSettingChange('maxPlayers', Number(e.target.value))}
                    className="slider"
                  />
                  {room.players.length > 2 && (
                    <span className="setting-subtext" style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem', display: 'block' }}>
                      Current occupancy: {room.players.length} players (cannot be set below {room.players.length})
                    </span>
                  )}
                </>
              ) : (
                <div className="read-only-bar" style={{ width: `${(room.settings.maxPlayers / 20) * 100}%` }} />
              )}
            </div>

            {/* Setting: Rounds */}
            <div className="setting-item">
              <div className="setting-header">
                <label className="setting-label">Rounds</label>
                <span className="setting-value">{room.settings.rounds} rounds</span>
              </div>
              {isHost ? (
                <input
                  type="range"
                  min={2}
                  max={10}
                  step={1}
                  value={room.settings.rounds}
                  onChange={(e) => handleSettingChange('rounds', Number(e.target.value))}
                  className="slider"
                />
              ) : (
                <div className="read-only-bar" style={{ width: `${(room.settings.rounds / 10) * 100}%` }} />
              )}
            </div>

            {/* Setting: Drawing Time */}
            <div className="setting-item">
              <div className="setting-header">
                <label className="setting-label">Drawing Time</label>
                <span className="setting-value">{room.settings.drawTime} seconds</span>
              </div>
              {isHost ? (
                <input
                  type="range"
                  min={15}
                  max={240}
                  step={5}
                  value={room.settings.drawTime}
                  onChange={(e) => handleSettingChange('drawTime', Number(e.target.value))}
                  className="slider"
                />
              ) : (
                <div className="read-only-bar" style={{ width: `${(room.settings.drawTime / 240) * 100}%` }} />
              )}
            </div>

            {/* Setting: Word Choices */}
            <div className="setting-item">
              <div className="setting-header">
                <label className="setting-label">Word Choices</label>
                <span className="setting-value">{room.settings.wordChoices} choices</span>
              </div>
              {isHost ? (
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={1}
                  value={room.settings.wordChoices}
                  onChange={(e) => handleSettingChange('wordChoices', Number(e.target.value))}
                  className="slider"
                />
              ) : (
                <div className="read-only-bar" style={{ width: `${(room.settings.wordChoices / 5) * 100}%` }} />
              )}
            </div>

            {/* Setting: Hints */}
            <div className="setting-item">
              <div className="setting-header">
                <label className="setting-label">Hints</label>
                <span className="setting-value">{room.settings.hints} hints</span>
              </div>
              {isHost ? (
                <input
                  type="range"
                  min={0}
                  max={5}
                  step={1}
                  value={room.settings.hints}
                  onChange={(e) => handleSettingChange('hints', Number(e.target.value))}
                  className="slider"
                />
              ) : (
                <div className="read-only-bar" style={{ width: `${(room.settings.hints / 5) * 100}%` }} />
              )}
            </div>
          </div>

          {/* Action Row */}
          <div className="lobby-actions">
            {isHost ? (
              <div>
                <button
                  className="btn btn-success btn-lg btn-block"
                  onClick={onStartGame}
                  disabled={!canStart}
                >
                  🚀 Start Game
                </button>
                {room.players.length < 2 && (
                  <p className="start-hint">At least 2 players are required to start the game.</p>
                )}
              </div>
            ) : (
              <div className="waiting-host-card">
                <div className="spinner" />
                <span>Waiting for host to start the game...</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
