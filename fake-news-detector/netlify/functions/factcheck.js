exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { claim } = JSON.parse(event.body);
  if (!claim) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No claim provided' }) };
  }

  // 1. Web search using SerpAPI (free tier, 100 searches/month)
  const searchUrl = `https://serpapi.com/search.json?q=${encodeURIComponent(claim)}&api_key=${process.env.SERP_API_KEY}`;
  const searchRes = await fetch(searchUrl);
  const searchData = await searchRes.json();

  const results = searchData.organic_results;
  if (!results || results.length === 0) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        verdict: 'UNCERTAIN',
        explanation: 'No relevant news articles found. Try a different claim.',
        sources: []
      })
    };
  }

  const snippets = results.map(r => r.snippet).join('\n');
  const sources = results.slice(0, 5).map(r => ({
    title: r.title,
    link: r.link
  }));

  // 2. AI fact-checking with Google Gemini
  const prompt = `You are a professional fact-checker. Given the news claim and search result snippets below, determine if the claim is REAL, FAKE, or MISLEADING. Provide a one- or two-sentence explanation. Use only the search results; if unsure, say UNCERTAIN.

Claim: ${claim}

Search Snippets:
${snippets}

Respond in this exact format:
VERDICT: [one word]
EXPLANATION: [your explanation]`;

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    }
  );
  const geminiData = await geminiRes.json();
  const aiText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

  const verdictMatch = aiText.match(/VERDICT:\s*(.*)/i);
  const explanationMatch = aiText.match(/EXPLANATION:\s*(.*)/i);
  const verdict = verdictMatch ? verdictMatch[1].trim().toUpperCase() : 'UNCERTAIN';
  const explanation = explanationMatch ? explanationMatch[1].trim() : 'Could not determine explanation.';

  return {
    statusCode: 200,
    body: JSON.stringify({ verdict, explanation, sources })
  };
};