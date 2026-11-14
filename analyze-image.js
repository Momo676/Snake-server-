const MODEL_NAME = 'gemini-4-argon';

export async function onRequestPost(context) {
  try {
    const apiKey = context?.env?.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      return jsonResponse(
        {
          error:
            'GEMINI_API_KEY is not configured. Add a valid paid API key in Cloudflare Pages Environment Variables to analyze photos with gemini-4-argon.',
        },
        400,
      );
    }

    const body = await context.request.json();
    const { imageBase64, mimeType, promptHint } = body || {};

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return jsonResponse({ error: 'Please upload a valid image file first.' }, 400);
    }

    const safeMime =
      typeof mimeType === 'string' && mimeType.startsWith('image/')
        ? mimeType
        : 'image/jpeg';

    const cleanBase64 = imageBase64.includes(',')
      ? imageBase64.split(',')[1]
      : imageBase64;

    const instruction =
      'Analyze this uploaded photo carefully and translate its visual subjects, colors, textures, and mood into a custom Slither.io serpent skin and concise image understanding summary.';
    const userPrompt = promptHint
      ? `${instruction} User focus note: ${promptHint}`
      : instruction;

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: 'You are a sharp visual analyst and arcade game skin designer. Describe what is actually visible in the uploaded photo accurately in 1-2 sentences, then pick 4 vibrant, high-contrast hex colors from the image (avoiding pure black #000000 so the serpent stands out against a dark #0B0F17 arena), a matching pattern, and an eye style.',
            },
          ],
        },
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: safeMime,
                  data: cleanBase64,
                },
              },
              {
                text: userPrompt,
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              title: { type: 'STRING' },
              description: { type: 'STRING' },
              palette: {
                type: 'ARRAY',
                items: { type: 'STRING' },
              },
              pattern: { type: 'STRING' },
              eyeStyle: { type: 'STRING' },
              trait: { type: 'STRING' },
            },
            required: ['title', 'description', 'palette', 'pattern', 'eyeStyle', 'trait'],
          },
        },
      }),
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      const msg = data?.error?.message || `HTTP ${upstream.status}`;
      if (upstream.status === 429 || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
        return jsonResponse(
          {
            error:
              'gemini-4-argon requires a billing-enabled API key or available quota. Check your Cloudflare Pages GEMINI_API_KEY variable.',
          },
          429,
        );
      }
      if (upstream.status === 403 || upstream.status === 400 || msg.includes('API_KEY_INVALID')) {
        return jsonResponse(
          {
            error: 'API key rejected for gemini-4-argon. Verify your GEMINI_API_KEY.',
          },
          403,
        );
      }
      return jsonResponse({ error: `Image analysis failed: ${msg}` }, 500);
    }

    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    if (!rawText) {
      return jsonResponse({ error: 'Gemini returned an empty analysis response.' }, 502);
    }

    const parsed = JSON.parse(rawText);
    const validPatterns = new Set(['striped', 'gradient', 'spotted', 'solid', 'ringed']);
    const validEyes = new Set(['fierce', 'wide', 'cyber', 'cute']);
    const hexRegex = /^#[0-9A-Fa-f]{6}$/;

    const cleanPalette = (Array.isArray(parsed.palette) ? parsed.palette : [])
      .filter((c) => typeof c === 'string' && hexRegex.test(c))
      .slice(0, 5);

    const finalPalette =
      cleanPalette.length >= 2 ? cleanPalette : ['#A3E635', '#38BDF8', '#F43F5E'];

    return jsonResponse({
      model: MODEL_NAME,
      title: (parsed.title || 'Photo Serpent').slice(0, 32),
      description:
        parsed.description || 'Custom visual pattern extracted from your uploaded image.',
      palette: finalPalette,
      pattern: validPatterns.has(parsed.pattern || '') ? parsed.pattern : 'striped',
      eyeStyle: validEyes.has(parsed.eyeStyle || '') ? parsed.eyeStyle : 'fierce',
      trait: (parsed.trait || 'Custom photo-mapped scales').slice(0, 48),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: `Image analysis failed: ${message}` }, 500);
  }
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
