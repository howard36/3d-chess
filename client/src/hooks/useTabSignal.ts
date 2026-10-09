import React from 'react';

/** The title while it is the player's move. */
export const YOUR_MOVE_TITLE = '● Your move · 3D Chess';
/** The title for a host away from the tab when their guest arrives. */
export const OPPONENT_JOINED_TITLE = '● Opponent joined · 3D Chess';
/** The tab's icon while it is the player's move: the favicon with a dot. */
export const TURN_ICON = `${import.meta.env.BASE_URL}favicon-turn.svg`;

const subscribeVisibility = (onChange: () => void) => {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
};
const isHidden = () => document.hidden;

/** Sets document.title while `title` is given, and puts the one before it back after. */
const useTitle = (title: string | null) => {
  React.useEffect(() => {
    if (title === null) return;
    const before = document.title;
    document.title = title;
    return () => {
      document.title = before;
    };
  }, [title]);
};

/** Points the page's icon link at `href` while it is given, and back after. */
const useIcon = (href: string | null) => {
  React.useEffect(() => {
    if (href === null) return;
    const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!link) return;
    const before = link.getAttribute('href');
    link.setAttribute('href', href);
    return () => {
      if (before === null) link.removeAttribute('href');
      else link.setAttribute('href', before);
    };
  }, [href]);
};

/**
 * The game's state in the browser tab, where a player sees it from any
 * other tab: while it is their move, the title says so and the icon carries a dot (a
 * status, shown whether or not the tab is in view); a host whose tab is hidden
 * when their guest arrives gets "Opponent joined" instead, until they look.
 * Both go back to the page's own title and icon when they no longer apply and
 * when the page unmounts. No frames, no timers: it changes only with the props
 * and the tab's visibility.
 */
export const useTabSignal = ({
  yourMove,
  opponentJoined,
}: {
  /** A seated player's move in a game under way. */
  yourMove: boolean;
  /** The host's guest is arriving (the lobby's handover). */
  opponentJoined: boolean;
}) => {
  const hidden = React.useSyncExternalStore(subscribeVisibility, isHidden, () => false);
  const joined = opponentJoined && hidden;
  useTitle(joined ? OPPONENT_JOINED_TITLE : yourMove ? YOUR_MOVE_TITLE : null);
  useIcon(yourMove ? TURN_ICON : null);
};
