import type { Config } from '../config.js'
import { startWatcher } from '../watcher.js'
import { log } from '../logger.js'

export function runWatch(config: Config): void {
  log.info('Starting watcher (Ctrl+C to stop)...')
  startWatcher(config)
}
