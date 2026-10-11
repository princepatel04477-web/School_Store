import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { SchoolCrest } from '../school/SchoolCrest';
import { EASING } from '../../motion/motionConfig';
import './idCard.css';

export interface IdCardSchool {
  id: string;
  name: string;
  code?: string;
  city?: string;
  board?: string;
  color: string;
}

export interface IdCardStudent {
  name: string;
  className?: string;
  section?: string;
  grNumber?: string;
  dateOfBirth?: string;
  gender?: string;
  parentName?: string;
  parentPhone?: string;
  photoUrl?: string;
}

export interface StudentIdCardProps {
  school: IdCardSchool;
  student: IdCardStudent;
  session: string;
  /** Shows an "Example" tag when the details are not the visitor's own */
  isExample?: boolean;
}

/** Swing on arrival: damped, settles in about two seconds */
const SWING = { rotate: [9, -6.5, 4, -2.2, 0.8, 0] };
const SWING_TIME = { duration: 2.2, ease: 'easeInOut' as const, times: [0, 0.2, 0.42, 0.62, 0.82, 1] };

/** Flip: slow and even, like turning a card over by hand */
const FLIP_TIME = { duration: 1.2, ease: [0.45, 0, 0.55, 1] as const };
/** The mouse must rest on the card this long before it turns, so passing over doesn't flip it */
const HOVER_INTENT_MS = 180;

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

/** Decorative scan bars derived from the GR number, so each card's pattern differs */
function scanBars(seed: string) {
  const digits = (seed.replace(/\D/g, '') || '1047').padEnd(12, '7');
  return digits.split('').flatMap((d, i) => {
    const n = Number(d);
    return [
      { w: 1 + (n % 3), gap: 1 + ((n + i) % 2) },
      { w: 1 + ((n + 1) % 2), gap: 2 },
    ];
  });
}

export function StudentIdCard({ school, student, session, isExample = false }: StudentIdCardProps) {
  const shouldReduceMotion = useReducedMotion();
  const [flipped, setFlipped] = useState(false);
  // Last input used on the card; keyboard until a pointer touches it
  const lastPointer = useRef<string>('keyboard');
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const hoverTimer = useRef<number>();
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const canHover = typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  // Mouse: hovering flips the card; moving tilts it slightly and moves the sheen
  const handlePointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType !== 'mouse' || shouldReduceMotion) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    setTilt({ x: (0.5 - py) * 8, y: (px - 0.5) * 8 });
    e.currentTarget.style.setProperty('--sheen-x', `${px * 100}%`);
    e.currentTarget.style.setProperty('--sheen-y', `${py * 100}%`);
  };

  const cardStyle = { '--idc': school.color } as CSSProperties;
  const bars = scanBars(student.grNumber || school.id);
  const grDigits = (student.grNumber || '').replace(/\D/g, '').slice(-4).padStart(4, '0');
  const cardNumber = `${(school.code || 'SC').toUpperCase()}-${session.slice(2, 4)}${grDigits}`;
  const classLine = [student.className, student.section && `Section ${student.section}`].filter(Boolean).join(' · ');

  return (
    <div className="idc-stage" style={cardStyle}>
      <motion.div
        key={school.id}
        className="idc-swing"
        initial={shouldReduceMotion ? false : { rotate: 9 }}
        animate={shouldReduceMotion ? { rotate: 0 } : SWING}
        transition={SWING_TIME}
      >
        {/* Lanyard */}
        <div className="idc-lanyard" aria-hidden="true">
          <span className="idc-lanyard-text">
            {Array.from({ length: 4 }, () => (school.code || school.name).toUpperCase()).join('   ·   ')}
          </span>
        </div>
        <div className="idc-clip" aria-hidden="true" />

        <motion.div
          className="idc-tilt"
          animate={{ rotateX: tilt.x, rotateY: tilt.y }}
          transition={{ duration: 0.4, ease: EASING }}
        >
          <motion.button
            type="button"
            className="idc-card"
            aria-pressed={flipped}
            aria-label={`${student.name}'s ID card, ${flipped ? 'back' : 'front'} side. Press to flip.`}
            onPointerDown={(e) => {
              lastPointer.current = e.pointerType;
            }}
            onPointerEnter={(e) => {
              if (e.pointerType !== 'mouse' || !canHover) return;
              window.clearTimeout(hoverTimer.current);
              hoverTimer.current = window.setTimeout(() => setFlipped(true), HOVER_INTENT_MS);
            }}
            onPointerLeave={(e) => {
              if (e.pointerType === 'mouse' && canHover) {
                window.clearTimeout(hoverTimer.current);
                setFlipped(false);
                setTilt({ x: 0, y: 0 });
              }
            }}
            onPointerMove={handlePointerMove}
            onClick={() => {
              // Touch and keyboard toggle; a mouse already flips on hover
              if (lastPointer.current !== 'mouse' || !canHover) setFlipped((f) => !f);
              lastPointer.current = 'keyboard';
            }}
            animate={{ rotateY: flipped ? 180 : 0 }}
            transition={shouldReduceMotion ? { duration: 0 } : FLIP_TIME}
          >
            {/* ---------- Front ---------- */}
            <div className={`idc-face idc-front ${isExample ? 'is-example' : ''}`}>
              <span className="idc-slot" aria-hidden="true" />
              <div className="idc-head">
                <span className="idc-crest">
                  <SchoolCrest id={school.id} color={school.color} name={school.name} code={school.code} size={38} />
                </span>
                <span className="idc-school">
                  <strong>{school.name}</strong>
                  {(school.city || school.board) && (
                    <small>{[school.city, school.board].filter(Boolean).join(' · ')}</small>
                  )}
                </span>
              </div>

              <div className="idc-kind">
                <span>Student identity card</span>
                <span>{session}</span>
              </div>

              <div className="idc-body">
                <div className="idc-photo">
                  {student.photoUrl ? (
                    <img src={student.photoUrl} alt="" width={96} height={120} />
                  ) : (
                    <span className="idc-photo-empty">
                      <svg viewBox="0 0 96 120" aria-hidden="true">
                        <circle cx="48" cy="46" r="22" />
                        <path d="M10 120c4-26 20-38 38-38s34 12 38 38Z" />
                      </svg>
                      <b>{initials(student.name)}</b>
                    </span>
                  )}
                </div>
                <div className="idc-name-block">
                  <span className="idc-name">{student.name}</span>
                  {classLine && <span className="idc-class">{classLine}</span>}
                </div>
              </div>

              <dl className="idc-details">
                <div>
                  <dt>GR no.</dt>
                  <dd>{student.grNumber || '—'}</dd>
                </div>
                <div>
                  <dt>Date of birth</dt>
                  <dd>{student.dateOfBirth || '—'}</dd>
                </div>
                <div>
                  <dt>Gender</dt>
                  <dd>{student.gender || '—'}</dd>
                </div>
                <div>
                  <dt>Valid till</dt>
                  <dd>31 Mar 20{session.slice(-2)}</dd>
                </div>
              </dl>

              <div className="idc-front-sign">
                <span className="idc-card-no">
                  <span>Card no.</span>
                  <b>{cardNumber}</b>
                </span>
                <span className="idc-sign">
                  <span className="idc-sign-line" />
                  <span>Principal</span>
                </span>
              </div>

              <div className="idc-foot" aria-hidden="true" />
              {isExample && <span className="idc-example">Example</span>}
              <span className="idc-sheen" aria-hidden="true" />
            </div>

            {/* ---------- Back ---------- */}
            <div className="idc-face idc-back">
              <span className="idc-slot" aria-hidden="true" />
              <div className="idc-back-band" />

              <div className="idc-back-block">
                <span className="idc-back-label">Parent or guardian</span>
                <strong>{student.parentName || '—'}</strong>
                <span className="idc-back-phone">{student.parentPhone || '—'}</span>
              </div>

              <div className="idc-back-block">
                <span className="idc-back-label">If found, please return to</span>
                <strong>{school.name}</strong>
                {school.city && <span>{school.city}</span>}
              </div>

              <ul className="idc-rules">
                <li>Wear this card at all times on school premises.</li>
                <li>Show it at the gate, library and canteen.</li>
                <li>Report a lost card to the school office the same day.</li>
              </ul>

              <div className="idc-scan">
                <span className="idc-bars" aria-hidden="true">
                  {bars.map((b, i) => (
                    <i key={i} style={{ width: b.w, marginRight: b.gap }} />
                  ))}
                </span>
                <span className="idc-scan-label">{student.grNumber || 'GR number'} · Gate and library scan</span>
              </div>

              <div className="idc-sign">
                <span className="idc-sign-line" />
                <span>Principal</span>
              </div>
              {isExample && <span className="idc-example">Example</span>}
            </div>
          </motion.button>
        </motion.div>
      </motion.div>
    </div>
  );
}
