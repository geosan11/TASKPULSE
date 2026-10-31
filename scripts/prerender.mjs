import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const distSsrDir = path.join(rootDir, 'dist-ssr');
const ssrEntryPath = path.join(distSsrDir, 'entry-server.js');

if (!fs.existsSync(distDir) || !fs.existsSync(ssrEntryPath)) {
  console.error('Error: dist/ or dist-ssr/entry-server.js missing. Run build steps first.');
  process.exit(1);
}

const { render, ROUTE_META, canonicalFor } = await import(`file://${ssrEntryPath}?t=${Date.now()}`);

const escapeAttr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const SOURCE_FILES = {
  '/': ['src/components/Landing.tsx', 'src/App.tsx'],
  '/business': ['src/components/BusinessPage.tsx'],
  '/packages': ['src/components/PublicPackagesPage.tsx'],
  '/terms': ['src/components/TermsModal.tsx', 'src/components/LegalPage.tsx'],
  '/privacy': ['src/components/TermsModal.tsx', 'src/components/LegalPage.tsx'],
};

function getLastmod(route) {
  const files = SOURCE_FILES[route] || [];
  try {
    const out = execSync(`git log -1 --format=%cs -- ${files.join(' ')}`, {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(out)) return out;
  } catch {
    // Git unavailable or shallow clone without history
  }
  return new Date().toISOString().slice(0, 10);
}

// 1. Prerender the 5 public routes
const template = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
const routes = ['/', '/business', '/packages', '/terms', '/privacy'];

for (const route of routes) {
  const meta = ROUTE_META[route];
  if (!meta) throw new Error(`Missing ROUTE_META for ${route}`);

  const bodyMarkup = render(route);
  const title = escapeAttr(meta.title);
  const desc = escapeAttr(meta.description);
  const url = canonicalFor(route);

  let html = template
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${desc}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${title}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${desc}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${title}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${desc}$2`);

  // Ensure robots meta is present and set to index, follow
  if (html.includes('<meta name="robots"')) {
    html = html.replace(/(<meta name="robots" content=")[^"]*(")/, '$1index, follow$2');
  } else {
    html = html.replace('</head>', '    <meta name="robots" content="index, follow" />\n  </head>');
  }

  // Inject body markup inside <div id="root">
  html = html.replace(/<div id="root">[\s\S]*?<\/div>/, () => `<div id="root">${bodyMarkup}</div>`);

  const fileName = route === '/' ? 'index.html' : `${route.slice(1)}.html`;
  fs.writeFileSync(path.join(distDir, fileName), html, 'utf8');
  console.log(`Prerendered ${route} -> dist/${fileName}`);
}

// 2. Generate dist/404.html
const html404 = `<!doctype html>
<html lang="en-NG">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Page Not Found — TaskPulse</title>
    <meta name="description" content="The page you are looking for does not exist on TaskPulse." />
    <meta name="robots" content="noindex, follow" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
    <meta name="theme-color" content="#00C853" />
    <style>
      :root {
        --ink: #0f172a;
        --pulse: #00C853;
        --pulse-hover: #00b34a;
      }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background-color: #f8fafc;
        color: var(--ink);
        min-height: 100vh;
        display: flex;
        flex-direction: column;
      }
      header {
        height: 64px;
        padding: 0 24px;
        display: flex;
        align-items: center;
        background: #ffffff;
        border-bottom: 1px solid #e2e8f0;
      }
      .logo { height: 40px; width: auto; }
      main {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 32px 20px;
        text-align: center;
      }
      .card {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 24px;
        padding: 40px 24px;
        max-width: 480px;
        width: 100%;
        box-shadow: 0 4px 20px rgba(0,0,0,0.04);
      }
      .code {
        font-size: 56px;
        font-weight: 900;
        color: var(--pulse);
        line-height: 1;
        margin-bottom: 12px;
      }
      h1 {
        font-size: 24px;
        font-weight: 800;
        margin-bottom: 12px;
        color: var(--ink);
      }
      p {
        font-size: 15px;
        color: #64748b;
        line-height: 1.5;
        margin-bottom: 24px;
      }
      .links {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .btn-primary {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 48px;
        padding: 0 24px;
        background: var(--pulse);
        color: #0f172a;
        font-weight: 700;
        font-size: 15px;
        border-radius: 9999px;
        text-decoration: none;
        transition: background-color 0.2s;
      }
      .btn-primary:hover { background: var(--pulse-hover); }
      .btn-ghost {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 44px;
        padding: 0 20px;
        background: transparent;
        color: var(--ink);
        border: 1px solid #cbd5e1;
        font-weight: 600;
        font-size: 14px;
        border-radius: 9999px;
        text-decoration: none;
      }
      .btn-ghost:hover { background: #f1f5f9; }
      footer {
        padding: 20px;
        text-align: center;
        font-size: 13px;
        color: #94a3b8;
        border-top: 1px solid #e2e8f0;
      }
    </style>
  </head>
  <body>
    <header>
      <a href="/" aria-label="TaskPulse home">
        <img src="/brand/logo-lockup-light.png" alt="TaskPulse" class="logo" />
      </a>
    </header>
    <main>
      <div class="card">
        <div class="code">404</div>
        <h1>Page not found</h1>
        <p>The page you are looking for does not exist, has been moved, or is no longer available.</p>
        <div class="links">
          <a href="/" class="btn-primary">TaskPulse Home</a>
          <a href="/business" class="btn-ghost">TaskPulse for Businesses</a>
          <a href="/packages" class="btn-ghost">Ready-made Packages</a>
        </div>
      </div>
    </main>
    <footer>
      © ${new Date().getFullYear()} TaskPulse by GEOSAN NEXGEN INNOVATIONS
    </footer>
  </body>
</html>`;

fs.writeFileSync(path.join(distDir, '404.html'), html404, 'utf8');
console.log('Generated dist/404.html');

// 3. Generate dist/sitemap.xml
let sitemapXml = '<?xml version="1.0" encoding="UTF-8"?>\n';
sitemapXml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
for (const r of routes) {
  const url = canonicalFor(r);
  const lastmod = getLastmod(r);
  sitemapXml += '  <url>\n';
  sitemapXml += `    <loc>${url}</loc>\n`;
  sitemapXml += `    <lastmod>${lastmod}</lastmod>\n`;
  sitemapXml += '  </url>\n';
}
sitemapXml += '</urlset>\n';

fs.writeFileSync(path.join(distDir, 'sitemap.xml'), sitemapXml, 'utf8');
console.log('Generated dist/sitemap.xml');

// 4. Clean up dist-ssr
fs.rmSync(distSsrDir, { recursive: true, force: true });
console.log('Prerender complete.');
