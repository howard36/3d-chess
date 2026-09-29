import { ShaderMaterial } from 'three';
import type { ShaderMaterialParameters } from 'three';

/**
 * A shader material for light laid over the glass: transparent, and writing no
 * depth (it is depth-tested, so a piece still hides it).
 */
export const overlayMaterial = (params: ShaderMaterialParameters) =>
  new ShaderMaterial({ transparent: true, depthWrite: false, ...params });
