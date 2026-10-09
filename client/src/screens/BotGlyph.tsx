import React from 'react';
import { CHARCOAL, CHARCOAL_EDGE } from './charcoal';

/**
 * The computer: a robot's head in Black's charcoal (PieceGlyph's), its face
 * a dark screen with two pale eyes. One gradient over the whole head (in the
 * glyph's own space), so the head, ears and antenna are lit as one piece.
 * The home page's "Play the computer" tile and the lobby's levels draw it.
 */
export const BotGlyph: React.FC<{ className?: string; size?: number }> = ({
  className,
  size = 24,
}) => {
  const id = `bot-${React.useId().replace(/[^\w-]/g, '')}`;
  const fill = `url(#${id})`;
  const edge = { stroke: CHARCOAL_EDGE, strokeWidth: 0.8, strokeLinejoin: 'round' as const };
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <defs>
        <radialGradient id={id} gradientUnits="userSpaceOnUse" cx="8.2" cy="6.7" r="21.6">
          {CHARCOAL.map(([offset, stopColor]) => (
            <stop key={offset} offset={offset} stopColor={stopColor} />
          ))}
        </radialGradient>
      </defs>
      <path d="M12 7.6V5.2" stroke={fill} strokeWidth={1.2} strokeLinecap="round" />
      <circle cx="12" cy="4.3" r="1.3" fill={fill} {...edge} />
      <rect x="2.3" y="10.7" width="2.9" height="5.6" rx="1.2" fill={fill} {...edge} />
      <rect x="18.8" y="10.7" width="2.9" height="5.6" rx="1.2" fill={fill} {...edge} />
      <rect x="4.5" y="7.6" width="15" height="11.8" rx="3.6" fill={fill} {...edge} />
      <rect
        x="6.1"
        y="9.3"
        width="11.8"
        height="8.4"
        rx="2.2"
        fill="#1c2029"
        stroke="rgba(150,162,184,0.45)"
        strokeWidth={0.5}
      />
      <rect x="8.75" y="11.3" width="1.9" height="3.6" rx="0.95" fill="rgba(214,222,236,0.92)" />
      <rect x="13.35" y="11.3" width="1.9" height="3.6" rx="0.95" fill="rgba(214,222,236,0.92)" />
    </svg>
  );
};
