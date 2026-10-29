const path = require('node:path')
const {
  findMissingDependencies,
  getStartupProblems,
  resolveClientBuildDirectory,
} = require('./src/startup-checks')

const systemRoot = __dirname
const manifest = require('./package.json')
const missingDependencies = findMissingDependencies(
  Object.keys(manifest.dependencies || {}),
  (name) => require.resolve(name, { paths: [systemRoot] }),
)
const clientBuildDirectory = resolveClientBuildDirectory(systemRoot, process.env)
const problems = getStartupProblems({
  nodeVersion: process.versions.node,
  missingDependencies,
  clientEntryExists: require('node:fs').existsSync(path.join(clientBuildDirectory, 'index.html')),
})

if (problems.length) {
  console.error(`Madar startup checks failed:\n${problems.map((problem) => `- ${problem}`).join('\n')}`)
  process.exit(1)
}

require(path.join(systemRoot, 'src', 'server.js'))
