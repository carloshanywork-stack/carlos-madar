const assert = require('node:assert/strict')
const test = require('node:test')
const { isLegacyUserImportStoragePath } = require('../src/legacy-user-imports')

test('matches only generated legacy user import workbook paths', () => {
  assert.equal(isLegacyUserImportStoragePath('Uploads/Excel/Users_Import_users_1761000000000_123e4567-e89b-12d3-a456-426614174000.xlsx'), true)
  assert.equal(isLegacyUserImportStoragePath('Uploads/Excel/Users_Import_users_1761000000000_123e4567-e89b-12d3-a456-426614174000.xls'), true)
  assert.equal(isLegacyUserImportStoragePath('Uploads/Excel/Machines_Import_machines_1761000000000_123e4567-e89b-12d3-a456-426614174000.xlsx'), false)
  assert.equal(isLegacyUserImportStoragePath('Uploads/Excel/Users_Import_users.xlsx'), false)
  assert.equal(isLegacyUserImportStoragePath('Uploads/Excel/Nested/Users_Import_users_1761000000000_123e4567-e89b-12d3-a456-426614174000.xlsx'), true)
})
