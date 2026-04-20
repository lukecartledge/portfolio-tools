import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig, IMAGE_EXTENSIONS } from './config.js'
import {
  hasSidecar,
  sidecarPathFor,
  readSidecar,
  writeSidecar,
  createEmptySidecar,
  markPublished,
} from './sidecar.js'
import { analyzePhoto } from './analyzer.js'
import { publishPhoto } from './publisher.js'
import { startWatcher } from './watcher.js'
import { startServer } from './server/start.js'
import { errorMessage } from './utils.js'

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
  publish: '',
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
    await runAnalyze()
    break
  case 'watch':
    runWatch()
    break
  case 'publish':
    await runPublish()
    break
  case 'dev':
    runDev()
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

async function runAnalyze() {
  console.log(`Scanning: ${config.watchDir}`)

  const collections = await readdir(config.watchDir)
  let analyzed = 0
  let skipped = 0

  for (const collectionName of collections) {
    const collectionPath = join(config.watchDir, collectionName)
    const collectionStat = await stat(collectionPath).catch(() => null)
    if (!collectionStat?.isDirectory()) continue

    const files = await readdir(collectionPath)

    for (const file of files) {
      const ext = extname(file).toLowerCase()
      if (!IMAGE_EXTENSIONS.has(ext)) continue

      const filePath = join(collectionPath, file)

      if (hasSidecar(filePath)) {
        skipped++
        continue
      }

      console.log(`\nAnalyzing: ${collectionName}/${file}`)
      const sidecar = createEmptySidecar(file, collectionName)

      try {
        const { exif, ai } = await analyzePhoto(filePath, config.anthropic.apiKey, {
          collection: collectionName,
          filename: file,
        })
        sidecar.exif = exif
        sidecar.ai = ai
        await writeSidecar(sidecarPathFor(filePath), sidecar)
        console.log(`  Title: ${ai.title}`)
        console.log(`  Tags: ${ai.tags.join(', ')}`)
        analyzed++
      } catch (error) {
        console.error(`  Failed: ${errorMessage(error)}`)
        await writeSidecar(sidecarPathFor(filePath), sidecar)
      }
    }
  }

  console.log(`\nDone. Analyzed: ${analyzed}, Skipped: ${skipped}`)
}

function runWatch() {
  console.log('Starting watcher (Ctrl+C to stop)...')
  startWatcher(config)
}

async function runPublish() {
  console.log(`Publishing approved photos from: ${config.watchDir}`)

  const collections = await readdir(config.watchDir)
  let published = 0
  let errors = 0

  for (const collectionName of collections) {
    const collectionPath = join(config.watchDir, collectionName)
    const collectionStat = await stat(collectionPath).catch(() => null)
    if (!collectionStat?.isDirectory()) continue

    const files = await readdir(collectionPath)

    for (const file of files) {
      const ext = extname(file).toLowerCase()
      if (!IMAGE_EXTENSIONS.has(ext)) continue

      const filePath = join(collectionPath, file)
      const sidecarPath = sidecarPathFor(filePath)

      if (!hasSidecar(filePath)) continue

      const sidecar = await readSidecar(sidecarPath)
      if (sidecar.status !== 'approved') continue

      console.log(`\nPublishing: ${collectionName}/${file}`)
      console.log(`  Title: ${sidecar.ai.title}`)

      try {
        const result = await publishPhoto(filePath, sidecar, config)
        await markPublished(sidecarPath, sidecar, result)
        console.log(`  Published: entry ${result.entryId}`)
        published++
      } catch (error) {
        console.error(`  Failed: ${errorMessage(error)}`)
        errors++
      }
    }
  }

  console.log(`\nDone. Published: ${published}, Errors: ${errors}`)
}

function runDev(): void {
  const watcher = startWatcher(config)
  const server = startServer(config)
  console.log('Press Ctrl+C to stop.\n')

  let shuttingDown = false
  const shutdown = () => {
    if (shuttingDown) return
    shuttingDown = true
    console.log('\nShutting down...')
    server.close()
    void watcher.close()
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
