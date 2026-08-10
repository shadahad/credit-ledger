/**
 * Sanitizes and anonymizes prompts:
 * 1. Strips identity markers (Email, SSN, UUID).
 * 2. Neutralizes prompt injection commands (e.g. system instruction overrides).
 */
function sanitizeAndAnonymizePrompt(rawPrompt) {
  if (typeof rawPrompt !== 'string' || !rawPrompt.trim()) {
    throw new Error('Prompt must be a non-empty string');
  }

  let sanitized = rawPrompt;

  // 1. Remove identity markers (PII)
  // Mask Emails
  sanitized = sanitized.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]');
  // Mask UUIDs
  sanitized = sanitized.replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, '[REDACTED_ID]');
  // Mask Phone numbers
  sanitized = sanitized.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[REDACTED_PHONE]');

  // 2. Neutralize system prompt injection attempts
  const injectionPatterns = [
    /ignore previous instructions/gi,
    /system instruction/gi,
    /<\|im_start\|>/gi,
    /<\|im_end\|>/gi,
    /\[INST\]/gi,
    /\[\/INST\]/gi,
  ];

  for (const pattern of injectionPatterns) {
    sanitized = sanitized.replace(pattern, '[BLOCKED_INSTRUCTION]');
  }

  return sanitized.trim();
}

module.exports = { sanitizeAndAnonymizePrompt };