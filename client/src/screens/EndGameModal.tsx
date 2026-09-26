import React from 'react';
import { useNavigate } from 'react-router-dom';

interface EndGameModalProps {
  result: 'checkmate' | 'stalemate';
  winner?: 'white' | 'black';
}

const EndGameModal: React.FC<EndGameModalProps> = ({ result, winner }) => {
  const navigate = useNavigate();
  let message = '';
  if (result === 'checkmate') {
    message = winner
      ? `${winner.charAt(0).toUpperCase() + winner.slice(1)} wins by checkmate!`
      : 'Checkmate!';
  } else if (result === 'stalemate') {
    message = 'Draw by stalemate!';
  }
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="end-game-title"
      style={{
        position: 'fixed',
        inset: 0,
        padding: 16,
        background: 'var(--modal-backdrop, rgba(0,0,0,0.5))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: 'var(--modal-bg, white)',
          color: 'var(--modal-fg, black)',
          border: 'var(--hud-border, none)',
          fontFamily: 'var(--hud-font, inherit)',
          padding: '2rem 3rem',
          borderRadius: 'var(--modal-radius, 16px)',
          boxShadow: 'var(--modal-shadow, 0 4px 32px rgba(0,0,0,0.18))',
          textAlign: 'center',
          maxWidth: 420,
        }}
      >
        <h2 id="end-game-title" style={{ marginBottom: 16 }}>
          {message}
        </h2>
        {/* The dialog takes focus: a keyboard player lands on its only action */}
        <button
          autoFocus
          style={{
            marginTop: 16,
            fontSize: 18,
            padding: '0.7em 2em',
            background: 'var(--button-bg, revert)',
            color: 'var(--button-fg, revert)',
            border: 'var(--button-border, revert)',
            borderRadius: 'var(--button-radius, revert)',
            fontFamily: 'inherit',
          }}
          onClick={() => navigate('/')}
        >
          Start new game
        </button>
      </div>
    </div>
  );
};

export default EndGameModal;
