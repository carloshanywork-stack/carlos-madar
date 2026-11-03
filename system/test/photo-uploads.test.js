const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {
  cleanupAbandonedPhotoUploadWorkspaces,
  cleanupPhotoUploadWorkspace,
  createPhotoUploadWorkspace,
  createMultipartRequestLimit,
  createPhotoUploadConcurrencyGuard,
} = require('../src/photo-uploads')

test('cleans only a marked workspace containing app-named regular upload files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'madar-photo-temp-test-'))
  try {
    const workspace = await createPhotoUploadWorkspace(root)
    const filePath = path.join(workspace.directory, 'photo-123e4567-e89b-12d3-a456-426614174000.jpg')
    await fs.writeFile(filePath, 'temporary bytes')
    assert.equal(await cleanupPhotoUploadWorkspace(workspace), true)
    await assert.rejects(fs.stat(filePath), { code: 'ENOENT' })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('startup cleanup preserves unmarked or unknown temporary files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'madar-photo-stale-test-'))
  try {
    const owned = await createPhotoUploadWorkspace(root)
    const ownedFile = path.join(owned.directory, 'photo-123e4567-e89b-12d3-a456-426614174000.jpg')
    await fs.writeFile(ownedFile, 'temporary upload')
    await fs.utimes(owned.directory, new Date(0), new Date(0))
    const id = '123e4567-e89b-12d3-a456-426614174000'
    const unmarked = path.join(root, `.madar-photo-upload-${id}`)
    await fs.mkdir(unmarked)
    const protectedFile = path.join(unmarked, 'important-user-file.jpg')
    await fs.writeFile(protectedFile, 'keep')
    await fs.utimes(unmarked, new Date(0), new Date(0))
    await fs.writeFile(path.join(root, '1712345678901-random.jpg'), 'keep too')
    const result = await cleanupAbandonedPhotoUploadWorkspaces(root, { maxAgeMs: 1, now: Date.now() })
    assert.deepEqual(result, { removed: 1, preserved: 1 })
    await assert.rejects(fs.stat(owned.directory), { code: 'ENOENT' })
    assert.equal(await fs.readFile(protectedFile, 'utf8'), 'keep')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('limits active multi-photo uploads per process and order', () => {
  const guard = createPhotoUploadConcurrencyGuard(1)
  const firstRequest = new EventEmitter()
  firstRequest.params = { id: '1' }
  const firstResponse = new EventEmitter()
  let firstAccepted = false
  guard(firstRequest, firstResponse, () => { firstAccepted = true })
  assert.equal(firstAccepted, true)

  const secondResponse = {
    statusCode: 0,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
  const secondRequest = new EventEmitter()
  secondRequest.params = { id: '2' }
  guard(secondRequest, secondResponse, () => assert.fail('over limit upload passed'))
  assert.equal(secondResponse.statusCode, 429)
  firstResponse.emit('finish')

  const retryRequest = new EventEmitter()
  retryRequest.params = { id: '1' }
  const retryResponse = new EventEmitter()
  guard(retryRequest, retryResponse, () => {})
  retryResponse.emit('finish')
})

test('rejects declared multipart requests over the configured total byte cap', () => {
  const request = new EventEmitter()
  request.headers = { 'content-length': '2049' }
  request.destroy = () => {}
  const response = new EventEmitter()
  response.headers = {}
  response.setHeader = (name, value) => { response.headers[name] = value }
  response.status = (code) => { response.statusCode = code; return response }
  response.json = (body) => { response.body = body; return response }
  let nextCalled = false
  createMultipartRequestLimit(2048, 'too large')(request, response, () => { nextCalled = true })
  assert.equal(nextCalled, false)
  assert.equal(response.statusCode, 413)
  assert.deepEqual(response.body, { error: 'too large' })
})

test('rejects chunked multipart data when the observed total exceeds the configured cap', async () => {
  const { PassThrough, Writable } = require('node:stream')
  const request = new PassThrough()
  request.headers = {}
  const response = new EventEmitter()
  response.setHeader = () => {}
  createMultipartRequestLimit(8, 'too large')(request, response, () => {})
  const destination = new Writable({ write(_chunk, _encoding, callback) { callback() } })
  const exceeded = new Promise((resolve) => destination.once('error', resolve))
  request.pipe(destination)
  request.write(Buffer.alloc(4))
  request.write(Buffer.alloc(5))
  const error = await exceeded
  assert.equal(error.status, 413)
  assert.equal(request.photoUploadLimitExceeded, true)
})
