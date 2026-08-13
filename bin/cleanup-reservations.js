#!/usr/bin/env node

require('dotenv').config();
const pool = require('../src/config/db');
const ledgerService = require('../src/services/ledger.service');

async function main() {
  const batchSize = parseInt(process.env.BATCH_SIZE || '100', 10);
  console.log(`[${new Date().toISOString()}] Starting abandoned reservation cleanup...`);

  try {
    let totalProcessed = 0;
    let res;

    do {
      res = await ledgerService.releaseAbandonedReservations(batchSize);
      totalProcessed += res.processedCount;
    } while (res.processedCount === batchSize);

    console.log(`[${new Date().toISOString()}] Cleanup finished. Released ${totalProcessed} jobs.`);
    process.exit(0);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Cleanup failed:`, err);
    process.exit(1);
  } finally {
    if (pool.end) await pool.end();
  }
}

main();