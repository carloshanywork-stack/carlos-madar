import { app } from './app.js';
import { env } from './config/env.js';
import { db } from './database/connection.js';
import { initializeDatabase } from './database/init.js';

const initialization = initializeDatabase();
if (initialization.adminCreated) {
  console.log('Created initial MADAR V2 administrator.');
  console.log('Initial administrator password was read from MADAR_INITIAL_ADMIN_PASSWORD.');
} else if (initialization.setupRequired) {
  console.log('If this is a new install, finish first administrator setup in the browser.');
} else {
  console.log('Existing MADAR V2 user accounts and credentials were left unchanged.');
}

const server = app.listen(env.port, env.host, () => {
  console.log(`MADAR V2 API listening at http://${env.host}:${env.port}`);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received; shutting down MADAR V2.`);
  server.close((error) => {
    if (error) {
      console.error('HTTP server shutdown failed:', error);
      process.exitCode = 1;
    }
    if (db.open) db.close();
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
