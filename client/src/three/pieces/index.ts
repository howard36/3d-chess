// The shared Staunton piece set: geometry for every piece, split into parts a
// design paints separately, and a component that draws one. See set.ts for
// the parts and the envelope, ChessPiece.tsx for drawing, and the README's
// "Piece set" section for the preview tool (client/pieces.html).

export { ChessPiece, Part } from './ChessPiece';
export type { ChessPieceProps, PartMaterial, PartMaterials } from './ChessPiece';
export { PIECE_PARTS, partsGeometry, pieceTop } from './parts';
export { FOOT_HEIGHT, PROFILES, buildPieceSet, pieceSet, preloadPieceSet } from './set';
export type {
  PiecePart,
  PieceParts,
  PieceProfiles,
  PieceQuality,
  PieceSet,
  PieceSetOptions,
} from './set';
export { arc, corner, sampleProfile } from './profile';
export type { Profile, ProfileNode } from './profile';
