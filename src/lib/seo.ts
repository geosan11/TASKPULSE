import { canonicalFor, OG_IMAGE, ROUTE_META, SITE_NAME } from './seo-routes';

/** Set or create a <meta> by name/property. */
function setMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.rel = 'canonical';
    document.head.appendChild(el);
  }
  el.href = href;
}

/**
 * Small head manager for the SPA: title, description, canonical, Open Graph
 * and Twitter tags per public route. Unknown paths get the home page tags
 * plus noindex so they never compete with real pages.
 */
export function applyRouteHead(path: string) {
  if (typeof document === 'undefined') return;
  const known = ROUTE_META[path];
  const meta = known || ROUTE_META['/'];
  const url = canonicalFor(meta.path);
  document.title = meta.title;
  setMeta('name', 'description', meta.description);
  setMeta('name', 'robots', known ? 'index, follow' : 'noindex, follow');
  setCanonical(url);
  setMeta('property', 'og:site_name', SITE_NAME);
  setMeta('property', 'og:type', 'website');
  setMeta('property', 'og:locale', 'en_NG');
  setMeta('property', 'og:title', meta.title);
  setMeta('property', 'og:description', meta.description);
  setMeta('property', 'og:url', url);
  setMeta('property', 'og:image', OG_IMAGE);
  setMeta('name', 'twitter:card', 'summary_large_image');
  setMeta('name', 'twitter:title', meta.title);
  setMeta('name', 'twitter:description', meta.description);
  setMeta('name', 'twitter:image', OG_IMAGE);
}
