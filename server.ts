import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import type { ClientMessage, ServerMessage } from './src/game/netTypes.ts';
import { ArenaRoomManager } from './src/server/arenaManager.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const MODEL_NAME = 'gemini-4-argon';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY_MISSING');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, model: MODEL_NAME, multiplayer: true });
  });

  const standalonePath = path.resolve(__dirname, 'damn-bruh.html');
  app.get('/damn-bruh.html', (_req, res) => {
    if (!fs.existsSync(standalonePath)) {
      res.status(404).send('Standalone file not generated yet.');
      return;
    }
    res.sendFile(standalonePath);
  });

  app.get('/download/damn-bruh.html', (_req, res) => {
    if (!fs.existsSync(standalonePath)) {
      res.status(404).send('Standalone file not generated yet.');
      return;
    }
    res.download(standalonePath, 'damn-bruh.html');
  });

  app.get('/download/damn-bruh-github.zip', (_req, res) => {
    const zipPath = path.resolve(__dirname, 'exports', 'damn-bruh-github.zip');
    if (!fs.existsSync(zipPath)) {
      res.status(404).send('GitHub source zip not generated yet.');
      return;
    }
    res.download(zipPath, 'damn-bruh-github.zip');
  });

  app.get('/download/damn-bruh-cloudflare-dist.zip', (_req, res) => {
    const zipPath = path.resolve(__dirname, 'exports', 'damn-bruh-cloudflare-dist.zip');
    if (!fs.existsSync(zipPath)) {
      res.status(404).send('Cloudflare dist zip not generated yet.');
      return;
    }
    res.download(zipPath, 'damn-bruh-cloudflare-dist.zip');
  });

  app.get('/download/damn-bruh-folder.zip', (_req, res) => {
    const zipPath = path.resolve(__dirname, 'exports', 'damn-bruh-folder.zip');
    if (!fs.existsSync(zipPath)) {
      res.status(404).send('Folder zip not generated yet.');
      return;
    }
    res.download(zipPath, 'damn-bruh-folder.zip');
  });

  app.use('/damn-bruh', express.static(path.resolve(__dirname, 'damn-bruh')));

  app.post('/api/analyze-image', async (req, res) => {
    try {
      const { imageBase64, mimeType, promptHint } = req.body as {
        imageBase64?: string;
        mimeType?: string;
        promptHint?: string;
      };

      if (!imageBase64 || typeof imageBase64 !== 'string') {
        res.status(400).json({ error: 'Please upload a valid image file first.' });
        return;
      }

      const safeMime =
        typeof mimeType === 'string' && mimeType.startsWith('image/')
          ? mimeType
          : 'image/jpeg';

      const cleanBase64 = imageBase64.includes(',')
        ? imageBase64.split(',')[1]
        : imageBase64;

      const ai = getGeminiClient();

      const instruction =
        'Analyze this uploaded photo carefully and translate its visual subjects, colors, textures, and mood into a custom Slither.io serpent skin and concise image understanding summary.';

      const userPrompt = promptHint
        ? `${instruction} User focus note: ${promptHint}`
        : instruction;

      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: {
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
        config: {
          systemInstruction:
            'You are a sharp visual analyst and arcade game skin designer. Describe what is actually visible in the uploaded photo accurately in 1-2 sentences, then pick 4 vibrant, high-contrast hex colors from the image (avoiding pure black #000000 so the serpent stands out against a dark #0B0F17 arena), a matching pattern, and an eye style.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: {
                type: Type.STRING,
                description: 'Short 2-3 word serpent codename inspired by the photo.',
              },
              description: {
                type: Type.STRING,
                description: 'Accurate 1-2 sentence analysis of what is in the uploaded photo.',
              },
              palette: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '3 to 5 hex color codes (#RRGGBB) inspired by the photo.',
              },
              pattern: {
                type: Type.STRING,
                description: 'One of: striped, gradient, spotted, solid, ringed',
              },
              eyeStyle: {
                type: Type.STRING,
                description: 'One of: fierce, wide, cyber, cute',
              },
              trait: {
                type: Type.STRING,
                description: 'Short 3-6 word visual texture summary.',
              },
            },
            required: ['title', 'description', 'palette', 'pattern', 'eyeStyle', 'trait'],
          },
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        res.status(502).json({ error: 'Gemini returned an empty analysis response.' });
        return;
      }

      const parsed = JSON.parse(rawText) as {
        title?: string;
        description?: string;
        palette?: string[];
        pattern?: string;
        eyeStyle?: string;
        trait?: string;
      };

      const validPatterns = new Set(['striped', 'gradient', 'spotted', 'solid', 'ringed']);
      const validEyes = new Set(['fierce', 'wide', 'cyber', 'cute']);
      const hexRegex = /^#[0-9A-Fa-f]{6}$/;

      const cleanPalette = (Array.isArray(parsed.palette) ? parsed.palette : [])
        .filter((c) => typeof c === 'string' && hexRegex.test(c))
        .slice(0, 5);

      const finalPalette =
        cleanPalette.length >= 2 ? cleanPalette : ['#A3E635', '#38BDF8', '#F43F5E'];

      res.json({
        model: MODEL_NAME,
        title: (parsed.title || 'Photo Serpent').slice(0, 32),
        description:
          parsed.description || 'Custom visual pattern extracted from your uploaded image.',
        palette: finalPalette,
        pattern: validPatterns.has(parsed.pattern || '') ? parsed.pattern : 'striped',
        eyeStyle: validEyes.has(parsed.eyeStyle || '') ? parsed.eyeStyle : 'fierce',
        trait: (parsed.trait || 'Custom photo-mapped scales').slice(0, 48),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'GEMINI_API_KEY_MISSING') {
        res.status(400).json({
          error:
            'GEMINI_API_KEY is not configured. Add a valid paid API key in Settings > Secrets to analyze photos with gemini-4-argon.',
        });
        return;
      }
      if (
        message.includes('RESOURCE_EXHAUSTED') ||
        message.includes('429') ||
        message.includes('quota')
      ) {
        res.status(429).json({
          error:
            'gemini-4-argon requires a billing-enabled API key or available quota. Check Settings > Secrets.',
        });
        return;
      }
      if (
        message.includes('PERMISSION_DENIED') ||
        message.includes('API_KEY_INVALID') ||
        message.includes('403') ||
        message.includes('400')
      ) {
        res.status(403).json({
          error:
            'API key rejected for gemini-4-argon. Verify your billing-enabled key in Settings > Secrets.',
        });
        return;
      }
      console.error('Gemini analyze-image error:', err);
      res.status(500).json({
        error: `Image analysis failed: ${message}`,
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const httpServer = http.createServer(app);
  const arenaManager = new ArenaRoomManager({ autoTick: true });
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const aliveMap = new WeakMap<WebSocket, boolean>();

  wss.on('connection', (ws) => {
    const clientId = crypto.randomUUID();
    aliveMap.set(ws, true);

    arenaManager.handleConnect({
      id: clientId,
      send: (message: ServerMessage) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(message));
        }
      },
    });

    ws.on('pong', () => {
      aliveMap.set(ws, true);
    });

    ws.on('message', (raw) => {
      try {
        const parsed = JSON.parse(raw.toString()) as ClientMessage;
        arenaManager.handleMessage(clientId, parsed);
      } catch {
        // Ignore malformed client payloads
      }
    });

    ws.on('close', () => {
      arenaManager.handleDisconnect(clientId);
    });

    ws.on('error', () => {
      arenaManager.handleDisconnect(clientId);
    });
  });

  const heartbeatInterval = setInterval(() => {
    for (const client of wss.clients) {
      if (aliveMap.get(client) === false) {
        client.terminate();
        continue;
      }
      aliveMap.set(client, false);
      client.ping();
    }
  }, 25_000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
    arenaManager.destroy();
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Damn Bruh server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
