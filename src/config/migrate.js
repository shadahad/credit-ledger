/**
 * Idempotent Schema Migration Helper
 */
const fs = require('fs');
const path = require('path');
const pool = require('./db');

/**
 * Automatically applies schema and sequential migration files to PostgreSQL.
 * Supports zero-downtime, idempotent schema upgrades.
 */
async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Ensure base schema.sql is executed if present
    const schemaPath = path.join(__dirname, '../../db/schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      await client.query(schemaSql);
    }

    // 2. Migration tracking table for incremental versioned migrations (Module B4)
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. Incrementally apply any migrations in db/migrations/
    const migrationsDir = path.join(__dirname, '../../db/migrations');
    if (fs.existsSync(migrationsDir)) {
      const migrationFiles = fs.readdirSync(migrationsDir).sort();

      for (const file of migrationFiles) {
        if (!file.endsWith('.sql')) continue;

        const checkRes = await client.query(
          'SELECT 1 FROM schema_migrations WHERE version = $1',
          [file]
        );

        if (checkRes.rowCount === 0) {
          const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
          await client.query(sql);
          await client.query(
            'INSERT INTO schema_migrations (version) VALUES ($1)',
            [file]
          );
        }
      }
    }

    await client.query('COMMIT');
    console.log('✅ Database schema and migrations applied successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Database migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = runMigrations;