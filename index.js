require('dotenv').config();

const app = require('./src/app');
const runMigrations = require('./src/config/migrate');

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // 1. Run database migrations
    await runMigrations();

    // 2. Start HTTP Server
    app.listen(PORT, () => {
      console.log(`🚀 Credit Ledger API running on port ${PORT}`);
    });
  } catch (err) {
    console.error('❌ Server startup aborted due to migration error.');
    process.exit(1);
  }
}

startServer();