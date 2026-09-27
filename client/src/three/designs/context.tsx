import React from 'react';
import classic from './classic';
import { DESIGNS } from './registry';
import type { Design, DesignEntry } from './types';
import { KNIGHT_MOVES } from '../movePath';
import type { KnightMoves } from '../movePath';

/**
 * The design the 3D scene is drawn in. Read by everything under the Canvas
 * (r3f bridges React context into it). Without a provider — unit tests,
 * anything rendered on its own — it is the classic design.
 */
export const DesignContext = React.createContext<Design>(classic);

export const useDesign = () => React.useContext(DesignContext);

const STORAGE_KEY = '3dchess.design';
const KNIGHT_KEY = '3dchess.knightMoves';

/**
 * How knights move on the board: 'straight' like every other piece (the
 * default), or over an arc. A player setting, like the design: remembered
 * in this browser, never sent to the opponent. Read by everything under the
 * Canvas; without a provider it is 'straight'.
 */
export const KnightMovesContext = React.createContext<KnightMoves>('straight');

export const useKnightMoves = () => React.useContext(KnightMovesContext);

const isKnightMoves = (v: string | null | undefined): v is KnightMoves =>
  KNIGHT_MOVES.includes(v as KnightMoves);

/** `?knight=arc|straight` (remembered), else this browser's last choice, else straight. */
const initialKnightMoves = (): KnightMoves => {
  if (typeof window === 'undefined') return 'straight';
  const fromUrl = new URLSearchParams(window.location.search).get('knight');
  if (isKnightMoves(fromUrl)) {
    try {
      localStorage.setItem(KNIGHT_KEY, fromUrl);
    } catch {
      // Storage can be unavailable (private mode); the choice just isn't kept.
    }
    return fromUrl;
  }
  try {
    const stored = localStorage.getItem(KNIGHT_KEY);
    if (isKnightMoves(stored)) return stored;
  } catch {
    // As above.
  }
  return 'straight';
};

const entryFor = (id: string | null | undefined): DesignEntry | undefined =>
  DESIGNS.find((d) => d.id === id);

/**
 * The design to open with: a `?design=` in the address (which also becomes
 * the remembered choice, so a shared link carries its look), else the one
 * this browser picked last, else classic.
 */
const initialDesignId = (): string => {
  if (typeof window === 'undefined') return classic.id;
  const fromUrl = new URLSearchParams(window.location.search).get('design');
  if (entryFor(fromUrl)) {
    try {
      localStorage.setItem(STORAGE_KEY, fromUrl!);
    } catch {
      // Storage can be unavailable (private mode); the choice just isn't kept.
    }
    return fromUrl!;
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (entryFor(stored)) return stored!;
  } catch {
    // As above.
  }
  return classic.id;
};

// Loaded design modules. Each design is its own chunk, fetched on first use.
const loaded = new Map<string, Design>([[classic.id, classic]]);

export interface DesignChoice {
  /** The chosen design's id; `design` catches up once its module has loaded. */
  id: string;
  /** The design to draw: the chosen one, or the previous one while it loads. */
  design: Design;
  choose: (id: string) => void;
  /** How knights move (see KnightMovesContext). */
  knightMoves: KnightMoves;
  chooseKnightMoves: (moves: KnightMoves) => void;
}

const DesignChoiceContext = React.createContext<DesignChoice>({
  id: classic.id,
  design: classic,
  choose: () => {},
  knightMoves: 'straight',
  chooseKnightMoves: () => {},
});

export const useDesignChoice = () => React.useContext(DesignChoiceContext);

export const DesignChoiceProvider = ({ children }: { children: React.ReactNode }) => {
  const [id, setId] = React.useState(initialDesignId);
  const [design, setDesign] = React.useState<Design>(() => loaded.get(id) ?? classic);

  React.useEffect(() => {
    const ready = loaded.get(id);
    if (ready) {
      setDesign(ready);
      return;
    }
    let cancelled = false;
    entryFor(id)
      ?.load()
      .then(({ default: d }) => {
        loaded.set(id, d);
        if (!cancelled) setDesign(d);
      })
      .catch(() => {
        // A chunk that fails to load leaves the current design in place.
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const choose = React.useCallback((next: string) => {
    if (!entryFor(next)) return;
    setId(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not kept; still applied for this page.
    }
  }, []);

  const [knightMoves, setKnightMoves] = React.useState(initialKnightMoves);
  const chooseKnightMoves = React.useCallback((next: KnightMoves) => {
    if (!isKnightMoves(next)) return;
    setKnightMoves(next);
    try {
      localStorage.setItem(KNIGHT_KEY, next);
    } catch {
      // Not kept; still applied for this page.
    }
  }, []);

  const value = React.useMemo(
    () => ({ id, design, choose, knightMoves, chooseKnightMoves }),
    [id, design, choose, knightMoves, chooseKnightMoves],
  );
  return (
    <DesignChoiceContext.Provider value={value}>
      <KnightMovesContext.Provider value={knightMoves}>{children}</KnightMovesContext.Provider>
    </DesignChoiceContext.Provider>
  );
};
