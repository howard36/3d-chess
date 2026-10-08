// The Staunton piece set: geometry for every piece, split into parts that
// can be painted separately. See set.ts for the parts and the envelope, and
// ARCHITECTURE.md's "Piece set" section for the preview tool (client/pieces.html).

export { PIECE_PARTS, partsGeometry, pieceTop } from './parts';
export { FOOT_HEIGHT, PROFILES, pieceSet } from './set';
export type { PiecePart, PieceParts, PieceQuality, PieceSet } from './set';
export { sampleProfile } from './profile';
export type { Profile } from './profile';
