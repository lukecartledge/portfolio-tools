import { readdir, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { spinner } from '@clack/prompts'
import type { Config } from '../config.js'
import { IMAGE_EXTENSIONS } from '../config.js'
import { hasSidecar, sidecarPathFor, writeSidecar, createEmptySidecar } from '../sidecar.js'
import { analyzePhoto } from '../analyzer.js'
import { errorMessage } from '../utils.js'

export async function runAnalyze(config: Config): Promise<void> {
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
