#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dashboardPath = path.join(root, 'src', 'pages', 'Admin', 'AdminDashboard.jsx');
const layoutPath = path.join(root, 'src', 'pages', 'Admin', 'AdminLayout.jsx');
const appPath = path.join(root, 'src', 'App.jsx');
const mobileCssPath = path.join(root, 'src', 'styles', 'admin-command-center-mobile.css');

const dashboard = fs.readFileSync(dashboardPath, 'utf8');
const layout = fs.readFileSync(layoutPath, 'utf8');
const app = fs.readFileSync(appPath, 'utf8');
const mobileCss = fs.readFileSync(mobileCssPath, 'utf8');

const failures = [];

const modules = [
  ['verifications', 'PendingVerificationsTab'],
  ['users', 'UserManagementTab'],
  ['rides', 'RideManagementTab'],
  ['sos', 'EmergencyAlertsTab'],
  ['notifications', 'AdminNotificationsTab'],
  ['seo', 'SeoAnalyticsTab'],
  ['finance', 'FinanceTab'],
  ['disputes', 'DisputesTab'],
  ['communities', 'CommunitiesTab'],
  ['climate', 'ClimateTab'],
  ['maintenance', 'MaintenanceTab'],
];

for (const [route, component] of modules) {
  if (!dashboard.includes(`val: '${route}'`)) {
    failures.push(`Missing admin tab definition: ${route}`);
  }
  if (!dashboard.includes(`value="${route}"`)) {
    failures.push(`Missing admin tab content: ${route}`);
  }
  if (!dashboard.includes(`<${component}`)) {
    failures.push(`Missing admin module component: ${component}`);
  }
}

if (!app.includes('<Route path="/admin"')) failures.push('Missing /admin route');
if (!app.includes('<Route path=":tab" element={<AdminDashboard />}')) failures.push('Missing /admin/:tab route');
if (!app.includes('hasAdminAccess')) failures.push('Missing admin access guard');
if (!layout.includes("navigate('/dashboard')")) failures.push('Missing back-to-dashboard action');
if (!layout.includes('handleSignOut')) failures.push('Missing admin sign-out action');

for (const selector of [
  '.admin-command-center',
  '.admin-command-center__modules',
  '.admin-command-center__tabs-list',
]) {
  if (!mobileCss.includes(selector)) failures.push(`Missing mobile command center selector: ${selector}`);
}

if (!mobileCss.includes('overflow-x: auto')) failures.push('Mobile admin tabs must remain horizontally scrollable');

if (failures.length) {
  console.error('❌ Admin command center health check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('✅ Admin command center health check passed.');
