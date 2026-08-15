// src/services/knowledge.service.js

const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and',
  'any', 'are', 'aren\'t', 'as', 'at', 'be', 'because', 'been', 'before', 'being',
  'below', 'between', 'both', 'but', 'by', 'can', 'can\'t', 'cannot', 'could',
  'did', 'do', 'does', 'doing', 'don\'t', 'down', 'during', 'each', 'few', 'for',
  'from', 'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers',
  'herself', 'him', 'himself', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'isn\'t',
  'it', 'its', 'itself', 'just', 'me', 'more', 'most', 'my', 'myself', 'no', 'nor',
  'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our',
  'ours', 'ourselves', 'out', 'over', 'own', 'same', 'she', 'should', 'so', 'some',
  'such', 'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then',
  'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under',
  'until', 'up', 'very', 'was', 'wasn\'t', 'we', 'were', 'what', 'when', 'where',
  'which', 'while', 'who', 'whom', 'why', 'with', 'would', 'you', 'your', 'yours'
]);

const DEFAULT_KNOWLEDGE_BASE = [
  {
    id: 'kb-001',
    title: 'Financial Ledger Invariants & Double-Entry Principles',
    content: 'All credit movements must maintain mathematical consistency. Balances cannot drop below zero, reserved credits must never exceed total balance, and every transaction requires a deterministic cryptographic hash link (prev_hash to current_hash) to guarantee immutability and auditability.'
  },
  {
    id: 'kb-002',
    title: 'Prompt Engineering: Output Formatting and Strict JSON Schema',
    content: 'When instructing LLMs to produce structured data, specify explicit JSON schema constraints, prohibit conversational preamble or markdown backticks, and enforce deterministic key order to streamline downstream parsing.'
  },
  {
    id: 'kb-003',
    title: 'Idempotency and Distributed Concurrency Control',
    content: 'To prevent double execution or race conditions in distributed systems, employ database-level row locks (SELECT FOR UPDATE) and record-unique idempotency keys with atomic state checks before triggering non-replayable financial or side-effect operations.'
  },
  {
    id: 'kb-004',
    title: 'Context Window Optimization & Long Text Consistency',
    content: 'Maintain factual and stylistic consistency across multi-turn generation by injecting relevant semantic knowledge fragments, maintaining core entity definitions, and pruning repetitive instructions from the prompt context.'
  },
  {
    id: 'kb-005',
    title: 'Webhook Security & Tamper-Evident Signatures',
    content: 'External provider webhooks must be verified against raw request bodies using HMAC-SHA256 signatures with constant-time equality comparisons to defeat timing attacks and payload tampering.'
  },
  {
    id: 'kb-006',
    title: 'Error Handling and Graceful Fallback in AI Pipelines',
    content: 'Network calls to external model inference APIs should implement strict timeouts, circuit breakers, structured error categorization, and automated reservation releases to prevent stranded user balances.'
  },
  {
    id: 'kb-007',
    title: 'Deterministic Tokenization and Vector Cosine Similarity',
    content: 'Local text retrieval transforms terms into TF-IDF vector embeddings and computes the cosine angle between query and document vectors, allowing deterministic semantic search without external embedding APIs.'
  }
];

class KnowledgeService {
  constructor(corpus = DEFAULT_KNOWLEDGE_BASE) {
    this.corpus = [...corpus];
    this.rebuildIndex();
  }

  tokenize(text) {
    if (!text || typeof text !== 'string') return [];
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 1 && !STOP_WORDS.has(token));
  }

  rebuildIndex() {
    this.docCount = this.corpus.length;
    this.docTokens = new Map();
    this.df = new Map();

    for (const doc of this.corpus) {
      const fullText = `${doc.title} ${doc.content}`;
      const tokens = this.tokenize(fullText);
      this.docTokens.set(doc.id, tokens);

      const uniqueTokens = new Set(tokens);
      for (const token of uniqueTokens) {
        this.df.set(token, (this.df.get(token) || 0) + 1);
      }
    }

    this.docVectors = new Map();
    for (const doc of this.corpus) {
      const tokens = this.docTokens.get(doc.id);
      this.docVectors.set(doc.id, this.computeVector(tokens));
    }
  }

  computeVector(tokens) {
    const tf = new Map();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
    }

    const vector = new Map();
    let sumSq = 0;

    for (const [token, count] of tf.entries()) {
      const docFreq = this.df.get(token) || 0;
      const idf = Math.log((this.docCount + 1) / (docFreq + 1)) + 1;
      const weight = (1 + Math.log(count)) * idf;
      vector.set(token, weight);
      sumSq += weight * weight;
    }

    const magnitude = Math.sqrt(sumSq);
    return { weights: vector, magnitude: magnitude || 1 };
  }

  cosineSimilarity(queryVec, docVec) {
    let dotProduct = 0;
    for (const [token, queryWeight] of queryVec.weights.entries()) {
      const docWeight = docVec.weights.get(token);
      if (docWeight !== undefined) {
        dotProduct += queryWeight * docWeight;
      }
    }
    return dotProduct / (queryVec.magnitude * docVec.magnitude);
  }

  search(query, limit = 3) {
    if (!query || typeof query !== 'string' || !query.trim()) {
      return [];
    }

    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0) {
      return [];
    }

    const queryVec = this.computeVector(queryTokens);
    const scored = [];

    for (const doc of this.corpus) {
      const docVec = this.docVectors.get(doc.id);
      const score = this.cosineSimilarity(queryVec, docVec);
      if (score > 0) {
        scored.push({
          id: doc.id,
          title: doc.title,
          content: doc.content,
          score: Number(score.toFixed(4))
        });
      }
    }

    // Deterministic sort: descending by score, then ascending by ID
    scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

    return scored.slice(0, limit);
  }

  addDocument(doc) {
    if (!doc.id || !doc.title || !doc.content) {
      throw new Error('Document must have id, title, and content');
    }
    this.corpus.push(doc);
    this.rebuildIndex();
  }

  getAll() {
    return [...this.corpus];
  }
}

module.exports = new KnowledgeService();