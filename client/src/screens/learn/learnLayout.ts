// The tutorial's page round its canvas (learn.css, .learn): Home at the top
// left and the lesson's card (the pieces to choose from, the lesson, Next)
// across the bottom, which the camera's fit keeps the tower clear of. In a
// wide window the card stands at the left of the tower, and in a short one
// (a phone on its side) too, so the tower takes the whole height under Home.

/** CSS px at the top kept for Home (learn.css, .learn-top: 10 px, the 32 px link, 10 px). */
export const LEARN_TOP_PX = 52;

/** CSS px at the bottom kept for the card across it (learn.css, --learn-card, and its 12 px gutter). */
export const LEARN_CARD_PX = 248;

/** A window this tall or less is short: the card stands beside the tower, compact. */
export const LEARN_SHORT_PX = 480;

/**
 * Whether the card stands beside the tower (.learn[data-card='beside']): in
 * a short window, or in one wide enough that the tower, framed in the whole
 * height under the menu, clears the card (20 px in, 300 wide, and a gutter)
 * from every side the view turns to. Its half-width is at most 38% of that
 * height (turned 45°, its labels included), as the fit frames it.
 */
export const cardBeside = (width: number, height: number): boolean =>
  height <= LEARN_SHORT_PX || width / 2 - 0.38 * (height - LEARN_TOP_PX) >= 340;

export const learnTop = (): number => LEARN_TOP_PX;
