const fs = require('node:fs')
const path = require('node:path')

let shutdownHandler = null
let registered = false
let stopping = false

function setShutdownHandler(handler) {
  shutdownHandler = handler
}

function registerProcessHandlers(projectRoot) {
  if (registered) return
  registered = true
  const errorLog = path.join(projectRoot, 'error.log')

  const logFatal = (label, reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason))
    const record = `[${new Date().toISOString()}] ${label}: ${error.stack || error.message}\n`
    try { fs.appendFileSync(errorLog, record, 'utf8') } catch (writeError) {
      console.error('Could not write fatal error log:', writeError)
    }
    console.error(record)
  }

  const stop = async (code, label, reason) => {
    if (stopping) return
    stopping = true
    if (label) logFatal(label, reason)
    try {
      if (shutdownHandler) await shutdownHandler()
    } catch (error) {
      logFatal('Shutdown failure', error)
    } finally {
      process.exit(code)
    }
  }

  process.on('uncaughtException', (error) => { void stop(1, 'Uncaught exception', error) })
  process.on('unhandledRejection', (reason) => { void stop(1, 'Unhandled rejection', reason) })
  process.on('SIGINT', () => { void stop(0) })
  process.on('SIGTERM', () => { void stop(0) })
}

module.exports = { registerProcessHandlers, setShutdownHandler }
