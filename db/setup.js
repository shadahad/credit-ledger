require('dotenv').config(); // MUST be line 1
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function runSetup() {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: String(process.env.DB_PASSWORD || ''), // Coerce to string to prevent SASL error
    database: process.env.DB_NAME || 'postgres',
  });

  try {
    await client.connect();
    console.log('Connected to PostgreSQL successfully.');

    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(schemaSql);
    console.log('Schema applied successfully.');

  } catch (err) {
    console.error('Failed to setup database:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runSetup();