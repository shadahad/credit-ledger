const auditService = require('../services/audit.service');

class AuditController {
  /**
   * Cryptographically verifies the unbroken ledger chain and matches actual balance with replayed state.
   */
  async verifyUserAudit(req, res, next) {
    try {
      const { id: userId } = req.params;
      const result = await auditService.verifyUserAuditTrail(userId);

      if (!result.verified) {
        return res.status(409).json({
          verified: false,
          error: 'Ledger integrity or balance reconciliation check failed',
          details: result
        });
      }

      return res.json({
        verified: true,
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Retrieves full immutable ledger entry history for a user.
   */
  async getLedgerHistory(req, res, next) {
    try {
      const { id: userId } = req.params;
      const history = await auditService.getUserLedgerHistory(userId);
      return res.json({ data: history });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new AuditController();