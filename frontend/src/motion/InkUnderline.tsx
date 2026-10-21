import './inkUnderline.css';

/**
 * A hand-drawn brush stroke under a word. It draws itself once, left to right,
 * after the line has revealed; with reduced motion it is simply there.
 * Stretches to the width of its parent, so it fits the word in every language.
 */
export function InkUnderline() {
  return (
    <svg className="ink-underline" viewBox="0 0 300 18" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M4 12.5c38-4.6 77-6.8 117-6.6 41 .2 79 2.6 118 3.3 19 .3 38-.4 57-2"
        pathLength={1}
      />
    </svg>
  );
}
