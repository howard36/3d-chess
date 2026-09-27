// Atelier's palette, chosen value-first (approximate CIE L* in brackets):
//
//   ivory army   porcelain  [88–96]   the lightest thing in the frame
//   ink army     lacquer    [20–30]   the darkest thing in the frame
//   backdrop     warm grey  [60–86]   a mid band between them, lighter above
//   platforms    frosted    +2–5 over whatever is behind them
//
// so each army sits a clear value step away from the backdrop and from each
// other. The markers take hues nothing else in the scene uses: teal for "can
// move", vermilion for capture, amber for the last move, crimson for check,
// gold for the selection. Levels are told apart by tinted acrylic (taupe,
// sage, cornflower, lilac, dove), which shows where tinted acrylic really
// shows its colour: in its edges, and in the ring at each piece's base.

export const PAL = {
  // Studio cyclorama: the dome's height gradient, a warm key falloff across
  // it, and the sweep's floor
  skyTop: '#dedbd4',
  skyHorizon: '#c9c4bb',
  skyLow: '#b3ada3',
  skyBottom: '#a19b91',
  keyWarm: '#ebe5da',
  keyCool: '#9c978f',
  floor: '#b2aca2',
  floorPool: '#d8d1c5',
  floorShadow: '#3b342b',
  // Armies
  ivory: '#f3eee4',
  ivoryEdge: '#8f836f',
  ivoryGroove: '#8d8272',
  ink: '#22386a',
  inkRim: '#9db4e4',
  inkGroove: '#0b1122',
  gold: '#caa45e',
  // Platforms (frosted acrylic)
  frostLight: '#f3f6f9',
  frostDark: '#bcc3cc',
  edgeTop: '#ffffff',
  edgeUnder: '#2d2a26',
  // Markers
  teal: '#13867a',
  vermilion: '#e0452b',
  amber: '#ee9a22',
  amberEdge: '#9c560b',
  crimson: '#d3222f',
  halo: '#fff7e6',
  pool: '#ffc96e',
  // The warm studio spot that picks out a selected or hovered piece
  spot: '#ffbf5c',
  gilt: '#a8741f',
  // Type and HUD
  text: '#2c2a27',
  textHalo: 'rgba(248, 245, 239, 0.92)',
  paper: '#f7f5f0',
} as const;

/**
 * The tinted acrylic of each level, A (bottom) to E: taupe, sage, cornflower,
 * lilac, dove. Muted, and clear of every marker hue. `edge` tints the slab's
 * edge; `ring` the footprint ring at a piece's base (a lighter shade, so it
 * never reads as the contact shadow); `focus` the edge of the level in focus;
 * `ink` the level letter (a deeper shade, legible on the light backdrop).
 */
export const LEVELS = [
  { edge: '#9a8672', ring: '#b59b7e', focus: '#a88663', ink: '#6a5746' },
  { edge: '#7fa278', ring: '#7fae76', focus: '#6ba660', ink: '#4b6d45' },
  { edge: '#7c9bd0', ring: '#7fa2dd', focus: '#5e8ddc', ink: '#3f5f99' },
  { edge: '#a68fce', ring: '#ae93dc', focus: '#9575d6', ink: '#6a549b' },
  { edge: '#b3b0aa', ring: '#9c9891', focus: '#8e8a83', ink: '#5f5b55' },
] as const;
