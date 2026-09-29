import React from 'react';
import { useNavigate } from 'react-router-dom';

// The home page. A new game starts by choosing a side (/new), which asks the
// server for the game.
const StartScreen: React.FC = () => {
  const navigate = useNavigate();
  return (
    <div
      className="relative flex flex-col items-center justify-center min-h-screen p-8"
      style={{
        background: 'var(--page-bg)',
        color: 'var(--page-fg)',
        fontFamily: 'var(--hud-font)',
      }}
    >
      <div className="text-center flex flex-col items-center gap-8">
        <h1 className="text-6xl font-bold tracking-wide">3D Chess</h1>
        <button
          onClick={() => navigate('/new')}
          className="py-3 px-6 text-2xl font-semibold text-gray-900 bg-white rounded-xl hover:bg-gray-100 focus:outline-none focus:ring-4 focus:ring-blue-500 focus:ring-opacity-50 transition-all duration-200 transform hover:scale-105"
        >
          Start New Game
        </button>
      </div>
    </div>
  );
};

export default StartScreen;
