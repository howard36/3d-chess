// The numbers the computer judges a position by (evaluate.ts, position.ts),
// in two sets: the levels' (Easy, Medium, Hard), set by hand, and the
// expert's, the strongest it plays: every number tuned for playing strength
// by self-play, with four terms the levels' leave at nothing (the king's
// danger from the enemy's pieces and queen, own pawns beside the king, enemy
// pieces a pawn attacks, and having the move). research/evaluation/ has how
// the expert's were found; its numbers files hold the same sets
// (handset.txt, round3_final.txt).

/** A piece's worth in centipawns, material included, from the middle of the cube out. */
export interface PieceNumbers {
  /** Middlegame and endgame worth at the middle of the cube. */
  mg: number;
  eg: number;
  /** Added per step out from the middle (CENTRE), middlegame and endgame. */
  mgCentre: number;
  egCentre: number;
  /** Added (middlegame) while it stands at home: knights and bishops on rank 1 of level A, unicorns on its first two ranks. */
  home: number;
}

export interface EvalNumbers {
  /** Material per piece type (pawn, knight, bishop, rook, unicorn, queen): what captures are ordered by and the lead is counted in. */
  value: readonly [number, number, number, number, number, number];
  /** A pawn's worth, material included, by how far along it is (rank + level, 0..8): middlegame, endgame. */
  pawnMg: readonly number[];
  pawnEg: readonly number[];
  /** A pawn's middlegame extra on the centre file and on the two beside it. */
  pawnFile: readonly [number, number];
  knight: PieceNumbers;
  bishop: PieceNumbers;
  unicorn: PieceNumbers;
  rook: PieceNumbers;
  queen: PieceNumbers;
  /** The king: middlegame per step out from home (rank + level) and per file from the middle; endgame at the middle, and per step out from it. */
  king: { out: number; file: number; eg: number; egCentre: number };
  /** Per square each piece could move to (knight, bishop, rook, unicorn, queen). */
  mobility: readonly [number, number, number, number, number];
  /** How much each piece near the enemy king threatens it, by nearness (knight, bishop, rook, unicorn, queen). */
  tropism: readonly [number, number, number, number, number];
  bishopPair: number;
  /** The king's danger: shares of it from the enemy's pieces and from the enemy having a queen (the rest the game's phase). */
  dangerForce: number;
  dangerQueen: number;
  /** Each own pawn beside the king, at the king's danger. */
  shield: number;
  /** Each enemy piece (no pawn or king) a pawn attacks. */
  pawnThreat: number;
  /** Having the move. */
  tempo: number;
}

const piece = (mg: number, mgCentre: number, home: number, eg: number, egCentre: number) => ({
  mg,
  mgCentre,
  home,
  eg,
  egCentre,
});

/** The levels': set by hand. */
export const LEVEL_NUMBERS: EvalNumbers = {
  value: [100, 320, 295, 245, 140, 980],
  pawnMg: [100, 100, 106, 114, 124, 136, 152, 175, 100],
  pawnEg: [100, 100, 110, 124, 142, 166, 200, 250, 100],
  pawnFile: [6, 3],
  knight: piece(348, -8, -14, 338, -6),
  bishop: piece(311, -4, -14, 305, -3),
  unicorn: piece(152, -3, -8, 148, -2),
  rook: piece(251, -1, 0, 249, -1),
  queen: piece(986, -2, 0, 990, -3),
  king: { out: -14, file: -4, eg: 24, egCentre: -8 },
  mobility: [2, 2, 2, 2, 1],
  tropism: [3, 2, 1, 2, 6],
  bishopPair: 20,
  dangerForce: 0,
  dangerQueen: 0,
  shield: 0,
  pawnThreat: 0,
  tempo: 0,
};

/** The expert's: tuned for playing strength by self-play (research/evaluation/round3_final.txt). */
export const EXPERT_NUMBERS: EvalNumbers = {
  value: [100, 338, 300, 241, 136, 966],
  pawnMg: [0, 85.1, 100.9, 123.6, 110, 122.5, 153.9, 181.2, 0],
  pawnEg: [0, 95.4, 111.8, 116.2, 139.5, 167.8, 206.7, 250, 0],
  pawnFile: [5.8, 1.8],
  knight: piece(367.2, -5, -2.8, 354.8, -4.3),
  bishop: piece(315.9, -2.6, -14.1, 310.4, -3.9),
  unicorn: piece(166.5, -2.6, -7.7, 126, -2.5),
  rook: piece(223.5, -0.3, 0, 268.6, -0.3),
  queen: piece(954, -4.1, 0, 993.1, -2.6),
  king: { out: -10.5, file: -6.4, eg: 24, egCentre: -13.3 },
  mobility: [1, 1, 2, 3, 0],
  tropism: [3, 2, 2, 1, 7],
  bishopPair: 29,
  dangerForce: 0.24,
  dangerQueen: 0.33,
  shield: 13.7,
  pawnThreat: 41.6,
  tempo: 20,
};
