// Atelier's palette, chosen value-first (approximate CIE L* in brackets):
//
//   ivory army   porcelain  [88–96]   the lightest thing in the frame
//   ink army     lacquer    [16–24]   the darkest thing in the frame
//   backdrop     warm grey  [62–80]   a mid band between them, lighter above
//   platforms    frosted    +2–6 over whatever is behind them
//
// so each army sits a clear value step away from the backdrop and from each
// other. The markers take hues no army, platform or backdrop uses: graphite
// for "can move" (a pencil ring on frosted acrylic), vermilion for capture,
// amber for the last move, crimson for check.

export const PAL = {
  // Studio cyclorama, top of the sphere to the bottom
  skyTop: '#e0dfdb',
  skyHorizon: '#c6c2ba',
  skyLow: '#aea99f',
  skyBottom: '#99948b',
  floorShadow: '#3b342b',
  // Armies
  ivory: '#f3eee4',
  ivoryEdge: '#9c907c',
  ivoryGroove: '#8d8272',
  ink: '#1c2a4a',
  inkRim: '#8fa6d6',
  inkGroove: '#0b1122',
  gold: '#caa45e',
  // Platforms (frosted acrylic)
  frostLight: '#f3f7fa',
  frostDark: '#959fac',
  edgeTop: '#ffffff',
  edgeSide: '#eef0f3',
  edgeBottom: '#6f7784',
  // Markers
  graphite: '#2a2d33',
  vermilion: '#e0452b',
  amber: '#ee9a22',
  amberEdge: '#5e3206',
  crimson: '#d3222f',
  halo: '#fff7e6',
  pool: '#ffcf7e',
  // The warm studio spot that picks out a selected piece's silhouette
  spot: '#ffbf5c',
  gilt: '#a8741f',
  // Type and HUD
  text: '#26282d',
  textHalo: 'rgba(248, 245, 239, 0.92)',
  paper: '#f7f5f0',
} as const;
