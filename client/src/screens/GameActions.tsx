import React from 'react';
import type { DrawOfferState } from '../game/ending';
import type { Color } from '../types/messages';

interface GameActionsProps {
  /** This player's colour. */
  seat: Color;
  /** The draw offer since the last move (game/ending.ts). */
  offer: DrawOfferState;
  /** Nothing can be sent now (the connection is down, or not yet back in the game). */
  disabled: boolean;
  onResign: () => void;
  onOfferDraw: () => void;
  /** Answers the opponent's standing offer. */
  onAnswerDraw: (accept: boolean) => void;
}

/** A click this soon after "Resign" turned into its question is the same click, doubled: ignored. */
const CONFIRM_ARMS_MS = 350;

/** A white flag on its staff. */
const Flag = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
    <path d="M4 14.5V2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path
      d="M4.6 2.6c2.6-1.2 4.2 1 6.9-.2v6.2c-2.7 1.2-4.3-1-6.9.2z"
      fill="currentColor"
      fillOpacity="0.85"
    />
  </svg>
);

/**
 * Resigning and draws, in a game under way: a flag under the way to the
 * tutorial (index.css, .hud-game) opens a small menu, "Offer draw" and
 * "Resign", and resigning asks once more ("Resign?"), so a stray click never
 * ends the game. Under the flag, while it applies: the player's own offer
 * waiting ("Draw offered"), declined ("Draw declined"), or the opponent's,
 * with Accept and Decline. Never takes focus on its own; a screen reader
 * hears the offers through a polite live region.
 */
const GameActions: React.FC<GameActionsProps> = ({
  seat,
  offer,
  disabled,
  onResign,
  onOfferDraw,
  onAnswerDraw,
}) => {
  const [open, setOpen] = React.useState(false);
  // When "Resign" turned into its question (null: not asked)
  const [askedAt, setAskedAt] = React.useState<number | null>(null);
  const root = React.useRef<HTMLDivElement>(null);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const close = React.useCallback((refocus: boolean) => {
    setOpen(false);
    setAskedAt(null);
    if (refocus) trigger.current?.focus();
  }, []);

  // Put away by a press anywhere else, and whenever nothing can be sent
  React.useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open, close]);
  React.useEffect(() => {
    if (disabled) close(false);
  }, [disabled, close]);

  const theirs = offer.standing !== null && offer.standing !== seat;
  const mine = offer.standing === seat;
  const said = theirs
    ? 'Your opponent offers a draw.'
    : mine
      ? 'Draw offered.'
      : offer.declined === seat
        ? 'Draw declined.'
        : '';

  return (
    <div
      ref={root}
      className="hud-game"
      data-testid="game-actions"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          close(true);
        }
      }}
    >
      <button
        ref={trigger}
        className="hud-game-menu"
        aria-label="Resign or offer a draw"
        title="Resign or offer a draw"
        aria-expanded={open}
        aria-controls="game-menu"
        disabled={disabled}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <Flag />
      </button>
      {open && (
        <div id="game-menu" className="hud-menu hud-glass" role="group" aria-label="Game">
          {askedAt === null ? (
            <>
              <button
                className="hud-menu-item"
                disabled={!offer.canOffer}
                onClick={() => {
                  onOfferDraw();
                  close(true);
                }}
              >
                {mine ? 'Draw offered' : 'Offer draw'}
              </button>
              <button className="hud-menu-item" onClick={() => setAskedAt(performance.now())}>
                Resign
              </button>
            </>
          ) : (
            <>
              <p className="hud-menu-ask" id="resign-ask">
                Resign?
              </p>
              <div className="hud-menu-row" role="group" aria-labelledby="resign-ask">
                {/* Focus lands on the safe answer */}
                <button autoFocus className="hud-menu-item" onClick={() => close(true)}>
                  Cancel
                </button>
                <button
                  className="hud-menu-item"
                  data-danger=""
                  onClick={() => {
                    if (performance.now() - askedAt < CONFIRM_ARMS_MS) return;
                    onResign();
                    close(false);
                  }}
                >
                  Resign
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {mine && (
        <div className="hud-line hud-glass" data-testid="draw-pending">
          <span className="hud-dot" aria-hidden />
          Draw offered
        </div>
      )}
      {!mine && offer.declined === seat && (
        <div className="hud-line hud-glass" data-testid="draw-declined">
          Draw declined
        </div>
      )}
      {theirs && (
        <div className="hud-offer hud-glass" data-testid="draw-offer">
          <span className="hud-offer-words">Draw offered</span>
          <span className="hud-offer-answers">
            <button
              className="hud-menu-item"
              data-accept=""
              disabled={disabled}
              onClick={() => onAnswerDraw(true)}
            >
              Accept
            </button>
            <button
              className="hud-menu-item"
              disabled={disabled}
              onClick={() => onAnswerDraw(false)}
            >
              Decline
            </button>
          </span>
        </div>
      )}
      {/* Said, as well as shown: present from the first render, so each change is announced */}
      <div className="sr-only" role="status" data-testid="draw-announcer">
        {said}
      </div>
    </div>
  );
};

export default GameActions;
