import type { Config } from '../config.js'
import { startWatcher } from '../watcher.js'
import { startServer } from '../server/start.js'

export function runDev(config: Config): void {
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
