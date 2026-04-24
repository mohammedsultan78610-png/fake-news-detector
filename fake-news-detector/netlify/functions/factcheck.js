exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { claim } = JSON.parse(event.body);
  if (!claim) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No claim provided' }) };
  }

  try {
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
          explanation: 'No relevant news articles found.',
          sources: []
        })
      };
    }

    const snippets = results.map(r => r.snippet).join('\n');
    const sources = results.slice(0, 5).map(r => ({
      title: r.title,
      link: r.link
    }));

    // 2. AI fact-checking using Groq (free, fast, reliable)
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

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1
      })
    });

    const groqData = await groqRes.json();

    // If Groq returned an error, show it
    if (groqData.error) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          verdict: 'ERROR',
          explanation: `Groq API error: ${groqData.error.message}`,
          sources
        })
      };
    }

    const aiText = groqData.choices?.[0]?.message?.content || '';

    const verdictMatch = aiText.match(/VERDICT:\s*(.*)/i);
    const explanationMatch = aiText.match(/EXPLANATION:\s*(.*)/i);
    const verdict = verdictMatch ? verdictMatch[1].trim().toUpperCase() : 'UNCERTAIN';
    const explanation = explanationMatch ? explanationMatch[1].trim() : 'AI response was empty or malformed';

    return {
      statusCode: 200,
      body: JSON.stringify({ verdict, explanation, sources })
    };
  } catch (error) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        verdict: 'ERROR',
        explanation: error.message,
        sources: []
      })
    };
  }
};
