// src/controllers/knowledge.controller.js

const knowledgeService = require('../services/knowledge.service');

const searchKnowledge = async (req, res, next) => {
  try {
    const { q } = req.query;
    if (!q || typeof q !== 'string' || !q.trim()) {
      return res.status(400).json({ error: "Query parameter 'q' is required" });
    }

    const limit = parseInt(req.query.limit, 10) || 3;
    const results = knowledgeService.search(q.trim(), limit);

    return res.status(200).json({
      query: q.trim(),
      count: results.length,
      results
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  searchKnowledge
};