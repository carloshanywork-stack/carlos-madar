const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {
  findMissingDependencies,
  getStartupProblems,
  resolveClientBuildDirectory,
} = require('../src/startup-checks')

test('reports clear startup guidance for unsupported Node, missing dependencies, and frontend build', () => {
  const problems = getStartupProblems({
    nodeVersion: 'v20.19.0',
    missingDependencies: ['express', 'better-sqlite3'],
    clientEntryExists: false,
  })
  assert.equal(problems.length, 3)
  assert.match(problems[0], /Node\.js 22\+/)
  assert.match(problems[1], /npm install/)
  assert.match(problems[2], /npm run build/)
})

test('resolves dependencies independently and supports only the explicit isolated-test build path', () => {
  const systemRoot = path.resolve(__dirname, '..')
  const testBuild = path.join(os.tmpdir(), 'madar-test-client-build')
  assert.deepEqual(findMissingDependencies(['present', 'missing'], (name) => {
    if (name === 'missing') throw new Error('not installed')
  }), ['missing'])
  assert.equal(resolveClientBuildDirectory(systemRoot, { NODE_ENV: 'test', MADAR_TEST_CLIENT_BUILD_DIR: testBuild }), path.resolve(testBuild))
  assert.equal(resolveClientBuildDirectory(systemRoot, { NODE_ENV: 'production', MADAR_TEST_CLIENT_BUILD_DIR: testBuild }), path.join(systemRoot, 'dist'))
})

test('service entry point stops with setup guidance when its frontend build is missing', () => {
  const systemRoot = path.resolve(__dirname, '..')
  const missingBuild = path.join(os.tmpdir(), `madar-no-client-build-${process.pid}`)
  const result = spawnSync(process.execPath, [path.join(systemRoot, 'index.js')], {
    cwd: systemRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MADAR_TEST_CLIENT_BUILD_DIR: missingBuild,
    },
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /frontend build is missing/i)
  assert.match(result.stderr, /npm run build/)
})
