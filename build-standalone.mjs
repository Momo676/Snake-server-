import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const assetsDir = path.join(distDir, 'assets');
const outFile = path.join(rootDir, 'damn-bruh.html');

if (!fs.existsSync(distDir) || !fs.existsSync(assetsDir)) {
  throw new Error('dist/assets not found. Run "npm run build" first.');
}

const files = fs.readdirSync(assetsDir);
const cssFile = files.find((f) => f.endsWith('.css'));
const jsFile = files.find((f) => f.endsWith('.js'));

if (!cssFile || !jsFile) {
  throw new Error('Could not find built JS/CSS assets in dist/assets.');
}

const rawHtml = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
const rawCss = fs.readFileSync(path.join(assetsDir, cssFile), 'utf8');
const rawJs = fs.readFileSync(path.join(assetsDir, jsFile), 'utf8');

// Convert built JS into a strict classic IIFE so it runs reliably over file:// as well as http(s)://
const transformed = await esbuild.transform(rawJs, {
  loader: 'js',
  format: 'iife',
  minify: true,
});

const safeCss = rawCss.replace(/<\/style>/gi, '<\\/style>');
const safeJs = transformed.code.replace(/<\/script>/gi, '<\\/script>');

let singleHtml = rawHtml
  .replace(/<script\b[^>]*src="[^"]*"[^>]*><\/script>\s*/gi, '')
  .replace(/<link\b[^>]*rel="stylesheet"[^>]*>\s*/gi, '');

singleHtml = singleHtml.replace(
  '</head>',
  `  <style>${safeCss}</style>\n  </head>`,
);

singleHtml = singleHtml.replace(
  '</body>',
  `  <script>${safeJs}</script>\n  </body>`,
);

fs.writeFileSync(outFile, singleHtml, 'utf8');
const sizeKb = (Buffer.byteLength(singleHtml, 'utf8') / 1024).toFixed(1);
console.log(`Extracted standalone file: ${outFile} (${sizeKb} KB)`);
