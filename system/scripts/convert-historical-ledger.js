#!/usr/bin/env node

const { convertHistoricalLedger, readCrosswalk } = require('../src/historical-ledger-conversion')

function parseArguments(argv) {
  const options = { apply: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--apply') options.apply = true
    else if (['--source', '--output', '--crosswalk', '--actor-user-id'].includes(argument)) {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`)
      options[argument.slice(2).replaceAll('-', '')] = value
      index += 1
    } else if (argument === '--help' || argument === '-h') options.help = true
    else throw new Error(`Unknown option: ${argument}`)
  }
  return options
}

const usage = `Historical Madar issue conversion (dry-run by default)

  node scripts/convert-historical-ledger.js --source <read-only.sqlite> --crosswalk <crosswalk.json>
  node scripts/convert-historical-ledger.js --source <read-only.sqlite> --crosswalk <crosswalk.json> \\
    --output <new-copy.sqlite> --actor-user-id <active-admin-id> --apply

Crosswalk format:
  { "issues": {
      "<movement-id>": { "classification": "order", "orderId": 123, "offcutCostCents": 0 },
      "<movement-id>": { "classification": "general", "grossCostCents": 2500 }
  }}

Cost is taken from recorded FIFO lot consumptions when available. Otherwise provide
grossCostCents explicitly. offcutCostCents is optional and defaults to zero. The
source is never written; --apply creates a new output copy and refuses to overwrite it.`

async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(`${usage}\n`)
    return
  }
  if (!options.source || !options.crosswalk) throw new Error('--source and --crosswalk are required.')
  const crosswalk = readCrosswalk(options.crosswalk)
  const result = await convertHistoricalLedger({
    sourcePath: options.source,
    outputPath: options.output,
    crosswalk,
    actorUserId: options.actoruserid,
    apply: options.apply,
  })
  const printable = { ...result, entries: result.entries?.map((entry) => ({
    movementId: entry.movement.id,
    classification: entry.classification,
    orderId: entry.orderId,
    grossCostCents: entry.grossCostCents,
    offcutCostCents: entry.offcutCostCents,
  })) }
  process.stdout.write(`${JSON.stringify(printable, null, 2)}\n`)
  if (result.unresolved?.length) process.exitCode = 2
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  if (error.plan) process.stderr.write(`${JSON.stringify({ unresolved: error.plan.unresolved }, null, 2)}\n`)
  process.stderr.write('\nUse --help for usage.\n')
  process.exitCode = 1
})
