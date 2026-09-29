// The three.js classes the scene writes as JSX elements (<group>, <mesh>...),
// and so the only ones r3f's Canvas needs to know by name. In the build, r3f
// is handed this in place of the whole three namespace (vite.config.ts), so
// the rest of three.js can be left out of the game screen's chunk. An element
// not listed here fails at runtime ("X is not part of the THREE namespace"):
// add its class here when the scene starts using a new one.
export { Group, LineSegments, Mesh, Points, Sprite, SpriteMaterial } from 'three';
