const assert = require('node:assert/strict')
const test = require('node:test')
const { filenameTimestamp, resolvePhotoTimestamp, splitTimedPhotos } = require('../src/photo-time')

test('extracts supported timestamp patterns from filenames and rejects invalid dates', () => {
  assert.equal(filenameTimestamp('ATM_2024-02-29T12-34-56.jpg'), Date.UTC(2024, 1, 29, 12, 34, 56))
  assert.equal(filenameTimestamp('IMG_20260201_091523.jpg'), Date.UTC(2026, 1, 1, 9, 15, 23))
  assert.equal(filenameTimestamp('photo-20240229.png'), Date.UTC(2024, 1, 29))
  assert.equal(filenameTimestamp('1712345678901-123e4567-e89b-12d3-a456-426614174000--IMG_20260201_091523.jpg'),
    Date.UTC(2026, 1, 1, 9, 15, 23))
  assert.equal(filenameTimestamp('photo-2023-02-29.jpg'), null)
})

test('keeps exact timestamp ties together in Before for later manual review', () => {
  const result = splitTimedPhotos([
    { relativePath: 'later.jpg', time: 4 },
    { relativePath: 'tie-b.jpg', time: 2 },
    { relativePath: 'earlier.jpg', time: 1 },
    { relativePath: 'tie-a.jpg', time: 2 },
  ])
  assert.deepEqual(result, {
    before: ['earlier.jpg', 'tie-a.jpg', 'tie-b.jpg'],
    after: ['later.jpg'],
  })
})

test('uses EXIF, filename, then file modification time as timestamp fallbacks', () => {
  const exifTime = Date.UTC(2024, 0, 2, 3, 4, 5)
  assert.equal(resolvePhotoTimestamp({
    metadata: { DateTimeOriginal: new Date(exifTime) },
    filePath: 'photo-20250103.jpg',
    birthtimeMs: Date.UTC(2026, 0, 1),
    mtimeMs: Date.UTC(2023, 0, 1),
  }), exifTime)
  assert.equal(resolvePhotoTimestamp({
    metadata: null,
    filePath: 'photo-20250103.jpg',
    birthtimeMs: Date.UTC(2026, 0, 1),
    mtimeMs: Date.UTC(2023, 0, 1),
  }), Date.UTC(2025, 0, 3))
  assert.equal(resolvePhotoTimestamp({
    metadata: null,
    filePath: 'photo.jpg',
    birthtimeMs: Date.UTC(2026, 0, 1),
    mtimeMs: Date.UTC(2025, 0, 1),
  }), Date.UTC(2025, 0, 1))
  assert.equal(resolvePhotoTimestamp({
    metadata: null,
    filePath: 'photo.jpg',
    mtimeMs: Date.UTC(2025, 0, 1),
  }), Date.UTC(2025, 0, 1))
})
