const { BadRequestError } = require('../errors/AppError');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateCreateJob(req, res, next) {
  const { userId, cost, prompt } = req.body;

  if (!userId || typeof userId !== 'string' || !UUID_REGEX.test(userId)) {
    return next(new BadRequestError('Valid userId UUID is required'));
  }

  if (cost === undefined || typeof cost !== 'number' || !Number.isInteger(cost) || cost <= 0) {
    return next(new BadRequestError('Cost must be a positive integer'));
  }

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return next(new BadRequestError('Prompt must be a non-empty string'));
  }

  next();
}

function validateUUIDParam(paramName) {
  return (req, res, next) => {
    const id = req.params[paramName];
    if (!id || typeof id !== 'string' || !UUID_REGEX.test(id)) {
      return next(new BadRequestError(`Invalid UUID for parameter '${paramName}'`));
    }
    next();
  };
}

module.exports = { validateCreateJob, validateUUIDParam };