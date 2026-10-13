import { motion } from 'motion/react';
import { CategoryOutlineIllustration } from './CategoryOutlineIllustration';

export interface ProductImageProps {
  id: string;
  name: string;
  category: string;
  imageUrl?: string;
  priority?: boolean;
  className?: string;
}

export function ProductImage({
  id,
  name,
  category,
  imageUrl,
  priority = false,
  className = '',
}: ProductImageProps) {
  return (
    <div
      className={`product-image-container ${className}`.trim()}
      style={{
        // Photos are square; the drawn stand-in keeps the taller frame
        aspectRatio: imageUrl ? '1 / 1' : '4 / 5',
        backgroundColor: 'var(--paper-sunk)',
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
        <motion.img
          layoutId={`product-img-${id}`}
          src={imageUrl}
          alt={name}
          loading={priority ? 'eager' : 'lazy'}
          width={400}
          height={500}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transition: 'transform var(--duration-ui) var(--ease-spring)',
          }}
        />
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
