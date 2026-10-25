import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { ChatMessage, GamePhase } from '../types';

interface ChatPanelProps {
  roomId: string;
  currentPlayerId: string;
  isDrawer: boolean;
  phase: GamePhase;
  hasGuessedThisTurn: boolean;
  chatMessages: ChatMessage[];
  onSendMessage: (text: string) => Promise<{ success: boolean; error?: string }>;
}

function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    ('ontouchstart' in window || navigator.maxTouchPoints > 0) &&
    window.innerWidth <= 768
  );
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  currentPlayerId,
  isDrawer,
  phase,
  hasGuessedThisTurn,
  chatMessages,
  onSendMessage,
}) => {
  const [inputText, setInputText] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isSubmittingRef = useRef<boolean>(false);
  const prevCanGuessRef = useRef<boolean>(false);

  const canGuess = phase === 'DRAWING' && !isDrawer && !hasGuessedThisTurn;

  // Auto-scroll to bottom whenever new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Focus management: when becoming eligible to guess on desktop, focus input once
  useEffect(() => {
    if (canGuess && !prevCanGuessRef.current) {
      const active = document.activeElement;
      const isControlActive =
        active &&
        active !== document.body &&
        active !== document.documentElement &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'BUTTON' ||
          active.tagName === 'SELECT' ||
          active.tagName === 'TEXTAREA');

      if (!isControlActive && !isMobileDevice()) {
        inputRef.current?.focus();
      }
    }
    prevCanGuessRef.current = canGuess;
  }, [canGuess]);

  const getPlaceholder = () => {
    if (isDrawer) {
      return 'You are drawing! Chat is disabled.';
    }
    if (hasGuessedThisTurn) {
      return 'You guessed the word! Waiting for others...';
    }
    if (phase !== 'DRAWING') {
      return 'Guessing is disabled during this phase.';
    }
    return 'Type your guess here... (Enter to send)';
  };

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = inputText.trim();
      if (!trimmed || isSubmittingRef.current || !canGuess) return;

      isSubmittingRef.current = true;
      setErrorMessage('');
      setInputText('');

      // Immediately retain focus in the input
      if (document.activeElement !== inputRef.current && !isMobileDevice()) {
        inputRef.current?.focus();
      }

      try {
        const res = await onSendMessage(trimmed);
        if (!res.success) {
          setErrorMessage(res.error || 'Failed to submit guess');
        }
      } catch {
        setErrorMessage('Network error while sending guess');
      } finally {
        isSubmittingRef.current = false;
        // Retain or restore focus if the player is still eligible to guess
        if (canGuess && !isMobileDevice()) {
          inputRef.current?.focus();
        }
      }
    },
    [inputText, canGuess, onSendMessage]
  );

  return (
    <aside className="chat-panel">
      <div className="chat-header">
        <h3>💬 Live Chat & Guesses</h3>
        <span className="chat-count">{chatMessages.length} msgs</span>
      </div>

      {/* Messages Scroll Box */}
      <div className="chat-messages-container">
        {chatMessages.length === 0 ? (
          <div className="empty-chat-notice">
            <span>No messages yet. Chat and guesses will appear here!</span>
          </div>
        ) : (
          chatMessages.map((msg) => {
            const isSelf = msg.senderId === currentPlayerId;

            if (msg.type === 'correct_guess') {
              return (
                <div key={msg.id} className="chat-item chat-item-correct">
                  <span className="correct-icon">🎉</span>
                  <span className="correct-text">{msg.text}</span>
                </div>
              );
            }

            if (msg.type === 'close_guess') {
              return (
                <div key={msg.id} className="chat-item chat-item-close">
                  <span className="close-icon">💡</span>
                  <span className="close-text">{msg.text}</span>
                </div>
              );
            }

            if (msg.type === 'system') {
              return (
                <div key={msg.id} className="chat-item chat-item-system">
                  <span className="system-icon">🔔</span>
                  <span className="system-text">{msg.text}</span>
                </div>
              );
            }

            return (
              <div
                key={msg.id}
                className={`chat-item chat-item-normal ${isSelf ? 'chat-item-self' : ''}`}
              >
                <span className="chat-time">[{msg.timestamp}]</span>
                <span className="chat-sender">{msg.senderName}:</span>
                <span className="chat-text">{msg.text}</span>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Error feedback banner */}
      {errorMessage && (
        <div className="chat-error-banner" role="alert">
          <span>⚠️ {errorMessage}</span>
        </div>
      )}

      {/* Input controls */}
      <form className="chat-input-form" onSubmit={handleSubmit}>
        <div className="chat-input-row">
          <input
            ref={inputRef}
            type="text"
            className={`chat-text-input ${!canGuess ? 'chat-input-disabled' : ''}`}
            placeholder={getPlaceholder()}
            value={inputText}
            maxLength={100}
            disabled={!canGuess}
            onChange={(e) => {
              setInputText(e.target.value);
              if (errorMessage) setErrorMessage('');
            }}
          />
          <button
            type="submit"
            className="btn btn-primary btn-chat-send"
            disabled={!canGuess || !inputText.trim()}
          >
            Send
          </button>
        </div>
        {canGuess && (
          <div className="chat-char-counter">
            <span>{inputText.length}/100</span>
          </div>
        )}
      </form>
    </aside>
  );
};
