import React from 'react';
import { useNavigate } from 'react-router';
import type { Color } from '../../types/messages';
import type { Invitation } from '../../game/invitation';
import type { GameSocket } from '../../hooks/useGameSocket';
import { SLOW_SERVER_MS, useDelayed } from '../../hooks/useDelayed';

// The cards over the lobby's scene on a game's page before it starts, of the
// home page's tile glass (.lobby-glass): the creator's invitation to send,
// and the invitation as its guest opens it.
// Their one action is a pill of starlight in a rim of the level colours
// (.landing-play, the result card's too), so the way in looks the same at
// every step.

/** The link as it is set on the card: without its scheme. */
const shownLink = (link: string) => link.replace(/^[a-z]+:\/\//, '');

/** How long "Copied" stands on the button before it says "Copy link" again. */
const COPIED_MS = 1800;

/** The creator's card while the opponent's seat is empty. */
export const InviteCard: React.FC<{ link: string; seat: Color }> = ({ link, seat }) => {
  const [copied, setCopied] = React.useState<boolean | null>(null);
  const canCopy = typeof navigator !== 'undefined' && !!navigator.clipboard;
  React.useEffect(() => {
    if (copied !== true) return;
    const timer = window.setTimeout(() => setCopied(null), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = () => {
    navigator.clipboard.writeText(link).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  const first = React.useRef<HTMLButtonElement>(null);
  // The choice is made; the next thing to do is send the link
  React.useEffect(() => first.current?.focus({ preventScroll: true }), []);
  return (
    <section
      className="lobby-card lobby-glass lobby-invite"
      aria-labelledby="invite-title"
      data-testid="invite-card"
      data-seat={seat}
    >
      <h2 id="invite-title">Invite a friend</h2>
      {/* The link itself, to read or select; the button under it copies it */}
      <p className="lobby-url" data-testid="share-link" data-link={link}>
        {shownLink(link)}
      </p>
      {canCopy && (
        <div className="lobby-actions">
          <button ref={first} className="landing-play lobby-go" onClick={copy}>
            {copied ? 'Copied ✓' : 'Copy link'}
          </button>
        </div>
      )}
      {/* The button says "Copied"; only a failed copy needs words */}
      <p className={copied === false ? 'lobby-note' : 'sr-only'} role="status">
        {copied === false ? "Couldn't copy. Select the link." : copied ? 'Link copied' : ''}
      </p>
    </section>
  );
};

/** The guest's card: whose seat is free, and the one thing to do about it. */
export const InvitationCard: React.FC<{
  invitation: Invitation;
  connection: GameSocket['status'];
  onAccept: () => void;
  /** Where its button leads: a friend's side choice (/new) or the computer's (/computer). */
  newGamePath?: string;
}> = ({ invitation, connection, onAccept, newGamePath = '/new' }) => {
  const navigate = useNavigate();
  // Asking which side is free takes a moment; it is only worth a word when
  // the server is slow to answer (a cold start, a dropped connection)
  const slow = useDelayed(invitation.state === 'opening', SLOW_SERVER_MS);
  if (invitation.state === 'full' || invitation.state === 'gone') {
    return (
      <section className="lobby-card lobby-glass" aria-labelledby="invitation-title" role="alert">
        <h2 id="invitation-title">
          {invitation.state === 'full' ? 'This game is taken' : 'No game here'}
        </h2>
        <div className="lobby-actions">
          {/* In the home page's words for where it leads */}
          <button autoFocus className="landing-play lobby-go" onClick={() => navigate(newGamePath)}>
            {newGamePath === '/computer' ? 'Play the computer' : 'Play a friend'}
          </button>
        </div>
      </section>
    );
  }
  if (invitation.state === 'opening') {
    return (
      <p className="lobby-foot" role="status" aria-busy="true">
        {slow &&
          (connection === 'reconnecting' ? 'Reconnecting to server…' : 'Connecting to server…')}
      </p>
    );
  }
  const joining = invitation.state === 'joining';
  // Its heading is the page's (GameScreen): "You're invited to play …"; the
  // scene shows the rest, so all it holds is the one thing to do, the button
  // alone, with no glass round it
  return (
    <section
      className="lobby-card lobby-invitation"
      aria-labelledby="invitation-title"
      data-testid="invitation"
    >
      <div className="lobby-actions">
        <button
          autoFocus
          className="landing-play lobby-go"
          onClick={onAccept}
          aria-disabled={joining || undefined}
          data-testid="accept-invitation"
        >
          {joining ? 'Joining…' : 'Join game'}
        </button>
      </div>
    </section>
  );
};
