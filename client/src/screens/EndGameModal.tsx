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
        background: 'var(--modal-backdrop)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: 'var(--modal-bg)',
          color: 'var(--modal-fg)',
          border: 'var(--hud-border)',
          fontFamily: 'var(--hud-font)',
          padding: '2rem 3rem',
          borderRadius: 'var(--modal-radius)',
          boxShadow: 'var(--modal-shadow)',
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
            background: 'var(--button-bg)',
            color: 'var(--button-fg)',
            border: 'var(--button-border)',
            borderRadius: 'var(--button-radius)',
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
