const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

test('fatal process errors are logged before the process exits', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'madar-runtime-test-'))
  try {
    const runtimeModule = path.resolve(__dirname, '..', 'src', 'runtime.js')
    const script = `require(${JSON.stringify(runtimeModule)}).registerProcessHandlers(${JSON.stringify(tempRoot)}); setImmediate(() => { throw new Error('test fatal error') })`
    const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 10000 })
    assert.equal(result.status, 1)
    const log = fs.readFileSync(path.join(tempRoot, 'error.log'), 'utf8')
    assert.match(log, /Uncaught exception: Error: test fatal error/)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})
