/**
 * An arrow as tall as the capitals of the words beside it, its ink centred
 * on them (index.css, .caps-arrow): the way back or on, where a text arrow
 * would sit at the font's own height, lower than the capitals.
 */
export const Arrow = ({ to }: { to: 'left' | 'right' }) => (
  <svg className="caps-arrow" viewBox="0 0 12 12" aria-hidden>
    <path
      d={to === 'left' ? 'M10.5 6h-9M5 2.5 1.5 6 5 9.5' : 'M1.5 6h9M7 2.5 10.5 6 7 9.5'}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
