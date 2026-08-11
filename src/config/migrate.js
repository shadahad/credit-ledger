/**
 * Idempotent Schema Migration Helper
 */
const fs = require('fs');
const path = require('path');
const pool = require('./db');

/**
 * Automatically applies db/schema.sql to PostgreSQL on application boot.
 */
async function runMigrations() {
  try {
    const schemaPath = path.join(__dirname, '../../db/schema.sql');
    
    if (!fs.existsSync(schemaPath)) {
      console.warn('⚠️ db/schema.sql not found. Skipping migration.');
      return;
    }

    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(schemaSql);
    console.log('✅ Database schema, triggers, and constraints applied successfully.');
  } catch (err) {
    console.error('❌ Database migration failed:', err.message);
    throw err;
  }
}

module.exports = runMigrations;