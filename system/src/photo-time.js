const path = require('node:path')

function toTimestamp(year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) {
  const values = [year, month, day, hour, minute, second, millisecond].map(Number)
  const [y, m, d, h, min, s, ms] = values
  if (m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || min > 59 || s > 59 || ms > 999) return null
  const date = new Date(Date.UTC(y, m - 1, d, h, min, s, ms))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d
    || date.getUTCHours() !== h || date.getUTCMinutes() !== min || date.getUTCSeconds() !== s) return null
  return date.getTime()
}

function filenameTimestamp(filePath) {
  const storedName = path.basename(String(filePath || ''))
  const filename = storedName.replace(/^\d{13}-[0-9a-f-]{36}--/i, '')
  const patterns = [
    /(?<!\d)(\d{4})[-_](\d{2})[-_](\d{2})[T _-](\d{2})[-_:](\d{2})[-_:](\d{2})(?:[.,](\d{1,3}))?(?!\d)/,
    /(?<!\d)(\d{4})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})(?:[._-](\d{1,3}))?(?!\d)/,
    /(?<!\d)(\d{4})[-_](\d{2})[-_](\d{2})(?!\d)/,
    /(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/,
  ]
  for (const pattern of patterns) {
    const match = filename.match(pattern)
    if (!match) continue
    const fraction = match[7] ? Number(`0.${match[7]}`) * 1000 : 0
    const timestamp = toTimestamp(...match.slice(1, 7), Math.floor(fraction))
    if (timestamp !== null) return timestamp
  }
  const epoch = filename.match(/(?:^|[^\d])((?:1[5-9]\d{8}|2\d{9})|(?:1[5-9]\d{11}|2\d{12}))(?!\d)/)
  if (epoch) {
    const value = Number(epoch[1])
    const timestamp = epoch[1].length === 13 ? value : value * 1000
    if (Number.isFinite(timestamp) && timestamp >= Date.UTC(2000, 0, 1) && timestamp <= Date.now() + 86_400_000) return timestamp
  }
  return null
}

function resolvePhotoTimestamp({ metadata, filePath, mtimeMs }) {
  const exifValue = metadata && (metadata.DateTimeOriginal || metadata.CreateDate)
  const exifDate = exifValue instanceof Date ? exifValue : exifValue ? new Date(exifValue) : null
  if (exifDate && !Number.isNaN(exifDate.getTime())) return exifDate.getTime()

  const fromFilename = filenameTimestamp(filePath)
  if (fromFilename !== null) return fromFilename

  const modifiedAt = Number(mtimeMs)
  return Number.isFinite(modifiedAt) && modifiedAt >= 0 ? modifiedAt : 0
}

function splitTimedPhotos(entries) {
  const timed = [...entries].sort((a, b) => a.time - b.time || String(a.relativePath).localeCompare(String(b.relativePath)))
  if (timed.length < 2) return { before: timed.map((item) => item.relativePath), after: [] }
  let splitAt = Math.ceil(timed.length / 2)
  let largestGap = 0
  for (let index = 1; index < timed.length; index += 1) {
    const gap = timed[index].time - timed[index - 1].time
    if (gap > largestGap) {
      largestGap = gap
      splitAt = index
    }
  }
  if (largestGap < 90_000) splitAt = Math.ceil(timed.length / 2)
  if (splitAt > 0 && splitAt < timed.length && timed[splitAt - 1].time === timed[splitAt].time) {
    const tiedTimestamp = timed[splitAt].time
    while (splitAt < timed.length && timed[splitAt].time === tiedTimestamp) splitAt += 1
  }
  return {
    before: timed.slice(0, splitAt).map((item) => item.relativePath),
    after: timed.slice(splitAt).map((item) => item.relativePath),
  }
}

module.exports = { filenameTimestamp, resolvePhotoTimestamp, splitTimedPhotos }
