require('dotenv').config(); // MUST be line 1
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function getDbConfig() {
  if (process.env.DATABASE_URL) {
    try {
      const url = new URL(process.env.DATABASE_URL);
      return {
        host: url.hostname || 'localhost',
        port: parseInt(url.port || '5432', 10),
        user: url.username || 'postgres',
        password: String(url.password || ''),
        database: url.pathname ? url.pathname.replace(/^\//, '') : 'credit_ledger',
      };
    } catch (e) {
      // Fallback if URL parsing fails
    }
  }

  return {
    host: process.env.PGHOST || process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.PGPORT || process.env.DB_PORT || '5432', 10),
    user: process.env.PGUSER || process.env.DB_USER || 'postgres',
    password: String(process.env.PGPASSWORD || process.env.DB_PASSWORD || ''),
    database: process.env.PGDATABASE || process.env.DB_NAME || 'credit_ledger',
  };
}

async function ensureDatabaseExists(config) {
  // Connect to default maintenance database 'postgres' to check/create target database
  const maintenanceClient = new Client({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: 'postgres',
  });

  try {
    await maintenanceClient.connect();
    const checkDb = await maintenanceClient.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [config.database]
    );

    if (checkDb.rowCount === 0) {
      console.log(`Database "${config.database}" does not exist. Creating...`);
      // Escape database name safely
      await maintenanceClient.query(`CREATE DATABASE "${config.database}"`);
      console.log(`Database "${config.database}" created successfully.`);
    }
  } catch (err) {
    console.warn(`Note on DB check: ${err.message}`);
  } finally {
    await maintenanceClient.end();
  }
}

async function runSetup() {
  const config = getDbConfig();

  try {
    // 1. Ensure target database exists
    if (config.database !== 'postgres') {
      await ensureDatabaseExists(config);
    }

    // 2. Connect directly to target database
    const client = new Client(
      process.env.DATABASE_URL
        ? { connectionString: process.env.DATABASE_URL }
        : config
    );

    await client.connect();
    console.log(`Connected to PostgreSQL database "${config.database}" at ${config.host}:${config.port}`);

    // 3. Apply schema.sql
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(schemaSql);
    console.log(`Schema applied successfully to database "${config.database}".`);

    await client.end();
  } catch (err) {
    console.error('Failed to setup database:', err);
    process.exit(1);
  }
}

runSetup();