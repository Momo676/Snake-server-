# Damn Bruh — Slither Arena

Fast-paced Slither.io arena webgame with mobile follow-anchor swipe steering, double-tap boost, EGP stake rooms (`25 / 50 / 100 EGP`), fragment money drops, simulated xPay preview wallet, 3-second cash-out, and Gemini Photo Skin Studio.

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

To enable **Photo Skin Studio** locally, create `.env` from `.env.example` and set a billing-enabled `GEMINI_API_KEY`.

## Deploy to Cloudflare Pages

### Option A: Connect via GitHub (Full-Stack, includes `/api/analyze-image`)
1. Push all files from `damn-bruh-github.zip` to your GitHub repository.
2. In **Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git**, select your repo.
3. Configure build settings:
   - **Framework preset**: `Vite`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
4. *(Optional for Photo Skin Studio)* Under **Settings → Environment variables**, add `GEMINI_API_KEY` (the included `functions/api/analyze-image.js` handles `/api/analyze-image` on Cloudflare Pages automatically).

### Option B: Direct Static Upload (Fastest, zero build setup)
1. Upload `damn-bruh-cloudflare-dist.zip` directly in **Cloudflare Pages → Direct Upload** (or upload the `dist/` folder after running `npm run build`).
2. All arena gameplay, rooms, fragment payouts, and xPay preview wallet work out of the box.

## Running Unit Tests

```bash
npx tsx --test src/game/rules.test.ts
```
