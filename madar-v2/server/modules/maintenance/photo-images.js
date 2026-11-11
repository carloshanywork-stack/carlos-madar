import sharp from 'sharp';

/**
 * Applies a saved user rotation to an in-memory image buffer. EXIF orientation is
 * normalized first so the saved angle means the same thing in every consumer.
 * The source file is never modified.
 */
export async function applyPhotoRotation(source, angle) {
  if (![90, 180, 270].includes(Number(angle))) {
    throw new TypeError('Photo rotation must be 90, 180, or 270 degrees.');
  }

  const exifOriented = await sharp(source, { failOn: 'none' }).rotate().toBuffer();
  return sharp(exifOriented, { failOn: 'none' })
    .rotate(Number(angle))
    .jpeg({ quality: 94 })
    .toBuffer();
}
