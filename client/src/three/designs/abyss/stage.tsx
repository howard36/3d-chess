import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import type { DirectionalLight } from 'three';
import { AbyssWater } from './backdrop';
import { MarkerClock } from './markers';
import { DistantMotes, RoomFrame } from './station';

// The room: the water outside (backdrop.tsx), and the station's lamps. The
// lamps travel with the camera, so every piece is modelled the same way from
// any orbit and either seat: a cool key over the viewer's left shoulder, a
// teal rim from behind the tower that lifts the obsidian army off the dark
// water; the key never climbs above 60°, and swings aside as the view
// steepens, so from straight above nothing flattens the forms. The
// reflections come from a dark room of tall strip lights, so nacre shows its
// sheen and obsidian reads as black glass, never hard points of glare.

const DEG = Math.PI / 180;

const CameraLights = () => {
  const key = useRef<DirectionalLight>(null);
  const rim = useRef<DirectionalLight>(null);
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    const az = Math.atan2(camera.position.x, camera.position.z);
    const el = Math.atan2(camera.position.y, Math.hypot(camera.position.x, camera.position.z));
    const place = (light: DirectionalLight | null, azimuth: number, elevation: number) => {
      light?.position.set(
        Math.sin(azimuth) * Math.cos(elevation) * 12,
        Math.sin(elevation) * 12,
        Math.cos(azimuth) * Math.cos(elevation) * 12,
      );
    };
    // The key stays off the camera's axis: never above 60°, and swung further
    // aside as the view steepens, so glossy tops never mirror it straight back
    const steep = Math.min(Math.max((el - 50 * DEG) / (20 * DEG), 0), 1);
    place(key.current, az - (40 + 30 * steep) * DEG, Math.min(el + 32 * DEG, 60 * DEG));
    place(rim.current, az + 180 * DEG + 30 * DEG, 24 * DEG);
  });
  return (
    <>
      <directionalLight ref={key} intensity={2.3} color="#eef8ff" />
      <directionalLight ref={rim} intensity={2.1} color="#7fd4de" />
    </>
  );
};

export const Stage = () => (
  <>
    <AbyssWater />
    <RoomFrame />
    <DistantMotes />
    <MarkerClock />
    {/* Reflections shot like black glass in a studio: tall narrow strips all
        round the horizon, so every glossy turned form carries long vertical
        highlights from any azimuth, and two thin strips overhead instead of
        a softbox, so up-facing gloss mirrors dark water with a thin arc */}
    <Environment resolution={256} frames={1}>
      <color attach="background" args={['#041216']} />
      {[-2.4, 2.4].map((z) => (
        <Lightformer
          key={z}
          form="rect"
          intensity={0.9}
          color="#dff6ff"
          position={[0, 8, z]}
          rotation-x={Math.PI / 2}
          scale={[9, 0.7, 1]}
        />
      ))}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Lightformer
          key={i}
          form="rect"
          intensity={i % 2 ? 1.4 : 2.1}
          color={i % 2 ? '#9fdde4' : '#eef7f8'}
          position={[Math.sin((i * Math.PI) / 3) * 7, 1, Math.cos((i * Math.PI) / 3) * 7]}
          scale={[0.9, 5, 1]}
        />
      ))}
    </Environment>
    <hemisphereLight args={['#bfe3ea', '#07161b', 0.75]} />
    <CameraLights />
  </>
);
