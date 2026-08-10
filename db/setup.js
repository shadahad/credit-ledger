const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
});

async function runSetup() {
  try {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    const seed = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8');
    await pool.query(schema);
    await pool.query(seed);
    console.log('Database schema and seeds initialized successfully.');
  } catch (err) {
    console.error('Failed to setup database:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runSetup();