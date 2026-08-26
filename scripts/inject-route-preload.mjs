// Post-build step: teach the prerendered index.html to preload the route chunk
// it is about to need.
//
// Remix SPA mode writes ONE index.html and serves it for every path, so its
// <head> can only reference the shared entry — the route's own JS and CSS are
// discovered afterwards, by parsing that entry. Measured on a production build
// of /style: root JS at 72 ms, the style route chunk at 153 ms, and the route's
// stylesheet only at 417 ms. Three sequential round trips before the Style app
// can paint, and on a phone each of those is a real RTT rather than localhost.
//
// The index.html cannot know its path at build time, but it CAN know it at
// parse time — the app-mode script in root.tsx already reads location before
// hydration. So we inject a tiny script that appends the right <link> tags for
// the route this load is actually going to render, which starts hops two and
// three immediately instead of after the entry parses.
//
// Runs from `npm run build`, after Remix has written index.html.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const CLIENT = 'build/client';
const HTML = join(CLIENT, 'index.html');
const ASSETS = join(CLIENT, 'assets');

// Remix's own asset manifest carries the per-route module + css it needs to
// hydrate, which is exactly the mapping we want. (Vite's build.manifest is not
// emitted under the Remix plugin, so this is the source of truth.)
const ROUTE_IDS = { style: 'routes/style', index: 'routes/_index' };

if (!existsSync(HTML) || !existsSync(ASSETS)) {
  console.warn('[route-preload] skipped: no index.html or assets dir');
  process.exit(0);
}

const manifestFile = readdirSync(ASSETS).find(f => /^manifest-[a-z0-9]+\.js$/.test(f));
if (!manifestFile) {
  console.warn('[route-preload] skipped: no remix asset manifest');
  process.exit(0);
}

const raw = readFileSync(join(ASSETS, manifestFile), 'utf8');
const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
let routes;
try {
  routes = JSON.parse(json).routes ?? {};
} catch {
  console.warn('[route-preload] skipped: could not parse the asset manifest');
  process.exit(0);
}

const map = {};
for (const [key, id] of Object.entries(ROUTE_IDS)) {
  const r = routes[id];
  // The route's own chunk plus its stylesheets. Its shared imports are left
  // alone: the entry already pulls those on the first hop.
  if (r?.module) map[key] = { js: r.module, css: r.css ?? [] };
}

if (!Object.keys(map).length) {
  console.warn('[route-preload] skipped: neither route found in the manifest');
  process.exit(0);
}

// Path test mirrors isStyleSurface() in app/utils/app-mode.ts — keep in sync.
const script = `<script>(function(){try{
var M=${JSON.stringify(map)};
var q=new URLSearchParams(location.search).get('app');
var m=(q==='style'||q==='catalog')?q:(location.hash==='#style')?'style':(location.hash==='#app')?'catalog':null;
if(!m){try{m=sessionStorage.getItem('catalog:app-mode');}catch(_){}}
var isStyle=(m==='style')||/^\\/style(\\/|$)/.test(location.pathname);
var a=isStyle?M.style:M.index;
if(!a)return;
var add=function(href,rel,as){var l=document.createElement('link');l.rel=rel;if(as)l.as=as;l.href=href;document.head.appendChild(l);};
add(a.js,'modulepreload');
for(var i=0;i<a.css.length;i++)add(a.css[i],'preload','style');
}catch(_){}})();</script>`;

let html = readFileSync(HTML, 'utf8');
if (html.includes('[route-preload]')) {
  console.log('[route-preload] already injected');
  process.exit(0);
}
html = html.replace('</head>', `<!--[route-preload]-->${script}</head>`);
writeFileSync(HTML, html);
console.log('[route-preload] injected:', Object.keys(map).map(k => `${k} -> ${map[k].js}`).join(', '));
