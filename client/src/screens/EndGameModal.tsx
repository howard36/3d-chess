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
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: 'white',
          color: 'black',
          padding: '2rem 3rem',
          borderRadius: 16,
          boxShadow: '0 4px 32px rgba(0,0,0,0.18)',
          textAlign: 'center',
          minWidth: 300,
        }}
      >
        <h2 style={{ marginBottom: 16 }}>{message}</h2>
        <button
          style={{ marginTop: 16, fontSize: 18, padding: '0.7em 2em' }}
          onClick={() => navigate('/')}
        >
          Start new game
        </button>
      </div>
    </div>
  );
};

export default EndGameModal;
