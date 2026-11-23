'use client';

import { useComputedColorScheme } from '@mantine/core';
import { useEffect, useRef, type ReactNode } from 'react';
import { statusScene, type StatusScene } from './status-scenes';

export function StatusArt({ scene }: { scene: StatusScene }) {
  const ref = useRef<HTMLDivElement>(null);
  const theme = useComputedColorScheme('light');
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let gone = false;
    let stop: (() => void) | undefined;
    void import('lottie-web/build/player/lottie_light').then(
      ({ default: lottie }) => {
        if (gone) return;
        const { data, still } = statusScene(scene, theme);
        const reduced = window.matchMedia(
          '(prefers-reduced-motion: reduce)',
        ).matches;
        const anim = lottie.loadAnimation({
          container: el,
          renderer: 'svg',
          loop: true,
          autoplay: !reduced,
          animationData: data,
        });
        if (reduced) anim.goToAndStop(still, true);
        stop = () => anim.destroy();
      },
    );
    return () => {
      gone = true;
      stop?.();
    };
  }, [scene, theme]);
  return <div ref={ref} className="dax-status-art" aria-hidden="true" />;
}

/** Full "something is wrong" or "not found" page: animation, message and the way out. */
export function StatusPage({
  scene,
  title,
  children,
  actions,
  reference,
  alert = false,
  full = false,
}: {
  scene: StatusScene;
  title: string;
  children: ReactNode;
  actions: ReactNode;
  reference?: string;
  alert?: boolean;
  full?: boolean;
}) {
  return (
    <div className={full ? 'dax-error full' : 'dax-error'}>
      <section className="dax-error-body" role={alert ? 'alert' : undefined}>
        <StatusArt scene={scene} />
        <h1>{title}</h1>
        <p>{children}</p>
        <div className="dax-error-actions">{actions}</div>
        {reference ? (
          <p className="dax-error-ref">
            Reference <span className="dax-mono">{reference}</span>
          </p>
        ) : null}
      </section>
    </div>
  );
}
