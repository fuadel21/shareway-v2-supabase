#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const appPath = path.join(root, 'src', 'App.jsx');
const app = fs.readFileSync(appPath, 'utf8');

const requiredProtectedRoutes = [
  'dashboard',
  'my-rides',
  'my-requests',
  'calendar',
  'chats',
  'notifications',
  'settings',
  'publish',
  'request',
  'wallet'
];

const requiredPublicRoutes = [
  '/',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/invite/:code',
  '/ciudades/:slug',
  '/rutas/:origin/:destination',
  '/aeropuertos/:slug',
  '/guias/:slug'
];

const forbiddenSeoRouteFragments = [
  'taxi-compartido',
  'compartir-taxi',
  'taxi-barato',
  'ahorrar-compartiendo-taxi',
  'vtc'
];

const failures = [];

for (const route of requiredProtectedRoutes) {
  const pattern = `path="${route}"`;
  if (!app.includes(pattern)) {
    failures.push(`Missing protected route: ${route}`);
  }
}

for (const route of requiredPublicRoutes) {
  if (route === '/') {
    if (!app.includes('path="/"')) failures.push('Missing public root route');
    continue;
  }
  const pattern = `path="${route}"`;
  if (!app.includes(pattern)) {
    failures.push(`Missing public route: ${route}`);
  }
}

for (const fragment of forbiddenSeoRouteFragments) {
  if (app.toLowerCase().includes(fragment)) {
    failures.push(`Forbidden taxi/VTC SEO route fragment found in App.jsx: ${fragment}`);
  }
}

const seoRoutesBlock = app.match(/const seoLandingRoutes = \[([\s\S]*?)\];/);
if (!seoRoutesBlock) {
  failures.push('Missing seoLandingRoutes block');
} else {
  const block = seoRoutesBlock[1].toLowerCase();
  for (const route of ['compartir-coche', 'carpooling', 'viajes-compartidos', 'rutas-compartidas', 'compartir-trayecto']) {
    if (!block.includes(route)) {
      failures.push(`Missing core SEO route: ${route}`);
    }
  }
}

if (failures.length) {
  console.error('❌ Public route health check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('✅ Public route health check passed.');
