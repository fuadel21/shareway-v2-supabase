import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];

const read = (filePath) => fs.readFileSync(path.join(root, filePath), 'utf8');
const exists = (filePath) => fs.existsSync(path.join(root, filePath));

const requireFile = (filePath, reason) => {
  if (!exists(filePath)) {
    failures.push(`${filePath} missing: ${reason}`);
  }
};

const mainPath = 'src/main.jsx';
const main = read(mainPath);
const importRegex = /import\s+['"](\.\/[A-Za-z0-9_./-]+\.css)['"];?/g;
const cssImports = [...main.matchAll(importRegex)].map((match) => match[1]);

if (cssImports.length === 0) {
  failures.push('src/main.jsx must import app CSS layers.');
}

for (const importPath of cssImports) {
  const normalized = path.normalize(path.join('src', importPath.replace(/^\.\//, '')));
  requireFile(normalized, `CSS import from ${mainPath}`);
}

const expectedCssImports = [
  './index.css',
  './i18n/rtl.css',
  './styles/mobile-navigation-polish.css',
  './styles/mobile-accessibility-touch-polish.css',
  './styles/responsive-tablet-desktop-polish.css',
  './styles/visual-performance-motion-polish.css',
];

for (const importPath of expectedCssImports) {
  if (!cssImports.includes(importPath)) {
    failures.push(`${mainPath} must import ${importPath}: keep responsive/polish CSS layers loaded`);
  }
}

const publicFiles = [
  'public/favicon.ico',
  'public/manifest.json',
  'public/robots.txt',
  'public/sitemap.xml',
  'public/seo-sitemap.xml',
  'public/sitemap-growth-cities.xml',
  'public/sitemap-growth-routes.xml',
  'public/sitemap-growth-airports.xml',
  'public/sitemap-guides.xml',
];

for (const filePath of publicFiles) {
  requireFile(filePath, 'public SEO/PWA asset');
}

const manifest = JSON.parse(read('public/manifest.json'));
if (manifest.start_url !== '/') {
  failures.push('public/manifest.json start_url must stay as / for installed PWA stability.');
}

if (!Array.isArray(manifest.shortcuts) || manifest.shortcuts.length < 4) {
  failures.push('public/manifest.json must keep the core PWA shortcuts.');
}

const robots = read('public/robots.txt');
for (const sitemap of [
  'https://www.shareway.es/sitemap.xml',
  'https://www.shareway.es/seo-sitemap.xml',
  'https://www.shareway.es/sitemap-growth-cities.xml',
  'https://www.shareway.es/sitemap-growth-routes.xml',
  'https://www.shareway.es/sitemap-growth-airports.xml',
  'https://www.shareway.es/sitemap-guides.xml',
]) {
  if (!robots.includes(`Sitemap: ${sitemap}`)) {
    failures.push(`public/robots.txt must reference ${sitemap}`);
  }
}

if (failures.length > 0) {
  console.error('App asset guard failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('App asset guard passed.');
