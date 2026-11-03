const path = require('node:path')

const MINIMUM_NODE_MAJOR = 22

function resolveClientBuildDirectory(systemRoot, env = process.env) {
  if (env.NODE_ENV === 'test' && env.MADAR_TEST_CLIENT_BUILD_DIR) {
    return path.resolve(env.MADAR_TEST_CLIENT_BUILD_DIR)
  }
  return path.resolve(systemRoot, 'dist')
}

function getStartupProblems({ nodeVersion, missingDependencies = [], clientEntryExists }) {
  const nodeMajor = Number.parseInt(String(nodeVersion || '').replace(/^v/i, '').split('.')[0], 10)
  const problems = []
  if (!Number.isInteger(nodeMajor) || nodeMajor < MINIMUM_NODE_MAJOR) {
    problems.push(`Node.js ${MINIMUM_NODE_MAJOR}+ is required; found ${nodeVersion || 'unknown'}.`)
  }
  if (missingDependencies.length) {
    problems.push(`Dependencies are missing (${missingDependencies.join(', ')}); run npm install from the system directory.`)
  }
  if (!clientEntryExists) {
    problems.push('The frontend build is missing; run npm run build from the system directory before starting Madar.')
  }
  return problems
}

function findMissingDependencies(dependencyNames, resolveDependency) {
  return dependencyNames.filter((name) => {
    try {
      resolveDependency(name)
      return false
    } catch {
      return true
    }
  })
}

module.exports = {
  MINIMUM_NODE_MAJOR,
  findMissingDependencies,
  getStartupProblems,
  resolveClientBuildDirectory,
}
