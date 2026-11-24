import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { CategoryOutlineIllustration } from './CategoryOutlineIllustration';
import '../ui/skeleton.css';

/** Portrait = the 2:3 photos of a child wearing the item; square = item close-ups. */
export type ProductFrame = 'portrait' | 'square';

const FRAME_RATIO: Record<ProductFrame, number> = { portrait: 2 / 3, square: 1 };

/** The cream the item close-ups are shot on, so a close-up in a taller frame has no visible edge. */
const CLOSE_UP_BACKGROUND = 'rgb(238, 233, 223)';

/** Portrait photos are the KV child shots; everything else is a square close-up. */
export function frameForImage(imageUrl?: string): ProductFrame {
  return imageUrl?.includes('/products/kv-') ? 'portrait' : 'square';
}

export interface ProductImageProps {
  id: string;
  name: string;
  category: string;
  imageUrl?: string;
  /** What the photo shows. Falls back to the item's name. */
  alt?: string;
  /** Pixel size of the file, so the page reserves the right space before it loads. */
  imageSize?: number;
  priority?: boolean;
  className?: string;
  /**
   * One frame shape for every card in a list, so a uniform and an accessory line up.
   * A photo of another shape is shown whole inside it. Defaults to the photo's own shape.
   */
  frame?: ProductFrame;
}

export function ProductImage({
  id,
  name,
  category,
  imageUrl,
  alt,
  imageSize = 400,
  priority = false,
  className = '',
  frame,
}: ProductImageProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [photoRatio, setPhotoRatio] = useState<number | null>(null);

  const shape = frame ?? (imageUrl ? frameForImage(imageUrl) : null);
  const frameRatio = shape ? FRAME_RATIO[shape] : 4 / 5;

  const markLoaded = (img: HTMLImageElement) => {
    if (img.naturalWidth && img.naturalHeight) setPhotoRatio(img.naturalWidth / img.naturalHeight);
    setLoaded(true);
  };

  // A new photo starts loading again; one already in the browser cache may finish before React listens.
  useEffect(() => {
    setLoaded(false);
    setPhotoRatio(null);
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth) markLoaded(img);
  }, [imageUrl]);

  // Fill the frame when the photo has its shape; otherwise show all of it on the close-up cream.
  const fillsFrame = photoRatio === null || Math.abs(photoRatio - frameRatio) < 0.08;

  return (
    <div
      className={`product-image-container ${className}`.trim()}
      style={{
        aspectRatio: shape === 'portrait' ? '2 / 3' : shape === 'square' ? '1 / 1' : '4 / 5',
        backgroundColor: imageUrl && !fillsFrame ? CLOSE_UP_BACKGROUND : 'var(--paper-sunk)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // A real photo fills the frame; the drawn stand-in keeps a margin.
        padding: imageUrl ? 0 : '8%',
      }}
    >
      {imageUrl ? (
        <>
          <motion.img
            ref={imgRef}
            layoutId={`product-img-${id}`}
            src={imageUrl}
            alt={alt || name}
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            width={imageSize}
            height={imageSize}
            onLoad={(e) => markLoaded(e.currentTarget)}
            onError={() => setLoaded(true)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: fillsFrame ? 'cover' : 'contain',
              opacity: loaded ? 1 : 0,
              transition: 'opacity var(--duration-fast) var(--ease-standard)',
            }}
          />
          {/* Shimmer until the photo arrives */}
          {!loaded && (
            <span
              className="skeleton-box"
              aria-hidden="true"
              style={{ position: 'absolute', inset: 0, borderRadius: 0 }}
            />
          )}
        </>
      ) : (
        <motion.div
          layoutId={`product-img-${id}`}
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CategoryOutlineIllustration category={category} />
        </motion.div>
      )}
    </div>
  );
}
