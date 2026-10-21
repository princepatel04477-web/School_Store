import { useEffect, useState } from 'react';
import { ChevronRight, Ruler } from '../ui/icons';
import { useLang } from '../../i18n';
import './product.css';

/** How long the size guide pop-up shows when a product page opens. */
const INTRO_MS = 1000;
/** After the pop-up, the docked button changes colour twice so the eye finds it. */
const FRESH_MS = 2400;

export interface SizeGuideNoticeProps {
  /** A new product shows the pop-up again. */
  productId: string;
  onOpen: () => void;
}

/**
 * The size guide, made hard to miss for parents who don't know their child's
 * size: a short pop-up as the page opens, then a notice-style button above the
 * sizes. Colour only, nothing moves.
 */
export function SizeGuideNotice({ productId, onOpen }: SizeGuideNoticeProps) {
  const { t } = useLang();
  const [intro, setIntro] = useState(true);
  const [fresh, setFresh] = useState(false);

  useEffect(() => {
    setIntro(true);
    setFresh(false);
    const toButton = window.setTimeout(() => {
      setIntro(false);
      setFresh(true);
    }, INTRO_MS);
    const settle = window.setTimeout(() => setFresh(false), INTRO_MS + FRESH_MS);
    return () => {
      window.clearTimeout(toButton);
      window.clearTimeout(settle);
    };
  }, [productId]);

  const open = () => {
    setIntro(false);
    setFresh(false);
    onOpen();
  };

  return (
    <>
      <button type="button" className={`size-guide-notice ${fresh ? 'is-fresh' : ''}`} onClick={open}>
        <Ruler width={24} height={24} strokeWidth={1.5} aria-hidden="true" />
        <span className="size-guide-notice-text">
          <b>{t('product.sizeGuide')}</b>
          <span>{t('product.sizeGuideHint')}</span>
        </span>
        <ChevronRight width={20} height={20} aria-hidden="true" />
      </button>

      {intro && (
        <div className="size-guide-intro" onClick={() => setIntro(false)}>
          <button type="button" className="size-guide-intro-card" role="status" onClick={(e) => { e.stopPropagation(); open(); }}>
            <Ruler width={36} height={36} strokeWidth={1.5} aria-hidden="true" />
            <b>{t('product.sizeGuide')}</b>
            <span>{t('product.sizeGuideIntro')}</span>
          </button>
        </div>
      )}
    </>
  );
}
