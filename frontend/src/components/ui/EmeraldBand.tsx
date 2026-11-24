import type { ReactNode } from 'react';
import { SplitReveal } from '../../motion';

interface EmeraldBandProps {
  eyebrow?: string;
  title: ReactNode;
  sub?: ReactNode;
  /** Show the two children from the home stage on the right. */
  withKids?: boolean;
  children?: ReactNode;
}

/**
 * The emerald page top used across the store: emerald band with the stage circles,
 * a white headline, then a white rounded sheet for the page content.
 */
export function EmeraldBand({ eyebrow, title, sub, withKids = false, children }: EmeraldBandProps) {
  return (
    <div className="em-page">
      <section className={`em-band${withKids ? ' em-band--kids' : ''}`}>
        <span className="em-band-circle em-band-circle--outer" aria-hidden="true" />
        <span className="em-band-circle em-band-circle--inner" aria-hidden="true" />
        <div className="em-band-inner">
          <div className="em-band-copy">
            {eyebrow && <p className="em-band-eyebrow">{eyebrow}</p>}
            <SplitReveal as="h1" immediate delay={0.2} className="em-band-title">
              {title}
            </SplitReveal>
            {sub && <p className="em-band-sub">{sub}</p>}
          </div>
          {withKids && (
            <picture className="em-band-art">
              <source srcSet="/brand/kids-uniform.clean.avif" type="image/avif" />
              <source srcSet="/brand/kids-uniform.clean.webp" type="image/webp" />
              <img src="/brand/kids-uniform.clean.png" alt="" aria-hidden="true" width={600} height={880} decoding="async" />
            </picture>
          )}
        </div>
      </section>
      <div className="em-sheet">
        <div className="em-sheet-inner">{children}</div>
      </div>
    </div>
  );
}
