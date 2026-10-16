import React from 'react';
import { turningRim } from './turningRim';

// The main action of a screen: the pill of starlight (.landing-play,
// .lobby-go). With `rim`, where it stands alone on the scene and the action
// is one to urge, a rim of the level colours turns round it at one pace
// (./turningRim.ts), a lap in 9s, in 1.4s while it waits (aria-disabled),
// sky at its left end at rest; in a card of the rimmed glass it goes
// without.

const pillRim = turningRim({
  turning: () => true,
  lapMs: (el) => (el.getAttribute('aria-disabled') === 'true' ? 1400 : 9000),
  sky: 270,
  // The middle of its 2 px border
  inset: 1,
});

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  ref?: React.Ref<HTMLButtonElement>;
  /** The turning rim of the level colours, for an action to urge standing alone. */
  rim?: boolean;
};

/**
 * Words are set in a block trimmed to their capitals (index.css, .caps), so
 * the label is centred as it looks in any font; anything else (a dot) as
 * it is.
 */
const label = (children: React.ReactNode) =>
  React.Children.map(children, (c) =>
    typeof c === 'string' || typeof c === 'number' ? <span className="caps">{c}</span> : c,
  );

export const PlayButton: React.FC<Props> = ({
  ref,
  className,
  rim = false,
  children,
  ...props
}) => {
  const own = React.useRef<HTMLButtonElement | null>(null);
  React.useImperativeHandle(ref, () => own.current!, []);
  const attach = React.useCallback(
    (el: HTMLButtonElement | null) => {
      own.current = el;
      return rim ? pillRim(el) : undefined;
    },
    [rim],
  );
  return (
    <button
      ref={attach}
      className={className ? `landing-play lobby-go ${className}` : 'landing-play lobby-go'}
      data-rim={rim || undefined}
      {...props}
    >
      {label(children)}
    </button>
  );
};
