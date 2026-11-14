import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = path => fs.readFileSync(path, 'utf8');
const migrations = [
  'supabase/migrations/20261114120000_answer_search_v2_diagnostics_queue_audit.sql',
  'supabase/migrations/20261114121000_answer_search_scheduler.sql',
  'supabase/migrations/20261114122000_admin_role_permissions.sql',
  'supabase/migrations/20261114123000_answer_search_global_rate_limit.sql',
  'supabase/migrations/20261114124000_answer_link_health_fields.sql',
  'supabase/migrations/20261114125000_answer_candidate_match_scoring.sql',
].map(read);
const combinedSql = migrations.join('\n').toLowerCase();

for (const migration of migrations) {
  assert.doesNotMatch(migration, /\bdrop\s+table\b/i, 'V2 migrations must not drop tables');
  assert.doesNotMatch(migration, /\btruncate\b/i, 'V2 migrations must not truncate data');
  assert.doesNotMatch(migration, /\bdrop\s+column\b/i, 'V2 migrations must not drop columns');
}
assert.doesNotMatch(combinedSql, /delete\s+from\s+public\.(books|answer_links|answer_link_candidates|user_submissions|admin_users|site_pages)\b/, 'Existing catalog, link, request and admin data must not be deleted');
assert.match(combinedSql, /answer_link_candidates_run_id_fkey[\s\S]*?on delete set null/i, 'Candidate review rows must survive 30-day run cleanup');
assert.match(combinedSql, /create table if not exists public\.answer_link_search_attempts/i);
assert.match(combinedSql, /create table if not exists public\.answer_link_search_queue/i);
assert.match(combinedSql, /create table if not exists public\.admin_audit_events/i);
assert.match(combinedSql, /create table if not exists public\.admin_access_events/i);
assert.match(combinedSql, /create table if not exists public\.admin_user_roles/i);
assert.match(combinedSql, /create or replace function public\.has_admin_permission/i);
assert.match(combinedSql, /reserve_answer_search_request/i);
assert.match(combinedSql, /history-retention/i);
assert.match(combinedSql, /answer-link-health-check/i);

const searchFunction = read('supabase/functions/answer-link-search/index.ts');
assert.match(searchFunction, /answer_link_search_attempts/);
assert.match(searchFunction, /reserve_answer_search_request/);
assert.match(searchFunction, /scheduled_start/);
assert.match(searchFunction, /scheduled_queue_start/);
assert.match(searchFunction, /match_score/);
assert.match(searchFunction, /retryLimit/);
assert.match(searchFunction, /answer_link_search_queue/);

const healthFunction = read('supabase/functions/answer-link-health-check/index.ts');
assert.match(healthFunction, /redirect:\s*'manual'/);
assert.match(healthFunction, /safeExternalUrl/);
assert.match(healthFunction, /%PDF-/);
assert.match(healthFunction, /answer_link_search_queue/);

const app = read('src/App.tsx');
for (const route of ['/admin/search-history', '/admin/roles', '/admin/activity', '/admin/search-settings']) {
  assert.ok(app.includes(route), 'Missing route: ' + route);
}
const searchPage = read('src/app/pages/adminLinkSearch.tsx');
for (const action of ['start', 'batch', 'pause', 'resume', 'retry']) {
  assert.ok(searchPage.includes("action: '" + action + "'"), 'Missing search action: ' + action);
}
assert.match(searchPage, /43584387790/, 'Windows local app download must link to the verified artifact run');
assert.match(read('src/app/pages/adminSearchHistory.tsx'), /downloadXlsx/);
assert.match(read('src/app/pages/adminRoles.tsx'), /admin_assign_role/);
assert.match(read('src/app/pages/adminActivity.tsx'), /admin_list_activity_events/);
assert.match(read('src/app/pages/adminSearchSettings.tsx'), /requests_per_minute/);
assert.ok(fs.existsSync('supabase/functions/answer-link-import-candidates/index.ts'), 'Existing local candidate import function must remain');

console.log('Admin V2 static contract checks passed.');
