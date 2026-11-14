import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const assetsDir = path.join(distDir, 'assets');
const exportsDir = path.join(rootDir, 'exports');
const flatDir = path.join(rootDir, 'damn-bruh');

if (!fs.existsSync(distDir) || !fs.existsSync(assetsDir)) {
  throw new Error('dist/ not found. Run "npm run build" first.');
}

const files = fs.readdirSync(assetsDir);
const cssFile = files.find((f) => f.endsWith('.css'));
const jsFile = files.find((f) => f.endsWith('.js'));
if (!cssFile || !jsFile) {
  throw new Error('Could not find built CSS/JS in dist/assets.');
}

// 1. Populate flat single folder /damn-bruh/ with all deployable files
fs.rmSync(flatDir, { recursive: true, force: true });
fs.mkdirSync(flatDir, { recursive: true });

const rawHtml = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
const rawCss = fs.readFileSync(path.join(assetsDir, cssFile), 'utf8');
const rawJs = fs.readFileSync(path.join(assetsDir, jsFile), 'utf8');

const transformed = await esbuild.transform(rawJs, {
  loader: 'js',
  format: 'iife',
  minify: true,
});

const flatHtml = rawHtml
  .replace(/<script\b[^>]*src="[^"]*"[^>]*><\/script>\s*/gi, '')
  .replace(/<link\b[^>]*rel="stylesheet"[^>]*>\s*/gi, '')
  .replace(
    '</head>',
    '    <link rel="stylesheet" href="./style.css" />\n    <script defer src="./script.js"></script>\n  </head>',
  );

fs.writeFileSync(path.join(flatDir, 'index.html'), flatHtml, 'utf8');
fs.writeFileSync(path.join(flatDir, 'style.css'), rawCss, 'utf8');
fs.writeFileSync(path.join(flatDir, 'script.js'), transformed.code, 'utf8');

fs.writeFileSync(
  path.join(flatDir, 'wrangler.jsonc'),
  `{\n  "name": "damn-bruh",\n  "compatibility_date": "2026-11-14",\n  "assets": {\n    "directory": "./"\n  }\n}\n`,
  'utf8',
);

fs.writeFileSync(
  path.join(flatDir, 'Dockerfile'),
  `FROM nginx:alpine\nCOPY index.html style.css script.js /usr/share/nginx/html/\n`,
  'utf8',
);

fs.writeFileSync(
  path.join(flatDir, 'fly.toml'),
  `app = "snakeoriginal"\nprimary_region = "ams"\n\n[http_service]\n  internal_port = 80\n  force_https = true\n  auto_stop_machines = "stop"\n  auto_start_machines = true\n  min_machines_running = 0\n`,
  'utf8',
);

// 2. Build ZIP packages
fs.mkdirSync(exportsDir, { recursive: true });

const githubZip = path.join(exportsDir, 'damn-bruh-github.zip');
const cloudflareZip = path.join(exportsDir, 'damn-bruh-cloudflare-dist.zip');
const folderZip = path.join(exportsDir, 'damn-bruh-folder.zip');

const pythonScript = `
import os
import zipfile

root_dir = ${JSON.stringify(rootDir)}
dist_dir = ${JSON.stringify(distDir)}
flat_dir = ${JSON.stringify(flatDir)}
github_zip = ${JSON.stringify(githubZip)}
cloudflare_zip = ${JSON.stringify(cloudflareZip)}
folder_zip = ${JSON.stringify(folderZip)}

EXCLUDE_DIRS = {
    'node_modules',
    'dist',
    'exports',
    'damn-bruh',
    '.git',
    '.aistudio',
    '.playwright-cli',
}
EXCLUDE_FILES = {
    '.env',
    '.DS_Store',
    'damn-bruh.html',
}

with zipfile.ZipFile(github_zip, 'w', zipfile.ZIP_DEFLATED) as zf:
    for dirpath, dirnames, filenames in os.walk(root_dir):
        dirnames[:] = sorted([d for d in dirnames if d not in EXCLUDE_DIRS])
        for fname in sorted(filenames):
            if fname in EXCLUDE_FILES or (fname.startswith('.env.') and fname != '.env.example'):
                continue
            full_path = os.path.join(dirpath, fname)
            rel_path = os.path.relpath(full_path, root_dir)
            zf.write(full_path, rel_path)

with zipfile.ZipFile(cloudflare_zip, 'w', zipfile.ZIP_DEFLATED) as zf:
    for dirpath, dirnames, filenames in os.walk(dist_dir):
        dirnames.sort()
        for fname in sorted(filenames):
            full_path = os.path.join(dirpath, fname)
            rel_path = os.path.relpath(full_path, dist_dir)
            zf.write(full_path, rel_path)

with zipfile.ZipFile(folder_zip, 'w', zipfile.ZIP_DEFLATED) as zf:
    for fname in sorted(os.listdir(flat_dir)):
        full_path = os.path.join(flat_dir, fname)
        if os.path.isfile(full_path):
            zf.write(full_path, os.path.join('damn-bruh', fname))
`;

execFileSync('python3', ['-c', pythonScript], { stdio: 'inherit' });

console.log(`Flat folder ready: ${flatDir}`);
console.log(`Created ${folderZip} (${(fs.statSync(folderZip).size / 1024).toFixed(1)} KB)`);
console.log(`Created ${githubZip} (${(fs.statSync(githubZip).size / 1024).toFixed(1)} KB)`);
console.log(`Created ${cloudflareZip} (${(fs.statSync(cloudflareZip).size / 1024).toFixed(1)} KB)`);
