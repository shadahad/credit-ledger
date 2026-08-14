const webhookService = require('../services/webhook.service');

async function processWebhook(req, res, next) {
  try {
    const { eventId, jobId, result, output } = req.body;
    const response = await webhookService.handleProviderWebhook({
      eventId,
      jobId,
      result,
      output
    });
    return res.status(200).json(response);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  processWebhook
};