import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';
import {canonicalFor, ROUTE_META} from './src/lib/seo-routes';

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * Writes dist/business.html, dist/terms.html, dist/privacy.html: copies of the
 * built index.html with that route's title, description, canonical, OG and
 * Twitter tags, so WhatsApp/X/LinkedIn previews (which do not run JS) show the
 * right page. vercel.json rewrites /business -> /business.html etc.
 */
function routeHtml(): Plugin {
  return {
    name: 'taskpulse-route-html',
    apply: 'build',
    writeBundle(options) {
      const outDir = options.dir || path.resolve(__dirname, 'dist');
      const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
      for (const meta of Object.values(ROUTE_META)) {
        if (meta.path === '/') continue;
        const title = escapeAttr(meta.title);
        const desc = escapeAttr(meta.description);
        const url = canonicalFor(meta.path);
        const out = html
          .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
          .replace(/(<meta name="description" content=")[^"]*(")/, `$1${desc}$2`)
          .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`)
          .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${title}$2`)
          .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${desc}$2`)
          .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
          .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${title}$2`)
          .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${desc}$2`);
        if (!out.includes(`href="${url}"`)) throw new Error(`route html: canonical not replaced for ${meta.path}`);
        fs.writeFileSync(path.join(outDir, `${meta.path.slice(1)}.html`), out);
      }
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), routeHtml()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
