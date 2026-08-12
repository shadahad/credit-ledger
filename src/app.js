const express = require('express');
const jobsController = require('./controllers/jobs.controller');
const usersController = require('./controllers/users.controller');
const auditController = require('./controllers/audit.controller');
const { validateCreateJob, validateUUIDParam } = require('./middleware/validate');
const errorHandler = require('./middleware/errorHandler');

const app = express();
app.use(express.json());

// Job Routes
app.post('/jobs', validateCreateJob, jobsController.createJob);
app.post('/jobs/:id/complete', validateUUIDParam('id'), jobsController.completeJob);
app.post('/jobs/:id/fail', validateUUIDParam('id'), jobsController.failJob);

// User & Balance Routes
app.get('/users/:id/balance', validateUUIDParam('id'), usersController.getBalance);

// Module B1: Audit & Provable Ledger Routes
app.get('/users/:id/audit', validateUUIDParam('id'), auditController.verifyUserAudit);
app.get('/users/:id/ledger', validateUUIDParam('id'), auditController.getLedgerHistory);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error Middleware
app.use(errorHandler);

module.exports = app;