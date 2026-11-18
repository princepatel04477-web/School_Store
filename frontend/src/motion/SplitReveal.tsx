import { Children, isValidElement, type ElementType, type ReactElement, type ReactNode } from 'react';
import { motion, useReducedMotion, type Variants } from 'motion/react';
import { EASING } from './motionConfig';
import './splitReveal.css';

export interface SplitRevealProps {
  children: ReactNode;
  /** The heading tag to render: h1, h2, h3 or p. */
  as?: ElementType;
  className?: string;
  id?: string;
  /** Seconds before the first word moves. */
  delay?: number;
  /** Play on mount (a step that just opened) instead of when scrolled into view. */
  immediate?: boolean;
}

interface Timing {
  delay: number;
  stagger: number;
}

const container: Variants = {
  hidden: {},
  visible: ({ delay, stagger }: Timing) => ({
    transition: { staggerChildren: stagger, delayChildren: delay },
  }),
};

/** Short headings get 50ms between words; long lines speed up so the last word lands within ~0.6s. */
const staggerFor = (words: number) => Math.min(0.05, 0.6 / Math.max(words, 1));

const word: Variants = {
  hidden: { y: '108%', rotate: 3 },
  visible: { y: '0%', rotate: 0, transition: { duration: 0.7, ease: EASING } },
};

const motionByTag = new Map<ElementType, typeof motion.div>();
function motionFor(as: ElementType): typeof motion.div {
  let component = motionByTag.get(as);
  if (!component) {
    component = motion.create(as) as typeof motion.div;
    motionByTag.set(as, component);
  }
  return component;
}

/** The words of a heading as plain text, for its accessible name. */
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) {
    const props = (node as ReactElement<{ children?: ReactNode }>).props;
    return textOf(props.children);
  }
  return '';
}

function Word({ children }: { children: ReactNode }) {
  return (
    <span className="split-mask">
      <motion.span className="split-word" variants={word}>
        {children}
      </motion.span>
    </span>
  );
}

/**
 * Splits text into words. A string becomes one masked word per word; an element
 * (an accent span, say) keeps its own styling and rises as a single word.
 */
function splitWords(children: ReactNode): ReactNode[] {
  const out: ReactNode[] = [];
  let key = 0;
  Children.forEach(children, (child) => {
    if (typeof child === 'string' || typeof child === 'number') {
      String(child)
        .split(/(\s+)/)
        .forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) out.push(' ');
          else out.push(<Word key={key++}>{part}</Word>);
        });
    } else if (isValidElement(child)) {
      out.push(<Word key={key++}>{child}</Word>);
    }
  });
  return out;
}

/**
 * Headline reveal: each word rises out of its own mask, one after another.
 * Screen readers get the whole heading at once; reduced motion shows it still.
 */
export function SplitReveal({ children, as = 'h2', className = '', id, delay = 0, immediate = false }: SplitRevealProps) {
  const reduce = useReducedMotion();
  const Tag = as;

  if (reduce) {
    return (
      <Tag id={id} className={className}>
        {children}
      </Tag>
    );
  }

  const MotionTag = motionFor(as);
  const words = splitWords(children);
  const timing: Timing = { delay, stagger: staggerFor(words.filter((w) => w !== ' ').length) };
  const play = immediate ? { animate: 'visible' } : { whileInView: 'visible', viewport: { once: true, amount: 0.5 } };

  return (
    <MotionTag id={id} className={`split-reveal ${className}`.trim()} aria-label={textOf(children)} initial="hidden" custom={timing} variants={container} {...play}>
      <span aria-hidden="true">{words}</span>
    </MotionTag>
  );
}
