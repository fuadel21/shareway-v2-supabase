import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const requiredFiles = [
  'index.html',
  'package.json',
  'src/main.jsx',
  'src/index.css',
  'src/i18n/rtl.css',
  'src/styles/mobile-navigation-polish.css',
  'src/styles/mobile-accessibility-touch-polish.css',
  'src/styles/responsive-tablet-desktop-polish.css',
  'src/styles/visual-performance-motion-polish.css',
  'public/manifest.json',
  'public/robots.txt',
  'public/sitemap.xml',
  'public/seo-sitemap.xml',
  'public/sitemap-growth-cities.xml',
  'public/sitemap-growth-routes.xml',
  'public/sitemap-growth-airports.xml',
  'public/sitemap-guides.xml'
];

const errors = [];

function assertFileExists(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    errors.push(`Missing required file: ${relativePath}`);
    return;
  }

  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) {
    errors.push(`Expected file but found something else: ${relativePath}`);
  }
}

for (const file of requiredFiles) {
  assertFileExists(file);
}

const mainPath = path.join(root, 'src/main.jsx');
if (fs.existsSync(mainPath)) {
  const main = fs.readFileSync(mainPath, 'utf8');
  const cssImports = [...main.matchAll(/import\s+['"](\.\/?[^'"]+\.css)['"];?/g)].map((match) => match[1]);

  for (const cssImport of cssImports) {
    const resolved = path.resolve(path.dirname(mainPath), cssImport);
    const relative = path.relative(root, resolved).replaceAll(path.sep, '/');
    if (!fs.existsSync(resolved)) {
      errors.push(`Broken CSS import in src/main.jsx: ${cssImport} -> ${relative}`);
    }
  }

  const expectedCssImports = [
    './styles/mobile-navigation-polish.css',
    './styles/mobile-accessibility-touch-polish.css',
    './styles/responsive-tablet-desktop-polish.css',
    './styles/visual-performance-motion-polish.css'
  ];

  for (const expected of expectedCssImports) {
    if (!main.includes(`import '${expected}';`)) {
      errors.push(`Missing responsive polish import in src/main.jsx: ${expected}`);
    }
  }
}

const sitemapIndexPath = path.join(root, 'public/sitemap.xml');
if (fs.existsSync(sitemapIndexPath)) {
  const sitemap = fs.readFileSync(sitemapIndexPath, 'utf8');
  const expectedSitemaps = [
    'seo-sitemap.xml',
    'sitemap-growth-cities.xml',
    'sitemap-growth-routes.xml',
    'sitemap-growth-airports.xml',
    'sitemap-guides.xml'
  ];

  for (const expected of expectedSitemaps) {
    if (!sitemap.includes(expected)) {
      errors.push(`Sitemap index is missing ${expected}`);
    }
  }
}

if (errors.length > 0) {
  console.error('Asset/import health check failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('Asset/import health check passed.');
