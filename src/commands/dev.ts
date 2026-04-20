import type { Config } from '../config.js'
import { startWatcher } from '../watcher.js'
import { startServer } from '../server/start.js'
import { log } from '../logger.js'

export function runDev(config: Config): void {
  const watcher = startWatcher(config)
  const server = startServer(config)
  log.info('Press Ctrl+C to stop.\n')

  let shuttingDown = false
  const shutdown = () => {
    if (shuttingDown) return
    shuttingDown = true
    log.info('\nShutting down...')
    server.close()
    void watcher.close()
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
