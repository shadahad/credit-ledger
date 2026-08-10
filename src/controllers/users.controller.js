const ledgerService = require('../services/ledger.service');

async function getBalance(req, res, next) {
  try {
    const { id } = req.params;
    const balance = await ledgerService.getUserBalance(id);
    res.status(200).json(balance);
  } catch (err) {
    next(err);
  }
}

module.exports = { getBalance };