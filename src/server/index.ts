import { loadConfig } from '../config.js'
import { startServer } from './start.js'

import 'dotenv/config'

const config = loadConfig()
startServer(config)
