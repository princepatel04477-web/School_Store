import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { KitIllustration, type KitKind } from './KitIllustration';
import { formatINR } from '../../utils/formatINR';
import { EASING, DURATION_FAST } from '../../motion/motionConfig';
import './kitListHero.css';

interface KitLine {
  name: string;
  qty?: string;
  pricePaise: number;
  kind: KitKind;
  color: string;
}

/** An example class list. Shown as an example, never as the visitor's own order. */
const EXAMPLE_LIST: KitLine[] = [
  { name: 'Half-sleeve shirt', qty: '×2', pricePaise: 84000, kind: 'uniform', color: 'var(--house-red)' },
  { name: 'Grey trousers', qty: '×2', pricePaise: 96000, kind: 'trousers', color: 'var(--house-red)' },
  { name: 'Black shoes, velcro', pricePaise: 89900, kind: 'shoes', color: 'var(--house-blue)' },
  { name: 'House tie and belt', pricePaise: 27000, kind: 'accessories', color: 'var(--house-green)' },
  { name: 'Long notebooks', qty: '×6', pricePaise: 28800, kind: 'stationery', color: 'var(--house-yellow)' },
  { name: 'Student ID card', pricePaise: 15000, kind: 'idcard', color: 'var(--navy)' },
];

const FIRST_TICK_MS = 700;
const TICK_EVERY_MS = 380;

export interface KitListHeroProps {
  schoolName?: string;
}

export function KitListHero({ schoolName }: KitListHeroProps) {
  const shouldReduceMotion = useReducedMotion();
  const total = EXAMPLE_LIST.length;
  const [ticked, setTicked] = useState(shouldReduceMotion ? total : 0);

  // Tick the list off one line at a time, once, on first view
  useEffect(() => {
    if (shouldReduceMotion) {
      setTicked(total);
      return;
    }
    let count = 0;
    let interval: number | undefined;
    const start = window.setTimeout(() => {
      interval = window.setInterval(() => {
        count += 1;
        setTicked(count);
        if (count >= total) window.clearInterval(interval);
      }, TICK_EVERY_MS);
    }, FIRST_TICK_MS);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(interval);
    };
  }, [shouldReduceMotion, total]);

  const totalPaise = EXAMPLE_LIST.reduce((sum, line) => sum + line.pricePaise, 0);

  return (
    <figure className="kit-hero" aria-label="Example of a class kit list">
      <div className="kit-hero-head">
        <span className="kit-hero-label">Example · {schoolName ?? 'Class 4, Section B'}</span>
        <span className="kit-hero-title">Aarav's list</span>
      </div>

      <ul className="kit-hero-lines">
        {EXAMPLE_LIST.map((line, i) => {
          const done = i < ticked;
          return (
            <li key={line.name} className={`kit-hero-line ${done ? 'is-done' : ''}`}>
              <span className="kit-hero-check" aria-hidden="true">
                <motion.span
                  className="kit-hero-check-fill"
                  initial={false}
                  animate={{ scale: done ? 1 : 0.4, opacity: done ? 1 : 0 }}
                  transition={{ duration: DURATION_FAST, ease: EASING }}
                />
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
                  <motion.path
                    d="M5 12.5l4.5 4.5L19 7.5"
                    stroke="var(--on-brand)"
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={false}
                    animate={{ pathLength: done ? 1 : 0 }}
                    transition={{ duration: 0.25, delay: done ? 0.05 : 0, ease: EASING }}
                  />
                </svg>
              </span>
              <span className="kit-hero-icon">
                <KitIllustration kind={line.kind} color={line.color} />
              </span>
              <span className="kit-hero-name">
                {line.name}
                {line.qty && <span className="kit-hero-qty"> {line.qty}</span>}
              </span>
              <span className="kit-hero-price">{formatINR(line.pricePaise)}</span>
            </li>
          );
        })}
      </ul>

      <div className="kit-hero-foot">
        <div className="kit-hero-progress" aria-hidden="true">
          <motion.span
            className="kit-hero-progress-fill"
            initial={false}
            animate={{ scaleX: ticked / total }}
            transition={{ duration: 0.3, ease: EASING }}
          />
        </div>
        <div className="kit-hero-total">
          <span>
            {ticked} of {total} ready
          </span>
          <strong>{formatINR(totalPaise)}</strong>
        </div>
      </div>
    </figure>
  );
}
