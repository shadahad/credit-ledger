const crypto = require('crypto');
const pool = require('../config/db');
const { NotFoundError } = require('../errors/AppError');

const GENESIS_HASH = '0'.repeat(64);

// Safely converts numeric string (e.g., "100.0000") or number to BigInt
function toBigInt(val) {
  if (typeof val === 'bigint') return val;
  if (typeof val === 'string') {
    return BigInt(val.split('.')[0]);
  }
  return BigInt(Math.round(val));
}

class AuditService {
  _calculateHash({ prevHash, userId, jobId, entryType, amount, balanceAfter, reservedAfter, createdAt }) {
    const payload = [
      prevHash,
      userId,
      jobId || '',
      entryType,
      toBigInt(amount).toString(),
      toBigInt(balanceAfter).toString(),
      toBigInt(reservedAfter).toString(),
      new Date(createdAt).toISOString()
    ].join('|');

    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Replays user transactions from genesis to prove balance and audit chain integrity.
   */
  async verifyUserAuditTrail(userId) {
    // 1. Fetch current live balance
    const userRes = await pool.query(
      'SELECT balance, reserved FROM users WHERE id = $1',
      [userId]
    );

    if (userRes.rowCount === 0) {
      throw new NotFoundError('User not found');
    }

    const liveBalance = toBigInt(userRes.rows[0].balance);
    const liveReserved = toBigInt(userRes.rows[0].reserved);

    // 2. Fetch full timeline in chronological order
    const ledgerRes = await pool.query(
      `SELECT * FROM ledger_entries 
       WHERE user_id = $1 
       ORDER BY created_at ASC, id ASC`,
      [userId]
    );

    const entries = ledgerRes.rows;
    let expectedPrevHash = GENESIS_HASH;
    let replayedBalance = 0n;
    let replayedReserved = 0n;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const entryAmount = toBigInt(entry.amount);

      // Check unbroken hash chain link
      if (entry.prev_hash !== expectedPrevHash) {
        return {
          verified: false,
          reason: 'HASH_CHAIN_BROKEN',
          failedAtIndex: i,
          entryId: entry.id
        };
      }

      // Re-compute cryptographic hash
      const expectedHash = this._calculateHash({
        prevHash: entry.prev_hash,
        userId: entry.user_id,
        jobId: entry.job_id,
        entryType: entry.entry_type,
        amount: entry.amount,
        balanceAfter: entry.balance_after,
        reservedAfter: entry.reserved_after,
        createdAt: entry.created_at
      });

      if (entry.hash !== expectedHash) {
        return {
          verified: false,
          reason: 'RECORD_TAMPERED',
          failedAtIndex: i,
          entryId: entry.id
        };
      }

      // Replay delta state
      switch (entry.entry_type) {
        case 'TOPUP':
          replayedBalance += entryAmount;
          break;
        case 'RESERVE':
          replayedReserved += entryAmount;
          break;
        case 'COMMIT':
          replayedBalance -= entryAmount;
          replayedReserved -= entryAmount;
          break;
        case 'RELEASE':
          replayedReserved -= entryAmount;
          break;
      }

      expectedPrevHash = entry.hash;
    }

    // Verify replayed calculation matches live DB state
    if (replayedBalance !== liveBalance || replayedReserved !== liveReserved) {
      return {
        verified: false,
        reason: 'BALANCE_MISMATCH',
        live: { balance: liveBalance.toString(), reserved: liveReserved.toString() },
        replayed: { balance: replayedBalance.toString(), reserved: replayedReserved.toString() }
      };
    }

    return {
      verified: true,
      totalEntries: entries.length,
      currentBalance: liveBalance.toString(),
      currentReserved: liveReserved.toString(),
      latestHash: expectedPrevHash
    };
  }

  /**
   * Retrieves raw ledger history.
   */
  async getUserLedgerHistory(userId) {
    const res = await pool.query(
      `SELECT id, job_id AS "jobId", entry_type AS "entryType", amount, 
              balance_after AS "balanceAfter", reserved_after AS "reservedAfter", 
              prev_hash AS "prevHash", hash, created_at AS "createdAt"
       FROM ledger_entries 
       WHERE user_id = $1 
       ORDER BY created_at DESC, id DESC`,
      [userId]
    );
    return res.rows;
  }
}

module.exports = new AuditService();