#!/usr/bin/env node
require('dotenv').config();
const pool = require('../src/config/db');
const runnerService = require('../src/services/runner.service');

async function main() {
  console.log('🤖 AI Worker starting sweep...');
  try {
    const processed = await runnerService.claimAndProcessNextJob();
    if (!processed) {
      console.log('ℹ️ No pending RESERVED jobs found.');
    } else {
      console.log(`✅ Processed Job [${processed.jobId}] with Status: ${processed.status}`);
      if (processed.result) console.log(`Output: ${processed.result}`);
      if (processed.error) console.log(`Error: ${processed.error}`);
    }
  } catch (err) {
    console.error('❌ Worker error:', err.message);
  } finally {
    await pool.end();
  }
}

main();