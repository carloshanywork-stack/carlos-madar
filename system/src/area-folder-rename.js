const bindRenameErrorMessage = 'لا يمكن تعديل المجلد لأنه مفتوح في برنامج آخر. يرجى إغلاق المجلد والمحاولة مرة أخرى.'

async function renameAreaFolder(rename, source, destination) {
  try {
    await rename(source, destination)
  } catch (error) {
    if (error?.code === 'EPERM') {
      const friendlyError = new Error(bindRenameErrorMessage)
      friendlyError.status = 400
      throw friendlyError
    }
    throw error
  }
}

module.exports = { bindRenameErrorMessage, renameAreaFolder }
