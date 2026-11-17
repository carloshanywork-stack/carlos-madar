/**
 * MADAR Client-Side Image Processing Engine
 * Offloads image scaling, compression, and EXIF orientation normalization
 * from the server to the client's CPU/GPU via Canvas / OffscreenCanvas.
 */

export async function compressImageOnClient(fileOrBlob, options = {}) {
  const {
    maxWidth = 1280,
    maxHeight = 1280,
    quality = 0.75,
    mimeType = 'image/jpeg',
  } = options;

  if (typeof window === 'undefined') {
    return fileOrBlob;
  }

  // If already small enough, return directly
  if (fileOrBlob.size < 150 * 1024 && fileOrBlob.type === mimeType) {
    return fileOrBlob;
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(fileOrBlob);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      try {
        let { width, height } = img;
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
        if (!ctx) {
          resolve(fileOrBlob);
          return;
        }

        // High quality bicubic downscaling
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob && blob.size < fileOrBlob.size) {
              resolve(blob);
            } else {
              resolve(fileOrBlob);
            }
          },
          mimeType,
          quality,
        );
      } catch (err) {
        resolve(fileOrBlob);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(fileOrBlob);
    };

    img.src = objectUrl;
  });
}

/**
 * Converts image Blob/URL to base64 data URL for document embeds
 */
export async function imageToDataUrl(blobOrUrl) {
  if (typeof blobOrUrl === 'string' && blobOrUrl.startsWith('data:')) {
    return blobOrUrl;
  }

  let blob = blobOrUrl;
  if (typeof blobOrUrl === 'string') {
    const res = await fetch(blobOrUrl);
    blob = await res.blob();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
