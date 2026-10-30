#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const hookDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(hookDirectory, '../..')
const systemDirectory = path.join(repositoryRoot, 'system')
const targetFiles = [
  'system/src/components/orders/OrderFormModal.jsx',
  'system/src/App.jsx',
  'system/src/components/manufacturing/ManufacturingPage.jsx',
  'system/src/styles.css',
]

let inputText = ''
for await (const chunk of process.stdin) inputText += chunk

let input
try {
  input = JSON.parse(inputText || '{}')
} catch {
  process.stderr.write('[MADAR UI build hook] Could not parse hook input; skipping build.\n')
  input = null
  process.exitCode = 1
}

if (input) {
  const values = []
  const collectStrings = (value) => {
    if (typeof value === 'string') values.push(value)
    else if (Array.isArray(value)) value.forEach(collectStrings)
    else if (value && typeof value === 'object') Object.values(value).forEach(collectStrings)
  }
  collectStrings(input)

  const paths = values.map((value) => value.replaceAll('\\', '/').toLowerCase())
  const isTargetFile = paths.some((candidate) => targetFiles.some((target) => {
    const normalizedTarget = target.toLowerCase()
    return candidate === normalizedTarget || candidate.endsWith(`/${normalizedTarget}`)
  }))

  if (isTargetFile) {
    const command = process.platform === 'win32' ? 'npm.cmd run build' : 'npm run build'
    const result = spawnSync(command, {
      cwd: systemDirectory,
      encoding: 'utf8',
      shell: true,
      windowsHide: true,
    })

    if (result.stdout) process.stderr.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    if (result.error || result.status !== 0) {
      process.stderr.write(`[MADAR UI build hook] Build failed${result.status == null ? '' : ` (exit ${result.status})`}. Edits remain unblocked.\n`)
      if (result.error) process.stderr.write(`${result.error.message}\n`)
      process.exitCode = 1
    }
  }
}

process.stdout.write('{}\n')
