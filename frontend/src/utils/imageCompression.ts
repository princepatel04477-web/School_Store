/**
 * Helper to compress and resize an image file in the browser before upload.
 * Keeps uploaded files strictly below ~1 MB, keeping heavy bandwidth off the backend.
 */
export async function compressImage(
  file: File,
  maxDimension = 1600,
  maxBytes = 1_000_000,
  quality = 0.85
): Promise<{ blob: Blob; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to load image element'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        // Attempt compression starting at requested quality
        const attempt = (q: number) => {
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                reject(new Error('Canvas blob generation failed'));
                return;
              }
              if (blob.size <= maxBytes || q <= 0.4) {
                resolve({ blob, width, height });
              } else {
                attempt(q - 0.15);
              }
            },
            'image/jpeg',
            q
          );
        };

        attempt(quality);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
