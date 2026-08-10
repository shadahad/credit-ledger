const express = require('express');
const jobsController = require('./controllers/jobs.controller');
const usersController = require('./controllers/users.controller');
const { validateCreateJob, validateUUIDParam } = require('./middleware/validate');
const errorHandler = require('./middleware/errorHandler');

const app = express();
app.use(express.json());

// Routes
app.post('/jobs', validateCreateJob, jobsController.createJob);
app.post('/jobs/:id/complete', validateUUIDParam('id'), jobsController.completeJob);
app.post('/jobs/:id/fail', validateUUIDParam('id'), jobsController.failJob);
app.get('/users/:id/balance', validateUUIDParam('id'), usersController.getBalance);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error Middleware
app.use(errorHandler);

module.exports = app;