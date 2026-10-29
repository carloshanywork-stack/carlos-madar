const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const { Transform } = require('node:stream')

const WORKSPACE_PREFIX = '.madar-photo-upload-'
const WORKSPACE_MARKER = '.madar-photo-upload.json'
const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const WORKSPACE_PATTERN = new RegExp(`^\\.madar-photo-upload-${UUID_PATTERN}$`, 'i')
const UPLOAD_FILE_PATTERN = new RegExp(`^photo-${UUID_PATTERN}\\.[a-z0-9]{1,10}$`, 'i')

function requestLimitError(message) {
  return Object.assign(new Error(message), { status: 413, code: 'LIMIT_REQUEST_SIZE' })
}

function createMultipartRequestLimit(maxBytes, message) {
  return (req, res, next) => {
    const contentLength = Number(req.headers?.['content-length'])
    if (Number.isSafeInteger(contentLength) && contentLength > maxBytes) {
      req.resume?.()
      return res.status(413).json({ error: message })
    }

    const originalPipe = req.pipe
    let pipeWrapped = false
    let totalBytes = 0
    req.pipe = function pipeWithSizeLimit(destination, options) {
      if (pipeWrapped) return originalPipe.call(this, destination, options)
      pipeWrapped = true
      const limiter = new Transform({
        transform(chunk, encoding, callback) {
          totalBytes += chunk.length
          if (totalBytes > maxBytes) {
            req.photoUploadLimitExceeded = true
            return callback(requestLimitError(message))
          }
          callback(null, chunk)
        },
      })
      limiter.once('error', (error) => {
        if (typeof destination.destroy === 'function' && !destination.destroyed) destination.destroy(error)
        req.unpipe?.(limiter)
        req.resume?.()
      })
      originalPipe.call(this, limiter)
      limiter.pipe(destination, options)
      return destination
    }

    const restorePipe = () => { req.pipe = originalPipe }
    res.once('finish', restorePipe)
    res.once('close', restorePipe)
    next()
  }
}

function createPhotoUploadConcurrencyGuard(maxConcurrent) {
  let activeCount = 0
  const activeOrders = new Set()
  return (req, res, next) => {
    const orderId = String(req.params?.id || '')
    if (!orderId) return res.status(400).json({ error: 'رقم أمر التشغيل غير صالح لرفع الصور.' })
    if (activeOrders.has(orderId)) {
      return res.status(409).json({ error: 'يوجد رفع صور آخر قيد التنفيذ لهذا الأمر؛ انتظر اكتماله ثم أعد المحاولة.' })
    }
    if (activeCount >= maxConcurrent) {
      return res.status(429).json({ error: 'بلغ النظام الحد الأقصى لعمليات رفع الصور المتزامنة؛ أعد المحاولة بعد اكتمال عملية أخرى.' })
    }

    activeCount += 1
    activeOrders.add(orderId)
    let released = false
    const release = () => {
      if (released) return
      released = true
      activeCount -= 1
      activeOrders.delete(orderId)
    }
    res.once('finish', release)
    res.once('close', release)
    req.once('aborted', release)
    try { next() } catch (error) { release(); throw error }
  }
}

async function createPhotoUploadWorkspace(incomingRoot) {
  const id = crypto.randomUUID()
  const directory = path.join(incomingRoot, `${WORKSPACE_PREFIX}${id}`)
  await fs.mkdir(directory, { recursive: false, mode: 0o700 })
  try {
    await fs.writeFile(path.join(directory, WORKSPACE_MARKER), JSON.stringify({ format: 'madar-photo-upload-v1', id }), {
      flag: 'wx', mode: 0o600,
    })
  } catch (error) {
    await fs.rmdir(directory).catch(() => {})
    throw error
  }
  return { id, directory, incomingRoot: path.resolve(incomingRoot) }
}

function preparePhotoUploadWorkspace(incomingRoot) {
  return (req, _res, next) => {
    void createPhotoUploadWorkspace(incomingRoot).then((workspace) => {
      req.photoUploadWorkspace = workspace
      req.photoUploadDirectory = workspace.directory
      next()
    }, next)
  }
}

async function cleanupPhotoUploadWorkspace(workspace) {
  if (!workspace?.directory || !workspace?.id || !workspace?.incomingRoot) return false
  const directory = path.resolve(workspace.directory)
  const incomingRoot = path.resolve(workspace.incomingRoot)
  if (path.dirname(directory) !== incomingRoot || path.basename(directory) !== `${WORKSPACE_PREFIX}${workspace.id}`
    || !WORKSPACE_PATTERN.test(path.basename(directory))) return false

  let directoryStats
  try {
    directoryStats = await fs.lstat(directory)
  } catch (error) {
    if (error.code === 'ENOENT') return true
    throw error
  }
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) return false

  const markerPath = path.join(directory, WORKSPACE_MARKER)
  let markerStats
  try { markerStats = await fs.lstat(markerPath) }
  catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
  if (!markerStats.isFile() || markerStats.isSymbolicLink()) return false
  let marker
  try { marker = JSON.parse(await fs.readFile(markerPath, 'utf8')) }
  catch { return false }
  if (marker.format !== 'madar-photo-upload-v1' || marker.id !== workspace.id) return false
  const entries = await fs.readdir(directory, { withFileTypes: true })

  const files = []
  for (const entry of entries) {
    if (entry.name === WORKSPACE_MARKER && entry.isFile() && !entry.isSymbolicLink()) continue
    if (!UPLOAD_FILE_PATTERN.test(entry.name) || !entry.isFile() || entry.isSymbolicLink()) return false
    files.push(path.join(directory, entry.name))
  }
  for (const file of files) await fs.unlink(file)
  await fs.unlink(path.join(directory, WORKSPACE_MARKER))
  await fs.rmdir(directory)
  return true
}

async function cleanupAbandonedPhotoUploadWorkspaces(incomingRoot, { maxAgeMs, now = Date.now() } = {}) {
  const root = path.resolve(incomingRoot)
  const rootStats = await fs.lstat(root).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
  if (!rootStats || !rootStats.isDirectory() || rootStats.isSymbolicLink()) return { removed: 0, preserved: 0 }

  let removed = 0
  let preserved = 0
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!WORKSPACE_PATTERN.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue
    const directory = path.join(root, entry.name)
    const stats = await fs.lstat(directory).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
    if (!stats || now - stats.mtimeMs < maxAgeMs) continue
    const id = entry.name.slice(WORKSPACE_PREFIX.length)
    const cleaned = await cleanupPhotoUploadWorkspace({ id, directory, incomingRoot: root }).catch(() => false)
    if (cleaned) removed += 1
    else preserved += 1
  }
  return { removed, preserved }
}

function photoUploadMulterCallback(upload) {
  return (req, res, next) => upload(req, res, (error) => {
    if (!error) return next()
    void cleanupPhotoUploadWorkspace(req.photoUploadWorkspace).catch((cleanupError) => {
      console.error('Could not clean the failed photo upload workspace:', cleanupError)
    }).finally(() => next(error))
  })
}

module.exports = {
  cleanupAbandonedPhotoUploadWorkspaces,
  cleanupPhotoUploadWorkspace,
  createPhotoUploadWorkspace,
  createMultipartRequestLimit,
  createPhotoUploadConcurrencyGuard,
  photoUploadMulterCallback,
  preparePhotoUploadWorkspace,
}
