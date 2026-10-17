/**
 * A house, the way home: drawn as the game's other icons are (16 units, a
 * 1.5 stroke), its ink centred in its box. In a circle it stands 16 px, as
 * the flag and the take-back do; beside the word, a little taller than the
 * capitals (index.css, .hud-home-icon).
 */
export const House = () => (
  <svg className="hud-home-icon" viewBox="0 0 16 16" aria-hidden>
    <path
      d="M2.5 7.5 8 2.5l5.5 5M4 6.25v7.25h8V6.25"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
