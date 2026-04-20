import { watch } from 'chokidar'
import { basename, dirname, extname } from 'node:path'
import { IMAGE_EXTENSIONS, WRITE_STABILITY_THRESHOLD, WRITE_POLL_INTERVAL } from './config.js'
import { hasSidecar, sidecarPathFor, createEmptySidecar, writeSidecar } from './sidecar.js'
import { analyzePhoto } from './analyzer.js'
import type { Config } from './config.js'
import { errorMessage } from './utils.js'
import { log } from './logger.js'

export function startWatcher(config: Config) {
  const extensions = [...IMAGE_EXTENSIONS].map((e) => e.slice(1)).join(',')
  const globPattern = `${config.watchDir}/**/*.{${extensions}}`

  log.info(`Watching: ${config.watchDir}`)

  const watcher = watch(globPattern, {
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: WRITE_STABILITY_THRESHOLD,
      pollInterval: WRITE_POLL_INTERVAL,
    },
    ignored: [/(^|[/\\])\../, /\.json$/],
  })

  watcher.on('add', (filePath: string) => {
    const ext = extname(filePath).toLowerCase()
    if (!IMAGE_EXTENSIONS.has(ext)) return
    if (hasSidecar(filePath)) {
      log.debug(`Skipping (sidecar exists): ${basename(filePath)}`)
      return
    }

    log.info(`New photo detected: ${basename(filePath)}`)
    void processNewPhoto(filePath, config)
  })

  watcher.on('error', (error: unknown) => {
    log.error(`Watcher error:`, errorMessage(error))
  })

  return watcher
}

async function processNewPhoto(filePath: string, config: Config) {
  const collection = basename(dirname(filePath))
  const source = basename(filePath)
  const sidecarPath = sidecarPathFor(filePath)

  const sidecar = createEmptySidecar(source, collection)

  try {
    log.info(`  Analyzing: ${source}...`)
    const { exif, ai } = await analyzePhoto(filePath, config.anthropic.apiKey, {
      collection,
      filename: source,
    })

    sidecar.exif = exif
    sidecar.ai = ai

    await writeSidecar(sidecarPath, sidecar)
    log.info(`  Done: ${ai.title} [${ai.tags.join(', ')}]`)
  } catch (error) {
    log.error(`  Failed to analyze ${source}: ${errorMessage(error)}`)

    // Write partial sidecar so the photo isn't re-processed on restart
    await writeSidecar(sidecarPath, sidecar)
  }
}
