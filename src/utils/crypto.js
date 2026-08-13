const crypto = require('crypto');

/**
 * Computes a SHA-256 hash for ledger entry to preserve Module B1's tamper-evident chain.
 */
function calculateEntryHash({ id, userId, amount, entryType, jobId, prevHash, timestamp }) {
  const payload = `${id}:${userId}:${amount}:${entryType}:${jobId}:${prevHash}:${timestamp}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

module.exports = { calculateEntryHash };