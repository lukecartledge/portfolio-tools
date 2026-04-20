import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { multiselect, confirm, spinner, isCancel, cancel } from '@clack/prompts'
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
import { mergeMetadata } from './types.js'
import type { Sidecar } from './types.js'

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
    '  --dry-run        Show what would be published without publishing\n  --all            Publish all approved photos without prompts\n',
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
  console.log(`Scanning: ${config.watchDir}\n`)

  const collections = await readdir(config.watchDir)
  let analyzed = 0
  let skipped = 0
  let failed = 0

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

      const s = spinner()
      s.start(`Analyzing: ${collectionName}/${file}`)
      const sidecar = createEmptySidecar(file, collectionName)

      try {
        const { exif, ai } = await analyzePhoto(filePath, config.anthropic.apiKey, {
          collection: collectionName,
          filename: file,
        })
        sidecar.exif = exif
        sidecar.ai = ai
        await writeSidecar(sidecarPathFor(filePath), sidecar)
        s.stop(`${collectionName}/${file} — ${ai.title} [${ai.tags.join(', ')}]`)
        analyzed++
      } catch (error) {
        await writeSidecar(sidecarPathFor(filePath), sidecar)
        s.stop(`${collectionName}/${file} — failed: ${errorMessage(error)}`)
        failed++
      }
    }
  }

  console.log(
    `\nDone. Analyzed: ${analyzed}, Skipped: ${skipped}${failed > 0 ? `, Failed: ${failed}` : ''}`,
  )
}

function runWatch() {
  console.log('Starting watcher (Ctrl+C to stop)...')
  startWatcher(config)
}

interface ApprovedPhoto {
  filePath: string
  sidecarPath: string
  collection: string
  filename: string
  sidecar: Sidecar
}

async function scanApprovedPhotos(watchDir: string): Promise<ApprovedPhoto[]> {
  const collections = await readdir(watchDir)
  const approved: ApprovedPhoto[] = []

  for (const collectionName of collections) {
    const collectionPath = join(watchDir, collectionName)
    const collectionStat = await stat(collectionPath).catch(() => null)
    if (!collectionStat?.isDirectory()) continue

    const files = await readdir(collectionPath)

    for (const file of files) {
      const ext = extname(file).toLowerCase()
      if (!IMAGE_EXTENSIONS.has(ext)) continue

      const filePath = join(collectionPath, file)
      if (!hasSidecar(filePath)) continue

      const sidecarPath = sidecarPathFor(filePath)
      const sidecar = await readSidecar(sidecarPath)
      if (sidecar.status !== 'approved') continue

      approved.push({ filePath, sidecarPath, collection: collectionName, filename: file, sidecar })
    }
  }

  return approved
}

function printPublishTable(photos: ApprovedPhoto[]): void {
  for (const photo of photos) {
    const effective = mergeMetadata(photo.sidecar.ai, photo.sidecar.userEdits)
    console.log(`  ${photo.collection}/${photo.filename}`)
    console.log(`    Title: ${effective.title}`)
    console.log(`    Tags:  ${effective.tags.join(', ') || '(none)'}`)
  }
}

async function publishSinglePhoto(photo: ApprovedPhoto): Promise<boolean> {
  const effective = mergeMetadata(photo.sidecar.ai, photo.sidecar.userEdits)
  const s = spinner()
  s.start(`Publishing: ${photo.collection}/${photo.filename}`)

  try {
    const result = await publishPhoto(photo.filePath, photo.sidecar, config)
    await markPublished(photo.sidecarPath, photo.sidecar, result)
    s.stop(`Published: ${effective.title} (${result.entryId})`)
    return true
  } catch (error) {
    s.stop(`Failed: ${photo.collection}/${photo.filename} — ${errorMessage(error)}`)
    return false
  }
}

async function runPublish() {
  const photos = await scanApprovedPhotos(config.watchDir)

  if (photos.length === 0) {
    console.log('No approved photos to publish.')
    return
  }

  console.log(`Found ${photos.length} approved photo${photos.length === 1 ? '' : 's'}:\n`)
  printPublishTable(photos)

  if (values['dry-run']) {
    return
  }

  let toPublish: ApprovedPhoto[]

  if (values.all || !process.stdout.isTTY) {
    toPublish = photos
  } else {
    console.log()
    const selected = await multiselect({
      message: 'Select photos to publish:',
      options: photos.map((photo) => {
        const effective = mergeMetadata(photo.sidecar.ai, photo.sidecar.userEdits)
        return {
          value: photo.filePath,
          label: `${photo.collection}/${photo.filename}`,
          hint: effective.title,
        }
      }),
    })

    if (isCancel(selected)) {
      cancel('Publish cancelled.')
      return
    }

    toPublish = photos.filter((p) => selected.includes(p.filePath))
  }

  if (toPublish.length === 0) {
    console.log('No photos selected.')
    return
  }

  if (!values.all && process.stdout.isTTY) {
    const proceed = await confirm({
      message: `Publish ${toPublish.length} photo${toPublish.length === 1 ? '' : 's'} to Contentful?`,
    })

    if (isCancel(proceed) || !proceed) {
      cancel('Publish cancelled.')
      return
    }
  }

  let published = 0
  let errors = 0

  for (const photo of toPublish) {
    const ok = await publishSinglePhoto(photo)
    if (ok) {
      published++
    } else {
      errors++
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
