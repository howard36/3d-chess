// The two sides, as every layer names them ('white' | 'black': the wire's
// Color, the history's Turn, the lobby's Side). No imports, so any screen can
// use these without pulling the rules in.

type Side = 'white' | 'black';

export const otherSide = (side: Side): Side => (side === 'white' ? 'black' : 'white');

/** 'White' or 'Black', as the interface writes it. */
export const sideName = (side: Side) => (side === 'white' ? 'White' : 'Black');

/** The side to move after `ply` moves. */
export const turnAfter = (ply: number): Side => (ply % 2 === 0 ? 'white' : 'black');
