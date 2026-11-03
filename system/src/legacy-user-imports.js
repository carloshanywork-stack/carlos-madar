const LEGACY_USER_IMPORT_NAME = /^Users_Import_.+_\d+_[0-9a-f-]{36}\.xlsx?$/i

function isLegacyUserImportStoragePath(value) {
  const segments = String(value || '').replace(/\\/g, '/').split('/').filter(Boolean)
  return segments.length >= 3
    && segments[0].toLowerCase() === 'uploads'
    && segments[1].toLowerCase() === 'excel'
    && LEGACY_USER_IMPORT_NAME.test(segments.at(-1))
}

module.exports = { isLegacyUserImportStoragePath }
