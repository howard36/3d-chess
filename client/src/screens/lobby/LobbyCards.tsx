import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { Color } from '../../types/messages';
import type { Invitation } from '../../game/invitation';
import { Stone } from '../TurnPill';

// The cards over the lobby's scene on a game's page before it starts: the
// creator's invitation to send, and the invitation as its guest opens it.
// Their one action is the landing page's pill (.landing-play), so the way
// in looks the same at every step.

const name = (c: Color) => (c === 'white' ? 'White' : 'Black');

/** The link as it is set on the card: no scheme, the game's id (its end) standing out. */
const shownLink = (link: string) => {
  const bare = link.replace(/^[a-z]+:\/\//, '');
  const id = bare.match(/[^/#]+$/)?.[0] ?? '';
  return { rest: bare.slice(0, bare.length - id.length), id };
};

/** How long "Copied" stands on the button before it says "Copy link" again. */
const COPIED_MS = 1800;

/** The creator's card while the opponent's seat is empty. */
export const InviteCard: React.FC<{ link: string; seat: Color }> = ({ link, seat }) => {
  const [copied, setCopied] = React.useState<boolean | null>(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
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
  const share = () => {
    navigator.share({ title: '3D Chess', text: "Let's play 3D chess.", url: link }).catch(() => {
      // Dismissed, or not allowed: the link is still there to copy
    });
  };
  const { rest, id } = shownLink(link);
  const first = React.useRef<HTMLButtonElement>(null);
  // The choice is made; the next thing to do is send the link
  React.useEffect(() => first.current?.focus({ preventScroll: true }), []);
  return (
    <section
      className="lobby-card"
      aria-labelledby="invite-title"
      data-testid="invite-card"
      data-seat={seat}
    >
      <p className="lobby-chip">
        <Stone color={seat} />
        You play {name(seat)}
      </p>
      <h2 id="invite-title">Invite a friend</h2>
      <p className="lobby-text">Send this link. The game begins the moment they arrive.</p>
      {/* The link itself, to read or select; the buttons under it copy or share it */}
      <p className="lobby-url" data-testid="share-link" data-link={link}>
        <span className="lobby-url-rest">{rest}</span>
        <span className="lobby-url-id">{id}</span>
      </p>
      <div className="lobby-actions">
        {canShare && (
          <button ref={first} className="landing-play lobby-go" onClick={share}>
            Share link
          </button>
        )}
        {canCopy && (
          <button
            ref={canShare ? undefined : first}
            className={canShare ? 'lobby-secondary' : 'landing-play lobby-go'}
            onClick={copy}
          >
            {copied ? 'Copied ✓' : 'Copy link'}
          </button>
        )}
      </div>
      <p className="lobby-waiting" role="status">
        <span className="hud-dot" aria-hidden />
        {copied === false
          ? "Couldn't copy: select the link instead. Waiting for your friend…"
          : copied
            ? 'Link copied. Waiting for your friend…'
            : 'Waiting for your friend…'}
      </p>
      <p className="lobby-note">Keep this tab open. We'll bring you in.</p>
    </section>
  );
};

/** The guest's card: whose seat is free, and the one thing to do about it. */
export const InvitationCard: React.FC<{ invitation: Invitation; onAccept: () => void }> = ({
  invitation,
  onAccept,
}) => {
  const navigate = useNavigate();
  if (invitation.state === 'full' || invitation.state === 'gone') {
    return (
      <section className="lobby-card" aria-labelledby="invitation-title" role="alert">
        <h2 id="invitation-title">
          {invitation.state === 'full' ? 'This game is taken' : 'No game here'}
        </h2>
        <p className="lobby-text">
          {invitation.state === 'full'
            ? 'It already has two players. If one of them is you, open it where you started.'
            : "This link doesn't lead to a game. It may be mistyped, or the game has expired."}
        </p>
        <div className="lobby-actions">
          <button autoFocus className="landing-play lobby-go" onClick={() => navigate('/new')}>
            Start a new game
          </button>
        </div>
      </section>
    );
  }
  if (invitation.state === 'opening') {
    return (
      <section className="lobby-card" aria-busy="true">
        <p className="lobby-waiting" role="status">
          <span className="hud-dot" aria-hidden />
          Opening the invitation…
        </p>
      </section>
    );
  }
  const { seat } = invitation;
  const joining = invitation.state === 'joining';
  return (
    <section className="lobby-card" aria-labelledby="invitation-title" data-testid="invitation">
      <h2 id="invitation-title">
        You're invited to play <Stone color={seat} />
        {name(seat)}
      </h2>
      <p className="lobby-text">
        Chess on five boards stacked into a tower. Pieces move up and down as well as across.
      </p>
      <div className="lobby-actions">
        <button
          autoFocus
          className="landing-play lobby-go"
          onClick={onAccept}
          aria-disabled={joining || undefined}
          data-testid="accept-invitation"
        >
          {joining ? 'Taking your seat…' : 'Take your seat'}
        </button>
      </div>
    </section>
  );
};

/**
 * Who stands where, in words under the kings (placed by the scene's
 * --seat-<seat>-x/foot). Not read aloud: the card says the same.
 */
export const SeatLabels: React.FC<{ labels: Partial<Record<Color, string>> }> = ({ labels }) => (
  <div aria-hidden>
    {(['white', 'black'] as const).map(
      (seat) =>
        labels[seat] && (
          <span
            key={seat}
            className="lobby-seat"
            style={
              {
                '--x': `var(--seat-${seat}-x, ${seat === 'white' ? '30%' : '70%'})`,
                '--y': `var(--seat-${seat}-foot, 55%)`,
              } as React.CSSProperties
            }
          >
            {labels[seat]}
          </span>
        ),
    )}
  </div>
);
