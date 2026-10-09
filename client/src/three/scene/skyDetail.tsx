import { useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { Color } from 'three';
import { noRaycast } from '../noRaycast';
import { useDisposeOnUnmount } from './dispose';
import { shadeUniforms } from './mask';
import { SKY_DETAIL } from './palette';
import { chartedFigures } from './heavens';
import { chartGeometry, eggEntries } from './skyChart';
import { skyPointMaterial } from './skyShaders';
import { MilkyWay } from './skyMilkyWay';
import { SkyEvents, traceables } from './skyEvents';

// The detail of the night overhead (heavens.tsx keeps the field and the
// constellations, the Sky in stage.tsx its air): the Milky Way
// (skyMilkyWay.tsx), the asterisms with no lines (skyChart.ts), and the
// sky's rare events (skyEvents.tsx).

/** The Sky's airglow uniforms (stage.tsx). */
export const skyAirUniforms = () => ({
  uAir: { value: new Color(SKY_DETAIL.airglow) },
  ...shadeUniforms(),
});

/** The asterisms with no lines. */
const Asterisms = ({ dpr }: { dpr: number }) => {
  const parts = useMemo(() => {
    const { stars, lines } = chartGeometry(eggEntries(), 173);
    lines.dispose();
    return { stars, starMaterial: skyPointMaterial({}) };
  }, []);
  useDisposeOnUnmount(parts);
  parts.starMaterial.uniforms.uDpr.value = dpr;
  return (
    <group name="sky-asterisms">
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

export const SkyDetail = () => {
  const dpr = useThree((s) => s.viewport.dpr);
  const traceable = useMemo(() => traceables(chartedFigures()), []);
  return (
    <group name="sky-detail">
      <MilkyWay />
      <Asterisms dpr={dpr} />
      <SkyEvents traceable={traceable} />
    </group>
  );
};
