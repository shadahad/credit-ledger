class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = this.constructor.name; // Automatically sets subclass name
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

class BadRequestError extends AppError {
  constructor(message = 'Invalid input parameters') {
    super(message, 400);
  }
}

class ValidationError extends BadRequestError {
  constructor(message = 'Validation failed') {
    super(message);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
  }
}

class InsufficientCreditsError extends AppError {
  constructor(message = 'Insufficient available credit balance') {
    super(message, 400);
  }
}

class ConflictError extends AppError {
  constructor(message = 'State conflict or job already finalized') {
    super(message, 409);
  }
}

module.exports = {
  AppError,
  BadRequestError,
  ValidationError,
  NotFoundError,
  InsufficientCreditsError,
  ConflictError,
};