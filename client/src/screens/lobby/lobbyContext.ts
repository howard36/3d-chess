import React from 'react';
import type { LobbyView } from '../../three/lobby/LobbyScene';

// What the screens under LobbyLayout say its stage shows.

export interface LobbyStage extends LobbyView {
  /** A line over the scene while it plays out (the arrival), read aloud too. */
  caption?: string;
  /** A second, quieter line under the caption. */
  captionNote?: string;
}

export interface LobbyApi {
  show: (view: LobbyStage | null) => void;
}

export const LobbyContext = React.createContext<LobbyApi>({ show: () => {} });

/** The lobby's stage, for a screen under LobbyLayout (a no-op elsewhere). */
export const useLobby = () => React.useContext(LobbyContext);

/**
 * Shows `view` on the lobby's stage while the calling screen holds it. The
 * view is read afresh on each render; it is left in place when the screen
 * unmounts, so the next screen takes over the same picture.
 */
export const useLobbyView = (view: LobbyStage | null) => {
  const { show } = useLobby();
  React.useLayoutEffect(() => show(view));
};
