import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const requiredFiles = [
  'public/manifest.json',
  'public/robots.txt',
  'public/sitemap.xml',
  'public/seo-sitemap.xml',
  'docs/seo-pwa-consistency.md',
];

const forbiddenSeoTerms = [
  /taxi\s+compartido/i,
  /compartir\s+taxi/i,
  /taxi\s+barato/i,
  /reservar\s+taxi/i,
  /empresa\s+de\s+taxi/i,
  /conductor\s+profesional/i,
  /\bVTC\b/i,
];

const seoPublicFiles = [
  'public/manifest.json',
  'public/sitemap.xml',
  'public/seo-sitemap.xml',
];

const expectedShortcuts = new Map([
  ['/dashboard', 'Dashboard'],
  ['/publish', 'Publicar viaje'],
  ['/request', 'Pedir plaza'],
  ['/my-rides?tab=active', 'Mis viajes'],
]);

const errors = [];

function readText(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

function hasCategory(manifest, category) {
  return Array.isArray(manifest.categories) && manifest.categories.includes(category);
}

for (const file of requiredFiles) {
  if (!existsSync(resolve(root, file))) {
    errors.push(`Missing required SEO/PWA file: ${file}`);
  }
}

if (errors.length === 0) {
  const manifest = JSON.parse(readText('public/manifest.json'));

  if (manifest.id !== '/') {
    errors.push('public/manifest.json must keep id as /.');
  }

  if (manifest.start_url !== '/') {
    errors.push('public/manifest.json must keep start_url as / for stable PWA launches.');
  }

  if (manifest.scope !== '/') {
    errors.push('public/manifest.json must keep scope as /.');
  }

  if (manifest.display !== 'standalone') {
    errors.push('public/manifest.json must keep display as standalone.');
  }

  if (!Array.isArray(manifest.display_override) || !manifest.display_override.includes('minimal-ui')) {
    errors.push('public/manifest.json should keep display_override with minimal-ui fallback.');
  }

  if (manifest.lang !== 'es-ES') {
    errors.push('public/manifest.json must keep lang as es-ES.');
  }

  if (manifest.dir !== 'ltr') {
    errors.push('public/manifest.json must keep dir as ltr.');
  }

  if (manifest.theme_color !== '#0f172a') {
    errors.push('public/manifest.json must keep theme_color as #0f172a.');
  }

  if (manifest.background_color !== '#f8fafc') {
    errors.push('public/manifest.json must keep background_color as #f8fafc.');
  }

  for (const category of ['travel', 'navigation', 'transportation', 'social']) {
    if (!hasCategory(manifest, category)) {
      errors.push(`public/manifest.json is missing category: ${category}`);
    }
  }

  if (!String(manifest.name || '').toLowerCase().includes('coche')) {
    errors.push('public/manifest.json name should keep car-sharing positioning.');
  }

  if (!String(manifest.description || '').toLowerCase().includes('comparte coche')) {
    errors.push('public/manifest.json description should mention comparte coche.');
  }

  const shortcuts = Array.isArray(manifest.shortcuts) ? manifest.shortcuts : [];
  const shortcutUrls = new Set(shortcuts.map((shortcut) => shortcut.url));
  for (const [url, name] of expectedShortcuts) {
    if (!shortcutUrls.has(url)) {
      errors.push(`public/manifest.json is missing PWA shortcut: ${url}`);
      continue;
    }

    const shortcut = shortcuts.find((item) => item.url === url);
    if (!shortcut?.name || !shortcut.name.toLowerCase().includes(name.toLowerCase().split(' ')[0])) {
      errors.push(`public/manifest.json shortcut ${url} should keep a clear name.`);
    }

    if (!Array.isArray(shortcut?.icons) || shortcut.icons.length === 0) {
      errors.push(`public/manifest.json shortcut ${url} should keep an icon.`);
    }
  }

  const robots = readText('public/robots.txt');
  for (const sitemap of [
    'https://www.shareway.es/sitemap.xml',
    'https://www.shareway.es/seo-sitemap.xml',
    'https://www.shareway.es/sitemap-growth-cities.xml',
    'https://www.shareway.es/sitemap-growth-routes.xml',
    'https://www.shareway.es/sitemap-growth-airports.xml',
    'https://www.shareway.es/sitemap-guides.xml',
  ]) {
    if (!robots.includes(`Sitemap: ${sitemap}`)) {
      errors.push(`public/robots.txt is missing sitemap: ${sitemap}`);
    }
  }

  const sitemapIndex = readText('public/sitemap.xml');
  if (!sitemapIndex.includes('<sitemapindex')) {
    errors.push('public/sitemap.xml must remain a sitemap index.');
  }

  for (const file of seoPublicFiles) {
    const content = readText(file);
    for (const pattern of forbiddenSeoTerms) {
      if (pattern.test(content)) {
        errors.push(`${file} contains forbidden SEO positioning term: ${pattern}`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error('SEO/PWA consistency check failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('SEO/PWA consistency check passed.');
