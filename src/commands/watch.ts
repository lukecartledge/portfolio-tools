import type { Config } from '../config.js'
import { startWatcher } from '../watcher.js'

export function runWatch(config: Config): void {
  console.log('Starting watcher (Ctrl+C to stop)...')
  startWatcher(config)
}
