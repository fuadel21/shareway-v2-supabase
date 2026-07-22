#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dashboardPath = path.join(root, 'src', 'pages', 'Admin', 'AdminDashboard.jsx');
const layoutPath = path.join(root, 'src', 'pages', 'Admin', 'AdminLayout.jsx');
const appPath = path.join(root, 'src', 'App.jsx');
const mobileCssPath = path.join(root, 'src', 'pages', 'Admin', 'admin-mobile-command-center.css');

const requiredFiles = [dashboardPath, layoutPath, appPath, mobileCssPath];
const missingFiles = requiredFiles.filter((filePath) => !fs.existsSync(filePath));

if (missingFiles.length > 0) {
  console.error('❌ Admin command center health check failed:');
  for (const filePath of missingFiles) {
    console.error(`- Missing required file: ${path.relative(root, filePath)}`);
  }
  process.exit(1);
}

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
if (!layout.includes("import './admin-mobile-command-center.css'")) failures.push('Missing admin mobile stylesheet import');

for (const selector of [
  '.admin-shell',
  '.admin-shell__header',
  '.admin-shell__content',
  '[role="tablist"]',
  '[role="tab"]',
]) {
  if (!mobileCss.includes(selector)) failures.push(`Missing mobile command center selector: ${selector}`);
}

if (!mobileCss.includes('overflow-x: auto')) failures.push('Mobile admin tabs must remain horizontally scrollable');
if (!dashboard.includes('adminTabs.map')) failures.push('Admin module navigation must be generated from the tab registry');
if (!dashboard.includes('onValueChange={(value) => navigate(`/admin/${value}`)}')) failures.push('Admin tab changes must update the route');

if (failures.length) {
  console.error('❌ Admin command center health check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('✅ Admin command center health check passed.');
