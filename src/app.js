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
app.get('/jobs/:id', validateUUIDParam('id'), jobsController.getJobById);
app.post('/jobs/:id/complete', validateUUIDParam('id'), jobsController.completeJob);
app.post('/jobs/:id/fail', validateUUIDParam('id'), jobsController.failJob);

// Module B4: Per-Job Audit Notes
app.post('/jobs/:id/notes', validateUUIDParam('id'), jobsController.addJobNote);
app.get('/jobs/:id/notes', validateUUIDParam('id'), jobsController.getJobNotes);

// ==========================================
// Module B3: Provider Webhook Route
// ==========================================
app.post('/webhooks/provider', verifyWebhookSignature, webhookController.processWebhook);

// ==========================================
// Users & Audit Routes
// ==========================================
app.get('/users/:id/history', validateUUIDParam('id'), usersController.getHistory);
app.get('/users/:id/balance', validateUUIDParam('id'), usersController.getBalance);
app.get('/users/:id/audit', validateUUIDParam('id'), auditController.verifyUserAudit);
app.get('/users/:id/ledger', validateUUIDParam('id'), auditController.getLedgerHistory);
app.get('/users/:id', usersController.getBalance);
app.post('/users/topup', usersController.topUp);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error Middleware
app.use(errorHandler);

module.exports = app;