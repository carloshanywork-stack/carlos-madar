const assert = require('node:assert/strict')
const test = require('node:test')
const {
  CURRENT_SCHEMA_VERSION,
  MADAR_APPLICATION_ID,
  validateBackupVersionMetadata,
  validateDatabaseSchemaMetadata,
} = require('../src/schema-version')

test('accepts Madar markers and unmarked legacy databases only', () => {
  assert.equal(validateDatabaseSchemaMetadata(0, 0).legacy, true)
  assert.deepEqual(validateDatabaseSchemaMetadata(MADAR_APPLICATION_ID, CURRENT_SCHEMA_VERSION), {
    applicationId: MADAR_APPLICATION_ID,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    legacy: false,
  })
  assert.throws(() => validateDatabaseSchemaMetadata(7, 1), /تطبيق آخر/)
  assert.throws(() => validateDatabaseSchemaMetadata(0, CURRENT_SCHEMA_VERSION), /غير متوافقة/)
  assert.throws(() => validateDatabaseSchemaMetadata(MADAR_APPLICATION_ID, CURRENT_SCHEMA_VERSION + 1), /أحدث/)
})

test('rejects backups with future application or schema versions', () => {
  assert.equal(validateBackupVersionMetadata({ applicationVersion: '0.9.0', schemaVersion: 1 }, '1.0.0'), true)
  assert.throws(() => validateBackupVersionMetadata({ applicationVersion: '2.0.0' }, '1.0.0'), /إصدار التطبيق/)
  assert.throws(() => validateBackupVersionMetadata({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 }, '1.0.0'), /مخطط النسخة/)
})
