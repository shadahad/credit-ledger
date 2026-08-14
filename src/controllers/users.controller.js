const ledgerService = require('../services/ledger.service');

async function topUp(req, res, next) {
  try {
    const { userId, amount } = req.body;
    const result = await ledgerService.topUpUser(userId, amount);
    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

async function getBalance(req, res, next) {
  try {
    const { id } = req.params;
    const result = await ledgerService.getUserBalance(id);
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function getHistory(req, res, next) {
  try {
    const { id } = req.params;
    const { limit, cursor } = req.query;
    const result = await ledgerService.getUserMovementHistory(id, { limit, cursor });
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = { topUp, getBalance, getHistory };