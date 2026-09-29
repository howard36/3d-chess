import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { Color } from '../../types/messages';
import type { Invitation } from '../../game/invitation';
import { Stone } from '../TurnPill';

// The cards over the lobby's scene on a game's page before it starts: the
// creator's invitation to send, and the invitation as its guest opens it.

const name = (c: Color) => (c === 'white' ? 'White' : 'Black');

/** The link as it is set on the card: no scheme, the game's id standing out. */
const shownLink = (link: string) => {
  const url = new URL(link);
  const id = url.pathname.split('/').pop() ?? '';
  return { rest: `${url.host}${url.pathname.slice(0, url.pathname.length - id.length)}`, id };
};

/** The creator's card while the opponent's seat is empty. */
export const InviteCard: React.FC<{ link: string; seat: Color }> = ({ link, seat }) => {
  const [copied, setCopied] = React.useState<boolean | null>(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const canCopy = typeof navigator !== 'undefined' && !!navigator.clipboard;
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
  const copyFirst = React.useRef<HTMLButtonElement>(null);
  // The choice is made; the next thing to do is send the link
  React.useEffect(() => copyFirst.current?.focus({ preventScroll: true }), []);
  return (
    <section
      className="lobby-card"
      aria-labelledby="invite-title"
      data-testid="invite-card"
      data-seat={seat}
    >
      <p className="lobby-eyebrow">
        <Stone color={seat} />
        You play {name(seat)}
      </p>
      <h2 id="invite-title">Invite a friend</h2>
      <p className="lobby-text">Send this link. The game starts the moment they join.</p>
      <button
        ref={canShare ? undefined : copyFirst}
        className="lobby-url"
        onClick={canCopy ? copy : undefined}
        aria-label={canCopy ? `Copy the link, ${link}` : link}
        data-testid="share-link"
        data-link={link}
      >
        <span className="lobby-url-text">
          <span className="lobby-url-rest">{rest}</span>
          <span className="lobby-url-id">{id}</span>
        </span>
        {canCopy && (
          <span className="lobby-url-action" aria-hidden>
            {copied ? 'Copied' : 'Copy'}
          </span>
        )}
      </button>
      {canShare && (
        <button ref={copyFirst} className="lobby-primary" onClick={share}>
          Share link
        </button>
      )}
      <p className="lobby-waiting" role="status">
        <span className="hud-dot" aria-hidden />
        {copied === true
          ? 'Link copied. Waiting for them to join…'
          : copied === false
            ? "Couldn't copy; select the link instead. Waiting for them to join…"
            : 'Waiting for them to join…'}
      </p>
      <p className="lobby-note">Keep this tab open, and we'll bring you in when they join.</p>
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
        <button autoFocus className="lobby-primary" onClick={() => navigate('/new')}>
          Start a new game
        </button>
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
      <p className="lobby-eyebrow">
        <Stone color={seat === 'white' ? 'black' : 'white'} />
        An invitation
      </p>
      <h2 id="invitation-title">You're invited to play {name(seat)}</h2>
      <p className="lobby-text">
        Chess on five boards stacked into a tower. Pieces move up and down as well as across.
      </p>
      <button
        autoFocus
        className="lobby-primary"
        onClick={onAccept}
        disabled={joining}
        data-testid="accept-invitation"
      >
        {joining ? 'Taking your seat…' : 'Take your seat'}
      </button>
    </section>
  );
};
