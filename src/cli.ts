import { readdir, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { loadConfig, IMAGE_EXTENSIONS } from './config.js'
import {
  hasSidecar,
  sidecarPathFor,
  readSidecar,
  writeSidecar,
  createEmptySidecar,
} from './sidecar.js'
import { analyzePhoto } from './analyzer.js'
import { publishPhoto } from './publisher.js'
import { startWatcher } from './watcher.js'
import { errorMessage } from './utils.js'

import 'dotenv/config'

const command = process.argv[2]

if (!command || !['analyze', 'watch', 'publish'].includes(command)) {
  console.log(`Usage: portfolio-tools <command>

Commands:
  analyze   Scan watch directory and analyze new photos
  watch     Watch directory for new photos (continuous)
  publish   Publish all approved photos to Contentful`)
  process.exit(1)
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
        sidecar.status = 'published'
        sidecar.contentful.assetId = result.assetId
        sidecar.contentful.entryId = result.entryId
        sidecar.contentful.publishedAt = new Date().toISOString()
        await writeSidecar(sidecarPath, sidecar)
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
