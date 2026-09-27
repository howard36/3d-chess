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
// water, and a soft lamp straight overhead for the top-down view. The
// reflections come from a dim teal room with long soft panels, so nacre
// shows its iridescence and obsidian its satin, never hard points of glare.

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
    place(key.current, az - 40 * DEG, Math.min(el + 32 * DEG, 80 * DEG));
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
    <Environment resolution={64} frames={1}>
      <color attach="background" args={['#06171c']} />
      <Lightformer
        form="rect"
        intensity={1.6}
        color="#dff6ff"
        position={[0, 8, 0]}
        rotation-x={Math.PI / 2}
        scale={[9, 9, 1]}
      />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Lightformer
          key={i}
          form="rect"
          intensity={i % 2 ? 0.7 : 1.1}
          color={i % 2 ? '#7fd0da' : '#e9f4f5'}
          position={[Math.sin((i * Math.PI) / 3) * 7, 2, Math.cos((i * Math.PI) / 3) * 7]}
          scale={[4, 1.6, 1]}
        />
      ))}
    </Environment>
    <hemisphereLight args={['#bfe3ea', '#07161b', 0.75]} />
    <directionalLight position={[0, 10, 0]} intensity={0.5} color="#eaf8ff" />
    <CameraLights />
  </>
);
