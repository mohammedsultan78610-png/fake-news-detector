exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { claim } = JSON.parse(event.body);
  if (!claim) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No claim provided' }) };
  }

  // 1. Web search using SerpAPI
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
        sources: [],
        raw: 'No search results.'
      })
    };
  }

  const snippets = results.map(r => r.snippet).join('\n');
  const sources = results.slice(0, 5).map(r => ({
    title: r.title,
    link: r.link
  }));

  // 2. AI fact-checking with Google Gemini — strict prompt
  const prompt = `You are a fact-checker. Analyze the news claim using ONLY the search snippets below. Return EXACTLY two lines in English, nothing else.

Line 1 must be: VERDICT: REAL
or: VERDICT: FAKE
or: VERDICT: MISLEADING
or: VERDICT: UNCERTAIN

Line 2 must be: EXPLANATION: [one or two sentences]

Do not include any other text, asterisks, or extra words. If the snippets are insufficient, return VERDICT: UNCERTAIN and an explanation about lacking evidence.

Claim: ${claim}

Search Snippets:
${snippets}`;

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

  // DEBUG: include raw AI text so we can see what Gemini actually said
  return {
    statusCode: 200,
    body: JSON.stringify({ verdict, explanation, sources, raw: aiText })
  };
};
