const ledgerService = require('../services/ledger.service');

async function createJob(req, res, next) {
  try {
    const { userId, cost, prompt } = req.body;
    const job = await ledgerService.createAndReserveJob(userId, cost, prompt);
    res.status(201).json(job);
  } catch (err) {
    next(err);
  }
}

async function completeJob(req, res, next) {
  try {
    const { id } = req.params;
    const result = await ledgerService.completeJob(id);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function failJob(req, res, next) {
  try {
    const { id } = req.params;
    const result = await ledgerService.failJob(id);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = { createJob, completeJob, failJob };