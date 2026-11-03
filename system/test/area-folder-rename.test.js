const assert = require('node:assert/strict')
const { test } = require('node:test')
const { bindRenameErrorMessage, renameAreaFolder } = require('../src/area-folder-rename')

test('maps Windows EPERM during a folder bind rename to the friendly Arabic API error', async () => {
  const source = 'source-folder'
  const destination = 'machine-folder'
  const error = Object.assign(new Error('operation not permitted'), { code: 'EPERM' })
  let attemptedRename

  await assert.rejects(
    renameAreaFolder(async (from, to) => {
      attemptedRename = [from, to]
      throw error
    }, source, destination),
    (mappedError) => {
      assert.equal(mappedError.status, 400)
      assert.equal(mappedError.message, bindRenameErrorMessage)
      return true
    },
  )
  assert.deepEqual(attemptedRename, [source, destination])
})

test('preserves non-EPERM folder rename errors', async () => {
  const error = Object.assign(new Error('destination exists'), { code: 'EEXIST' })
  await assert.rejects(renameAreaFolder(async () => { throw error }, 'source', 'destination'), error)
})
