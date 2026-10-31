import { app } from './app.js';
import { env } from './config/env.js';
import { db } from './database/connection.js';
import { initializeDatabase } from './database/init.js';
import {
  recoverMaintenanceCardDeletions,
  recoverMaintenanceMachineDecommissions,
  recoverMaintenanceOrderDeletions,
} from './modules/maintenance/service.js';

const initialization = initializeDatabase();
try {
  const recovery = await recoverMaintenanceOrderDeletions();
  if (recovery.recoveredCount) {
    console.log(`Recovered ${recovery.recoveredCount} staged maintenance order deletion(s).`);
  }
  const cardRecovery = await recoverMaintenanceCardDeletions();
  if (cardRecovery.recoveredCount) {
    console.log(`Recovered ${cardRecovery.recoveredCount} staged maintenance card deletion(s).`);
  }
  const machineRecovery = await recoverMaintenanceMachineDecommissions();
  if (machineRecovery.recoveredCount) {
    console.log(`Recovered ${machineRecovery.recoveredCount} staged machine decommission(s).`);
  }
} catch (error) {
  console.error(`Maintenance file deletion recovery failed; API startup stopped: ${error.message}`);
  if (db.open) db.close();
  throw error;
}

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
