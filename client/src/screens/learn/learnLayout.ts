// The tutorial's page round its canvas (learn.css, .learn): Home at the top
// left and the lesson's card (the pieces to choose from, the lesson, Next)
// across the bottom, which the camera's fit keeps the tower clear of. In a
// wide window the card stands at the left of the tower, and in a short one
// (a phone on its side) too, so the tower takes the whole height under Home.

/** CSS px at the top kept for Home (index.css, .lobby-top, where the lobby has it: 14 px, the 32 px link, 10 px). */
export const LEARN_TOP_PX = 56;

/** A window this tall or less is short: the card stands beside the tower, compact. */
export const LEARN_SHORT_PX = 480;

/**
 * Whether the card stands beside the tower (.learn[data-card='beside']): in
 * a short window, or in one wide enough that the tower, framed in the whole
 * height under Home and centred, leaves room for the card (300 wide, 20 px
 * more) at its left from every side the view turns to. Its half-width is at
 * most 42% of that height (its labels included, from the opening and
 * below), as the fit frames it.
 */
export const cardBeside = (width: number, height: number): boolean =>
  height <= LEARN_SHORT_PX || width / 2 - 0.42 * (height - LEARN_TOP_PX) >= 320;

export const learnTop = (): number => LEARN_TOP_PX;

/**
 * CSS px at the bottom kept for the card where it spans the bottom (learn.css,
 * --learn-card: taller on a phone held upright, whose words are larger for
 * their width, and taller still on the narrowest, and its 12 px gutter); none
 * where it stands beside the tower.
 */
export const learnBottom = (height: number, width: number): number =>
  cardBeside(width, height) ? 0 : (width <= 380 ? 284 : width <= 520 ? 272 : 260) + 12;

/**
 * The card's margin at the left where it stands beside the tower in a wide
 * window (learn.css, --learn-gutter): the home page's (index.css,
 * --landing-gutter).
 */
export const learnGutter = (width: number): number => Math.min(Math.max(0.06 * width, 24), 112);

/**
 * CSS px at the left the card takes where it stands beside the tower, with
 * its gutters, which the fit keeps the tower right of should the tower,
 * centred, run under it (settleLeftInset): in a short window 12 px in, 252
 * wide and 12 px; in a wide one the page's gutter in, 300 wide and 12 px.
 * None where the card spans the bottom.
 */
export const learnLeft = (width: number, height: number): number =>
  height <= LEARN_SHORT_PX
    ? 12 + 252 + 12
    : cardBeside(width, height)
      ? learnGutter(width) + 300 + 12
      : 0;
