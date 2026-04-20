import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.js'
import { runAnalyze } from './commands/analyze.js'
import { runWatch } from './commands/watch.js'
import { runPublish } from './commands/publish.js'
import { runDev } from './commands/dev.js'

import 'dotenv/config'

const __dirname = dirname(fileURLToPath(import.meta.url))

function readPackageVersion(): string {
  const raw: unknown = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'))
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'version' in raw &&
    typeof raw.version === 'string'
  ) {
    return raw.version
  }
  return '0.0.0'
}

const VERSION = readPackageVersion()

const COMMANDS = ['analyze', 'watch', 'publish', 'dev'] as const
type Command = (typeof COMMANDS)[number]

function isCommand(value: string): value is Command {
  return (COMMANDS as readonly string[]).includes(value)
}

const COMMAND_DESCRIPTIONS: Record<Command, string> = {
  analyze: 'Scan watch directory and analyze new photos',
  watch: 'Watch directory for new photos (continuous)',
  publish: 'Publish approved photos to Contentful',
  dev: 'Start watcher and review server together',
}

const COMMAND_OPTIONS: Record<Command, string> = {
  analyze: '',
  watch: '',
  publish:
    '  --dry-run        Show what would be published without publishing\n  --all            Publish all approved photos without prompts\n  --force          Re-publish photos that were already published\n',
  dev: '  --port <port>    Server port (default: 3000)\n',
}

function parseCliArgs() {
  try {
    return parseArgs({
      args: process.argv.slice(2),
      options: {
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
        dir: { type: 'string' },
        verbose: { type: 'boolean', default: false },
        port: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        all: { type: 'boolean', default: false },
        force: { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: true,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Error: ${message}\n`)
    printGlobalHelp()
    process.exit(1)
  }
}

const { values, positionals } = parseCliArgs()

if (values.version) {
  console.log(`portfolio-tools v${VERSION}`)
  process.exit(0)
}

const command = positionals[0]

if (!command || !isCommand(command)) {
  printGlobalHelp()
  process.exit(values.help ? 0 : 1)
}

if (values.help) {
  printCommandHelp(command)
  process.exit(0)
}

// Override config from CLI flags
if (values.dir) {
  process.env.WATCH_DIR = values.dir
}
if (values.port) {
  process.env.PORT = values.port
}

const config = loadConfig()

switch (command) {
  case 'analyze':
    await runAnalyze(config)
    break
  case 'watch':
    runWatch(config)
    break
  case 'publish':
    await runPublish(config, {
      dryRun: values['dry-run'],
      all: values.all,
      force: values.force,
    })
    break
  case 'dev':
    runDev(config)
    break
}

function printGlobalHelp(): void {
  const commands = Object.entries(COMMAND_DESCRIPTIONS)
    .map(([cmd, desc]) => `  ${cmd.padEnd(12)}${desc}`)
    .join('\n')

  console.log(`portfolio-tools v${VERSION}

Usage: portfolio-tools <command> [options]

Commands:
${commands}

Options:
  -h, --help       Show help
  -v, --version    Show version
  --dir <path>     Override watch directory
  --verbose        Enable verbose output

Run 'portfolio-tools <command> --help' for command-specific options.`)
}

function printCommandHelp(cmd: Command): void {
  const extra = COMMAND_OPTIONS[cmd]

  console.log(`Usage: portfolio-tools ${cmd} [options]

${COMMAND_DESCRIPTIONS[cmd]}

Options:
${extra}  --dir <path>     Override watch directory
  --verbose        Enable verbose output
  -h, --help       Show help`)
}
