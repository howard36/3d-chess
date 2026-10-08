import { useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color } from 'three';
import type { GardenDetailProps } from './gardenDetail';
import { noRaycast } from '../noRaycast';
import { useDisposeOnUnmount } from './dispose';
import { shadeUniforms } from './mask';
import { GROUND_Y, SKY_DETAIL } from './palette';
import { chartedFigures, FIGURE_LINE, figureDirections } from './heavens';
import { chartGeometry, eggEntries } from './skyChart';
import { brightestOf, richField, todayField } from './skyStars';
import { skyLineMaterial, skyPointMaterial } from './skyShaders';
import { MilkyWay } from './skyMilkyWay';
import { SkyEvents, traceables } from './skyEvents';
// ENV PREVIEW (temporary): the richer sky's settings
import { useEnvSetting } from '../../envPreview';
import { milkyWay } from '../../envPreview/features/milkyWay';
import { skyEggs } from '../../envPreview/features/skyEggs';
import { skyReflection } from '../../envPreview/features/skyReflection';
import { skyEvents } from '../../envPreview/features/skyEvents';
import { stars } from '../../envPreview/features/stars';
import { constellations } from '../../envPreview/features/constellations';
import { skyGlow } from '../../envPreview/features/skyGlow';

// Area A, the sky and constellations: detail added to the night overhead
// (heavens.tsx keeps the field and the constellations, the Sky in stage.tsx
// its air): the Milky Way (skyMilkyWay.tsx), the asterisms with no lines
// (skyChart.ts), the sky given back by the polished stone, and the sky's
// rare events (skyEvents.tsx).

/** The Sky has its air (stage.tsx): envPreview `skyGlow: on`. */
export const useSkyAir = () => useEnvSetting(skyGlow) === 'on';

/** The Sky's airglow uniforms (stage.tsx, envPreview `skyGlow: on`). */
export const skyAirUniforms = () => ({
  uAir: { value: new Color(SKY_DETAIL.airglow) },
  ...shadeUniforms(),
});

/**
 * How bright the stone gives the sky back: the lobby's quiet (`dim`), written
 * as each canvas draws, as the garden's own uniforms are (two canvases, the
 * lobby's fading over the game's, each set theirs just before they render).
 */
const stoneDim = { value: 1 };
const StoneDim = ({ dim = 1 }: { dim?: GardenDetailProps['dim'] }) => {
  useFrame(() => {
    stoneDim.value = typeof dim === 'function' ? dim() : dim;
  });
  return null;
};

/** The asterisms with no lines (`skyEggs: on`). */
const Asterisms = ({ dpr }: { dpr: number }) => {
  const parts = useMemo(() => {
    const { stars, lines } = chartGeometry(eggEntries(), 173);
    return {
      stars,
      lines,
      starMaterial: skyPointMaterial({}),
      lineMaterial: skyLineMaterial({ opacity: FIGURE_LINE }),
    };
  }, []);
  useDisposeOnUnmount(parts);
  parts.starMaterial.uniforms.uDpr.value = dpr;
  return (
    <group name="sky-asterisms">
      {/* The knight's tour's path: no light but a trace's */}
      <lineSegments
        geometry={parts.lines}
        material={parts.lineMaterial}
        renderOrder={-898}
        raycast={noRaycast}
        frustumCulled={false}
      />
      <points
        geometry={parts.stars}
        material={parts.starMaterial}
        renderOrder={-897}
        raycast={noRaycast}
        frustumCulled={false}
      />
    </group>
  );
};

/** How much of the sky's light the stone gives back, before its fresnel. */
const STONE = { lines: 0.5, stars: 0.45, field: 0.4, fieldCount: 260 };

/**
 * The constellations and the brightest stars given back by the polished
 * stone (`skyReflection: on`): the same figures mirrored about the ground,
 * softened (a soft dot for every star, a little larger), weighed by the
 * stone's fresnel (skyShaders.ts) and quieter still, so at the opening view
 * the floor carries the knight and the king upside down, faintly, before the
 * player has ever looked up.
 */
const StarsInStone = ({ dpr, field }: { dpr: number; field: 'off' | 'rich' }) => {
  const parts = useMemo(() => {
    const chart = chartGeometry(chartedFigures());
    const f = field === 'off' ? todayField() : richField(figureDirections());
    return {
      lines: chart.lines,
      stars: chart.stars,
      field: brightestOf(f, STONE.fieldCount),
      lineMaterial: skyLineMaterial({
        opacity: FIGURE_LINE * STONE.lines,
        mirror: true,
        dim: stoneDim,
      }),
      starMaterial: skyPointMaterial({
        opacity: STONE.stars,
        sizeScale: 1.5,
        sharp: 0,
        mirror: true,
        dim: stoneDim,
      }),
      fieldMaterial: skyPointMaterial({
        opacity: STONE.field,
        sizeScale: 1.4,
        sharp: 0,
        mirror: true,
        dim: stoneDim,
      }),
    };
  }, [field]);
  useDisposeOnUnmount(parts);
  parts.starMaterial.uniforms.uDpr.value = dpr;
  parts.fieldMaterial.uniforms.uDpr.value = dpr;
  // Mirrored about the ground by the group's matrix
  return (
    <group name="sky-in-stone" position={[0, 2 * GROUND_Y, 0]} scale={[1, -1, 1]}>
      <points
        geometry={parts.field}
        material={parts.fieldMaterial}
        renderOrder={-899}
        raycast={noRaycast}
        frustumCulled={false}
      />
      <lineSegments
        geometry={parts.lines}
        material={parts.lineMaterial}
        renderOrder={-898}
        raycast={noRaycast}
        frustumCulled={false}
      />
      <points
        geometry={parts.stars}
        material={parts.starMaterial}
        renderOrder={-897}
        raycast={noRaycast}
        frustumCulled={false}
      />
    </group>
  );
};

export const SkyDetail = ({ dim }: GardenDetailProps) => {
  const dpr = useThree((s) => s.viewport.dpr);
  const band = useEnvSetting(milkyWay);
  const eggs = useEnvSetting(skyEggs) === 'on';
  const stone = useEnvSetting(skyReflection) === 'on';
  const events = useEnvSetting(skyEvents);
  const field = useEnvSetting(stars);
  const figures = useEnvSetting(constellations);
  const traceable = useMemo(
    () => [
      ...(figures === 'off' ? [] : traceables(chartedFigures())),
      ...(eggs ? traceables(eggEntries()) : []),
    ],
    [figures, eggs],
  );
  return (
    <group name="sky-detail">
      <StoneDim dim={dim} />
      {band !== 'off' && <MilkyWay look={band} />}
      {eggs && <Asterisms dpr={dpr} />}
      {stone && <StarsInStone dpr={dpr} field={field} />}
      {events !== 'off' && <SkyEvents often={events === 'often'} traceable={traceable} />}
    </group>
  );
};
