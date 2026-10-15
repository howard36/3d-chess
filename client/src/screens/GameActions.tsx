import React from 'react';
import type { DrawOfferState } from '../game/ending';
import type { Color } from '../types/messages';

export interface GameActionsProps {
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
  /**
   * Taking back the player's last move (and the reply to it): an arrow under
   * the flag, while there is one to take back and it may be asked for
   * (`enabled`). Against the computer it is taken back at once; against a
   * friend it is asked for, and `request` is where the asking stands (as a
   * draw offer's does), the opponent's answered with `onAnswer`.
   */
  takeBack?: {
    enabled: boolean;
    onTakeBack: () => void;
    request?: DrawOfferState;
    onAnswer?: (accept: boolean) => void;
  };
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

/** An arrow turning back. */
const Back = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
    <path
      d="M5.5 3 2.5 6l3 3M3 6h6.5a3.5 3.5 0 0 1 0 7H7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** The line under the buttons, by what it says: a question to answer, or where a request stands. */
const LINE_WORDS = {
  'takeback-offer': 'Take-back requested',
  'draw-offer': 'Draw offered',
  'takeback-pending': 'Take-back requested',
  'draw-pending': 'Draw offered',
  'takeback-declined': 'Take-back declined',
  'draw-declined': 'Draw declined',
} as const;

/**
 * Resigning and draws, in a game under way: a flag under the way to the
 * tutorial (index.css, .hud-game) opens a small menu, "Offer draw" and
 * "Resign", and resigning asks once more ("Resign?"), so a stray click never
 * ends the game. Under the flag, while it applies: the player's own offer
 * waiting ("Draw offered"), declined ("Draw declined"), or the opponent's,
 * with Accept and Decline. Never takes focus on its own; a screen reader
 * hears the offers through a polite live region. An arrow under the flag
 * takes the player's last move back: at once against the computer, and
 * against a friend once they agree, the asking shown as a draw offer is
 * (one line under the buttons at a time).
 */
const GameActions: React.FC<GameActionsProps> = ({
  seat,
  offer,
  disabled,
  onResign,
  onOfferDraw,
  onAnswerDraw,
  takeBack,
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
  const request = takeBack?.request;
  const theirAsk = !!request && request.standing !== null && request.standing !== seat;
  const myAsk = request?.standing === seat;
  const askSaid = theirAsk
    ? 'Your opponent asks to take back a move.'
    : myAsk
      ? 'Take-back requested.'
      : request?.declined === seat
        ? 'Take-back declined.'
        : '';
  // One line at most hangs under the buttons (a narrow window has room
  // beside the tower for no more): a question for the player first, the
  // take-back's before the draw's, then where the player's own stand
  const line: keyof typeof LINE_WORDS | null = theirAsk
    ? 'takeback-offer'
    : theirs
      ? 'draw-offer'
      : myAsk
        ? 'takeback-pending'
        : mine
          ? 'draw-pending'
          : request?.declined === seat
            ? 'takeback-declined'
            : offer.declined === seat
              ? 'draw-declined'
              : null;

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
      {takeBack && (
        <button
          className="hud-game-menu"
          data-testid="take-back"
          aria-label={request ? 'Ask to take back move' : 'Take back move'}
          title={request ? 'Ask to take back move' : 'Take back move'}
          disabled={disabled || !takeBack.enabled}
          onClick={takeBack.onTakeBack}
        >
          <Back />
        </button>
      )}
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
      {line && line.endsWith('-offer') ? (
        // Keyed by the line: a button the player pressed never becomes another offer's
        <div key={line} className="hud-offer hud-glass" data-testid={line}>
          <span className="hud-offer-words">{LINE_WORDS[line]}</span>
          <span className="hud-offer-answers">
            {[true, false].map((accept) => (
              <button
                key={String(accept)}
                className="hud-menu-item"
                data-accept={accept ? '' : undefined}
                disabled={disabled}
                onClick={() =>
                  line === 'draw-offer' ? onAnswerDraw(accept) : takeBack?.onAnswer?.(accept)
                }
              >
                {accept ? 'Accept' : 'Decline'}
              </button>
            ))}
          </span>
        </div>
      ) : (
        line && (
          <div key={line} className="hud-line hud-glass" data-testid={line}>
            {line.endsWith('-pending') && <span className="hud-dot" aria-hidden />}
            {LINE_WORDS[line]}
          </div>
        )
      )}
      {/* Said, as well as shown: present from the first render, so each change is announced */}
      <div className="sr-only" role="status" data-testid="draw-announcer">
        {said}
      </div>
      {request && (
        <div className="sr-only" role="status" data-testid="takeback-announcer">
          {askSaid}
        </div>
      )}
    </div>
  );
};

export default GameActions;
