/**
 * AI Text Completion Client
 * Configurable via AI_API_KEY, AI_API_URL, and AI_MODEL.
 */
async function generateText(prompt) {
  const apiKey = process.env.AI_API_KEY;
  const apiUrl = process.env.AI_API_URL || 'https://api.openai.com/v1/chat/completions';
  const model = process.env.AI_MODEL || 'gpt-4o-mini';

  if (!apiKey) {
    throw new Error('AI_API_KEY environment variable is not configured');
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`AI API error (${response.status}): ${errBody}`);
  }

  const data = await response.json();
  const output = data.choices?.[0]?.message?.content || data.response || JSON.stringify(data);
  return output;
}

module.exports = {
  generateText
};