require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        user: process.env.PGUSER || 'postgres',
        host: process.env.PGHOST || 'localhost',
        database: process.env.PGDATABASE || 'credit_ledger',
        password: String(process.env.PGPASSWORD || ''), // Ensure password is always a string
        port: Number(process.env.PGPORT) || 5432,
      }
);

module.exports = pool;