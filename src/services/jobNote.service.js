const pool = require('../config/db');
const { NotFoundError, ValidationError } = require('../errors/AppError');

class JobNoteService {
  /**
   * Adds an audit note to a specific job.
   */
  async addNote(jobId, note, author = 'system') {
    if (!note || typeof note !== 'string' || note.trim().length === 0) {
      throw new ValidationError('Note content is required');
    }

    // Verify job existence first
    const jobRes = await pool.query('SELECT id FROM jobs WHERE id = $1', [jobId]);
    if (jobRes.rowCount === 0) {
      throw new NotFoundError('Job not found');
    }

    const insertQuery = `
      INSERT INTO job_audit_notes (job_id, note, author)
      VALUES ($1, $2, $3)
      RETURNING 
        id, 
        job_id AS "jobId", 
        note, 
        author, 
        created_at AS "createdAt"
    `;

    const res = await pool.query(insertQuery, [jobId, note.trim(), author || 'system']);
    return res.rows[0];
  }

  /**
   * Retrieves all audit notes for a specific job in chronological order.
   */
  async getNotesByJobId(jobId) {
    const jobRes = await pool.query('SELECT id FROM jobs WHERE id = $1', [jobId]);
    if (jobRes.rowCount === 0) {
      throw new NotFoundError('Job not found');
    }

    const query = `
      SELECT 
        id, 
        job_id AS "jobId", 
        note, 
        author, 
        created_at AS "createdAt"
      FROM job_audit_notes
      WHERE job_id = $1
      ORDER BY created_at ASC, id ASC
    `;

    const res = await pool.query(query, [jobId]);
    return res.rows;
  }
}

module.exports = new JobNoteService();