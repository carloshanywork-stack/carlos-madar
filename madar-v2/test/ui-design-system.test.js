import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const tokensCssPath = resolve(__dirname, '../client/src/styles/tokens.css');
const supervisorCssPath = resolve(__dirname, '../client/src/modules/supervisor/supervisor-radar.css');
const repCssPath = resolve(__dirname, '../client/src/modules/rep/rep.css');

test('tokens.css declares standardized typography, radius, and accent bridge scales', () => {
  const content = readFileSync(tokensCssPath, 'utf8');

  // Typography scale: minimum 10px (no 8px)
  assert.match(content, /--madar-text-2xs:\s*10px;/);
  assert.match(content, /--madar-text-xs:\s*11px;/);
  assert.match(content, /--madar-text-sm:\s*12px;/);
  assert.match(content, /--madar-text-base:\s*14px;/);
  assert.match(content, /--madar-text-lg:\s*16px;/);
  assert.match(content, /--madar-text-xl:\s*18px;/);
  assert.match(content, /--madar-text-2xl:\s*22px;/);
  assert.match(content, /--madar-text-3xl:\s*28px;/);

  // Font weights
  assert.match(content, /--madar-weight-normal:\s*500;/);
  assert.match(content, /--madar-weight-bold:\s*800;/);
  assert.match(content, /--madar-weight-heavy:\s*900;/);

  // Radius scale
  assert.match(content, /--madar-radius-sm:\s*8px;/);
  assert.match(content, /--madar-radius-md:\s*10px;/);
  assert.match(content, /--madar-radius-lg:\s*14px;/);
  assert.match(content, /--madar-radius-xl:\s*16px;/);
  assert.match(content, /--madar-radius-full:\s*999px;/);

  // Component accent bridges
  assert.match(content, /--rep-green:\s*var\(--madar-accent\);/);
  assert.match(content, /--rep-green-dark:\s*var\(--madar-accent-strong\);/);
  assert.match(content, /--rep-green-pale:\s*var\(--madar-accent-pale\);/);
});

test('supervisor-radar.css and rep.css eliminate all microscopic 8px fonts', () => {
  const supervisorContent = readFileSync(supervisorCssPath, 'utf8');
  const repContent = readFileSync(repCssPath, 'utf8');

  // Verify zero instances of font-size: 8px across both stylesheets
  const supervisorMatches = supervisorContent.match(/font-size:\s*8px/g);
  assert.equal(supervisorMatches, null, `Found ${supervisorMatches?.length} unreadable 8px font declarations in supervisor-radar.css`);

  const repMatches = repContent.match(/font-size:\s*8px/g);
  assert.equal(repMatches, null, `Found ${repMatches?.length} unreadable 8px font declarations in rep.css`);
});

test('supervisor-radar.css defines full dark mode support via [data-theme="dark"]', () => {
  const content = readFileSync(supervisorCssPath, 'utf8');

  assert.match(content, /#madar-app\[data-theme="dark"\]/, 'Must include dark mode root rules');
  assert.match(content, /#madar-app\[data-theme="dark"\]\s+\.supervisor-page/);
  assert.match(content, /#madar-app\[data-theme="dark"\]\s+\.supervisor-kpis\s+article/);
  assert.match(content, /#madar-app\[data-theme="dark"\]\s+\.supervisor-panel/);
  assert.match(content, /#madar-app\[data-theme="dark"\]\s+\.radar-rep-row/);
  assert.match(content, /#madar-app\[data-theme="dark"\]\s+\.qa-visit-card/);
  assert.match(content, /#madar-app\[data-theme="dark"\]\s+\.radar-route-controls\s+select/);
  assert.match(content, /#madar-app\[data-theme="dark"\]\s+\.heatmap-metric-card/);
  assert.match(content, /#madar-app\[data-theme="dark"\]\s+\.radar-stops-list\s+>\s+span\.heatmap-active-stop/);

  // High contrast Leaflet popup styling
  assert.match(content, /\.radar-machine-popup\s*\{[^}]*color:\s*#f1f5f9/s);
});

test('supervisor-radar.css normalizes location-reviews-panel to shared design tokens', () => {
  const content = readFileSync(supervisorCssPath, 'utf8');

  // Must not have hardcoded pitch-black #152232 background in base rule
  assert.doesNotMatch(
    content,
    /\.location-reviews-panel\s*\{[^}]*background:\s*#152232/s,
    'location-reviews-panel must not be hardcoded to pitch-black #152232 in light mode'
  );

  // Must use CSS custom properties for surfaces and borders
  assert.match(content, /\.location-reviews-panel\s*\{[^}]*var\(--madar-surface\)/s);
  assert.match(content, /\.location-reviews-panel\s*\{[^}]*var\(--madar-border\)/s);
});

test('supervisor-radar.css eliminates double padding on supervisor-page', () => {
  const content = readFileSync(supervisorCssPath, 'utf8');

  // Base rule for .supervisor-page must have padding: 0
  assert.match(content, /#madar-app\s+\.supervisor-page\s*\{[^}]*padding:\s*0;/s);
  assert.doesNotMatch(content, /#madar-app\s+\.supervisor-page\s*\{[^}]*padding:\s*clamp/s);
});

test('rep.css rebinds palette variables and harmonizes button border radii', () => {
  const content = readFileSync(repCssPath, 'utf8');

  // Rebind to shared tokens
  assert.match(content, /--rep-green:\s*var\(--madar-accent/);
  assert.match(content, /--rep-green-dark:\s*var\(--madar-accent-strong/);
  assert.match(content, /--rep-green-pale:\s*var\(--madar-accent-pale/);

  // Button radius uses token scale
  assert.match(content, /\.rep-button\s*\{[^}]*border-radius:\s*var\(--madar-radius-md/s);
});
