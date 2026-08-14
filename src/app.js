const express = require('express');
const jobsController = require('./controllers/jobs.controller');
const usersController = require('./controllers/users.controller');
const auditController = require('./controllers/audit.controller');
const webhookController = require('./controllers/webhook.controller');
const verifyWebhookSignature = require('./middleware/verifyWebhookSignature');
const { validateCreateJob, validateUUIDParam } = require('./middleware/validate');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Parse JSON with raw body capture for tamper-evident HMAC signature verification
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString('utf8');
    }
  })
);

// ==========================================
// Job Routes
// ==========================================
app.post('/jobs', validateCreateJob, jobsController.createJob);
app.get('/jobs/:id', validateUUIDParam('id'), jobsController.getJobById); // Module B7: Retrieve Job & Produced Result
app.post('/jobs/:id/complete', validateUUIDParam('id'), jobsController.completeJob);
app.post('/jobs/:id/fail', validateUUIDParam('id'), jobsController.failJob);

// ==========================================
// Module B3: Provider Webhook Route
// ==========================================
app.post('/webhooks/provider', verifyWebhookSignature, webhookController.processWebhook);

// ==========================================
// Users & Audit Routes
// ==========================================
app.get('/users/:id/balance', validateUUIDParam('id'), usersController.getBalance);
app.get('/users/:id/audit', validateUUIDParam('id'), auditController.verifyUserAudit); // Module B1: Provable Ledger
app.get('/users/:id/ledger', validateUUIDParam('id'), auditController.getLedgerHistory); // Module B1: Provable Ledger
app.get('/users/:id', usersController.getBalance); // Module B2: Abandoned Reservation Cleanup
app.post('/users/topup', usersController.topUp); // Module B2: Abandoned Reservation Cleanup

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error Middleware
app.use(errorHandler);

module.exports = app;