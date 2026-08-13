const { calculateEntryHash } = require('../utils/crypto');

/**
 * Sweeps expired reservations safely across concurrent instances.
 * Uses PostgreSQL 'FOR UPDATE SKIP LOCKED' to prevent race conditions.
 *
 * @param {import('pg').Pool} pool - Postgres Connection Pool
 * @param {Object} options
 * @param {number} [options.batchSize=100] - Max reservations to process per batch
 * @returns {Promise<{ processedCount: number, releasedIds: number[] }>}
 */
async function cleanupAbandonedReservations(pool, { batchSize = 100 } = {}) {
  const client = await pool.connect();
  const releasedIds = [];

  try {
    await client.query('BEGIN');

    // 1. Atomically fetch and lock expired pending reservations.
    // 'FOR UPDATE SKIP LOCKED' ensures concurrent workers skip rows locked by other workers.
    const fetchQuery = `
      SELECT id, user_id, amount 
      FROM reservations
      WHERE status = 'PENDING' AND expires_at <= NOW()
      ORDER BY expires_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED;
    `;
    const { rows: expiredReservations } = await client.query(fetchQuery, [batchSize]);

    if (expiredReservations.length === 0) {
      await client.query('COMMIT');
      return { processedCount: 0, releasedIds: [] };
    }

    for (const reservation of expiredReservations) {
      // 2. Transition reservation state to EXPIRED
      await client.query(
        `UPDATE reservations SET status = 'EXPIRED', updated_at = NOW() WHERE id = $1`,
        [reservation.id]
      );

      // 3. Obtain previous ledger entry hash for tamper-evident chain integrity (Module B1)
      const lastEntryRes = await client.query(
        `SELECT id, hash FROM ledger_entries ORDER BY id DESC LIMIT 1 FOR UPDATE`
      );
      
      const prevHash = lastEntryRes.rows[0]?.hash || '0'.repeat(64);
      
      // 4. Record IMMUTABLE Ledger Release entry
      const insertLedgerQuery = `
        INSERT INTO ledger_entries (user_id, amount, entry_type, reservation_id, prev_hash, hash, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        RETURNING id, created_at;
      `;

      // Temporary placeholder hash generation sequence
      const tempEntry = {
        userId: reservation.user_id,
        amount: reservation.amount, // Credit amount returning to user
        entryType: 'RESERVATION_RELEASE',
        jobId: reservation.id,
        prevHash
      };

      const ledgerRes = await client.query(insertLedgerQuery, [
        tempEntry.userId,
        tempEntry.amount,
        tempEntry.entryType,
        tempEntry.jobId,
        tempEntry.prevHash,
        'PENDING_HASH'
      ]);

      const entryId = ledgerRes.rows[0].id;
      const createdAt = ledgerRes.rows[0].created_at.toISOString();

      const finalHash = calculateEntryHash({
        id: entryId,
        ...tempEntry,
        timestamp: createdAt
      });

      // Update entry with verified cryptographic hash
      await client.query(`UPDATE ledger_entries SET hash = $1 WHERE id = $2`, [finalHash, entryId]);

      // 5. Update user available balance
      await client.query(
        `UPDATE users SET balance = balance + $1 WHERE id = $2`,
        [reservation.amount, reservation.user_id]
      );

      releasedIds.push(reservation.id);
    }

    await client.query('COMMIT');
    return { processedCount: releasedIds.length, releasedIds };

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { cleanupAbandonedReservations };