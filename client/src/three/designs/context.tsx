import React from 'react';
import zenith from './zenith';
import type { Design } from './types';

/**
 * The look of the game: Zenith. Read by everything under the Canvas (r3f
 * bridges React context into it) and by the HUD around it. Unit tests
 * provide a light stand-in instead (testDesign.tsx).
 */
export const DesignContext = React.createContext<Design>(zenith);

export const useDesign = () => React.useContext(DesignContext);
