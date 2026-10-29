const CURRENT_SCHEMA_VERSION = 7
const MADAR_APPLICATION_ID = 0x4d414452

function validateDatabaseSchemaMetadata(applicationId, schemaVersion) {
  if (!Number.isSafeInteger(applicationId) || !Number.isSafeInteger(schemaVersion)
    || applicationId < 0 || schemaVersion < 0) {
    throw new Error('بيانات إصدار قاعدة البيانات غير صالحة.')
  }
  if (applicationId !== 0 && applicationId !== MADAR_APPLICATION_ID) {
    throw new Error('قاعدة البيانات تنتمي إلى تطبيق آخر ولا يمكن استعادتها في Madar.')
  }
  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(`مخطط قاعدة البيانات بالإصدار ${schemaVersion} أحدث من الإصدار المدعوم ${CURRENT_SCHEMA_VERSION}.`)
  }
  if ((schemaVersion > 0 && applicationId !== MADAR_APPLICATION_ID)
    || (applicationId === MADAR_APPLICATION_ID && schemaVersion === 0)) {
    throw new Error('علامات إصدار قاعدة البيانات غير متوافقة.')
  }
  return { applicationId, schemaVersion, legacy: applicationId === 0 && schemaVersion === 0 }
}

function parseApplicationMajor(version) {
  const match = String(version || '').match(/^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/)
  return match ? Number(match[1]) : null
}

function validateBackupVersionMetadata(manifest, currentApplicationVersion) {
  if (manifest?.schemaVersion !== undefined
    && (!Number.isSafeInteger(manifest.schemaVersion) || manifest.schemaVersion < 0
      || manifest.schemaVersion > CURRENT_SCHEMA_VERSION)) {
    throw new Error('إصدار مخطط النسخة الاحتياطية أحدث أو غير مدعوم.')
  }
  if (manifest?.applicationVersion !== undefined) {
    const backupMajor = parseApplicationMajor(manifest.applicationVersion)
    const currentMajor = parseApplicationMajor(currentApplicationVersion)
    if (backupMajor === null || currentMajor === null || backupMajor > currentMajor) {
      throw new Error('إصدار التطبيق داخل النسخة الاحتياطية غير مدعوم.')
    }
  }
  return true
}

module.exports = {
  CURRENT_SCHEMA_VERSION,
  MADAR_APPLICATION_ID,
  validateBackupVersionMetadata,
  validateDatabaseSchemaMetadata,
}
