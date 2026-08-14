const crypto = require('crypto');
const errors = require('../errors/AppError');

// Resilient fallback for AppError subclasses
const AppError = errors.AppError || errors;
const UnauthorizedError = errors.UnauthorizedError || class extends (AppError || Error) { constructor(msg) { super(msg); this.statusCode = 401; } };
const ForbiddenError = errors.ForbiddenError || class extends (AppError || Error) { constructor(msg) { super(msg); this.statusCode = 403; } };

function verifyWebhookSignature(req, res, next) {
  const signature = req.headers['x-signature'];
  if (!signature) {
    return next(new UnauthorizedError('Missing x-signature header'));
  }

  const secret = process.env.WEBHOOK_SECRET || 'dev_shared_webhook_secret_change_me_in_production';
  const payload = req.rawBody ? req.rawBody : JSON.stringify(req.body || {});

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  const sigBuffer = Buffer.from(signature, 'utf8');
  const expBuffer = Buffer.from(expectedSignature, 'utf8');

  if (sigBuffer.length !== expBuffer.length || !crypto.timingSafeEqual(sigBuffer, expBuffer)) {
    return next(new ForbiddenError('Invalid webhook signature'));
  }

  next();
}

module.exports = verifyWebhookSignature;