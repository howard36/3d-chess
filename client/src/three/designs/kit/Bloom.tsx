import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { HalfFloatType, Vector2 } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Pass } from 'three/examples/jsm/postprocessing/Pass.js';

export interface BloomProps {
  /** How bright the glow is. */
  strength?: number;
  /** How far it spreads (0–1). */
  radius?: number;
  /** Linear luminance above which a pixel glows. */
  threshold?: number;
  /** Extra passes run after the bloom, before tone mapping (film grain, chromatic shift). */
  passes?: Pass[];
}

/**
 * Renders the scene through a bloom pass: bright pixels (emissive
 * materials, lines drawn above the threshold) bleed light. Takes over the
 * frame from r3f (a priority-1 frame callback), so it works the same with
 * a demand-driven or continuous frame loop.
 */
export const Bloom = ({ strength = 0.9, radius = 0.5, threshold = 0.85, passes }: BloomProps) => {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);

  const { composer, bloom } = useMemo(() => {
    const composer = new EffectComposer(gl);
    composer.renderTarget1.texture.type = HalfFloatType;
    composer.renderTarget2.texture.type = HalfFloatType;
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new Vector2(256, 256), strength, radius, threshold);
    composer.addPass(bloom);
    for (const pass of passes ?? []) composer.addPass(pass);
    composer.addPass(new OutputPass());
    return { composer, bloom };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- strength etc. are applied below
  }, [gl, scene, camera, passes]);

  useEffect(() => {
    bloom.strength = strength;
    bloom.radius = radius;
    bloom.threshold = threshold;
  }, [bloom, strength, radius, threshold]);

  useEffect(() => {
    composer.setPixelRatio(dpr);
    composer.setSize(size.width, size.height);
  }, [composer, size, dpr]);

  useEffect(() => () => composer.dispose(), [composer]);

  useFrame((_, delta) => {
    composer.render(delta);
  }, 1);

  return null;
};
