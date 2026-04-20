import { readdir, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { spinner } from '@clack/prompts'
import type { Config } from '../config.js'
import { IMAGE_EXTENSIONS } from '../config.js'
import {
  hasSidecar,
  sidecarPathFor,
  readSidecar,
  writeSidecar,
  createEmptySidecar,
} from '../sidecar.js'
import { analyzePhoto } from '../analyzer.js'
import { errorMessage } from '../utils.js'
import { log } from '../logger.js'

interface AnalyzeOptions {
  force?: boolean
}

export async function runAnalyze(config: Config, options: AnalyzeOptions = {}): Promise<void> {
  const { force = false } = options

  log.info(`Scanning: ${config.watchDir}${force ? ' (force re-analyze)' : ''}\n`)

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
      const scPath = sidecarPathFor(filePath)
      const exists = hasSidecar(filePath)

      if (exists && !force) {
        skipped++
        continue
      }

      const label = exists ? 'Re-analyzing' : 'Analyzing'
      const s = spinner()
      s.start(`${label}: ${collectionName}/${file}`)

      // Preserve existing sidecar data when re-analyzing
      const existing = exists ? await readSidecar(scPath) : null
      const sidecar = existing ?? createEmptySidecar(file, collectionName)

      try {
        const { exif, ai } = await analyzePhoto(filePath, config.anthropic.apiKey, {
          collection: collectionName,
          filename: file,
        })

        if (existing) {
          log.debug(`  Old title: "${existing.ai.title}"`)
          log.debug(`  New title: "${ai.title}"`)
          log.debug(`  Old tags: [${existing.ai.tags.join(', ')}]`)
          log.debug(`  New tags: [${ai.tags.join(', ')}]`)
        }

        sidecar.exif = exif
        sidecar.ai = ai
        // Reset to pending so user re-reviews new AI output
        if (existing) {
          sidecar.status = 'pending'
        }
        // userEdits and contentful are preserved from existing sidecar

        await writeSidecar(scPath, sidecar)
        s.stop(`${collectionName}/${file} — ${ai.title} [${ai.tags.join(', ')}]`)
        analyzed++
      } catch (error) {
        if (!existing) {
          await writeSidecar(scPath, sidecar)
        }
        s.stop(`${collectionName}/${file} — failed: ${errorMessage(error)}`)
        failed++
      }
    }
  }

  log.info(
    `\nDone. Analyzed: ${analyzed}, Skipped: ${skipped}${failed > 0 ? `, Failed: ${failed}` : ''}`,
  )
}
