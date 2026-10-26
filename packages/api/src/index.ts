import { loadConfig } from './config.js';
import { startServer } from './server.js';

const config = loadConfig();
startServer(config).catch((error) => {
  console.error('Failed to start sqlboard:', error);
  process.exit(1);
});
