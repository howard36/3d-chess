import React from 'react';
import { useNavigate } from 'react-router';
import type { Color } from '../../types/messages';
import type { Invitation } from '../../game/invitation';
import type { GameSocket } from '../../hooks/useGameSocket';
import { SLOW_SERVER_MS, useDelayed } from '../../hooks/useDelayed';
import { PlayButton } from '../PlayButton';
import { autoFocusRef, focusFromCode } from '../../lib/focus';

// The cards over the lobby's scene on a game's page before it starts: the
// creator's invitation to send, of the home page's tile glass (.lobby-glass),
// and the invitation as its guest opens it, its button alone on the scene.
// Their one action is the pill of starlight (PlayButton, the result card's
// too), so the way in looks the same at every step: plain in the glass, in
// its turning rim where it stands alone.

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
  React.useEffect(() => focusFromCode(first.current, { preventScroll: true }), []);
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
          <PlayButton ref={first} onClick={copy}>
            {copied ? 'Copied ✓' : 'Copy link'}
          </PlayButton>
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
    // No card for a heading and one button: the heading is the page's, the
    // way on stands alone where the invitation's would
    return (
      <>
        <div className="lobby-heading" role="alert">
          <h1 id="invitation-title">
            {invitation.state === 'full' ? 'This game is taken' : 'No game here'}
          </h1>
        </div>
        <section className="lobby-card lobby-invitation" aria-labelledby="invitation-title">
          <div className="lobby-actions">
            {/* In the home page's words for where it leads */}
            <PlayButton rim ref={autoFocusRef} onClick={() => navigate(newGamePath)}>
              {newGamePath === '/computer' ? 'Play the computer' : 'Play a friend'}
            </PlayButton>
          </div>
        </section>
      </>
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
        <PlayButton
          rim
          ref={autoFocusRef}
          onClick={onAccept}
          aria-disabled={joining || undefined}
          data-testid="accept-invitation"
        >
          {joining ? 'Joining…' : 'Join game'}
        </PlayButton>
      </div>
    </section>
  );
};
