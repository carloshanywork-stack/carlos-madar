import sharp from 'sharp';

/**
 * Applies a saved user rotation to an in-memory image buffer. EXIF orientation is
 * normalized first so the saved angle means the same thing in every consumer.
 * The source file is never modified.
 */
export async function applyPhotoRotation(source, angle) {
  if (![0, 90, 180, 270].includes(Number(angle))) {
    throw new TypeError('Photo rotation must be 0, 90, 180, or 270 degrees.');
  }

  const exifOriented = await sharp(source, { failOn: 'none' }).rotate().toBuffer();
  const pipeline = sharp(exifOriented, { failOn: 'none' });
  return (Number(angle) ? pipeline.rotate(Number(angle)) : pipeline)
    .jpeg({ quality: 94, mozjpeg: true })
    .toBuffer();
}
