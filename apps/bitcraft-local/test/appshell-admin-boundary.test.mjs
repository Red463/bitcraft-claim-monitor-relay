import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("AppShell delegates admin console rendering to a focused admin component", () => {
  const appShell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");
  const adminPanelUrl = new URL("../src/components/admin/AdminPanel.tsx", import.meta.url);

  assert.equal(existsSync(adminPanelUrl), true, "AdminPanel component should exist");
  const adminPanel = readFileSync(adminPanelUrl, "utf8");

  assert.match(appShell, /lazyRoute\(\(\) => import\("\.\/components\/admin\/AdminPanel"\)/);
  assert.doesNotMatch(appShell, /function AdminPanel\b/);
  assert.doesNotMatch(appShell, /type AdminTab\b/);
  assert.match(adminPanel, /export function AdminPanel\b/);
  assert.match(adminPanel, /type AdminPanelProps = \{/);
});

test("AdminPanel groups admin tabs by operational purpose", () => {
  const adminPanel = readFileSync(new URL("../src/components/admin/AdminPanel.tsx", import.meta.url), "utf8");
  const navigation = readFileSync(new URL("../src/components/admin/AdminSectionNavigation.tsx", import.meta.url), "utf8");

  assert.match(adminPanel, /const ADMIN_TAB_GROUPS\s*:/);
  assert.match(adminPanel, /Operations/);
  assert.match(adminPanel, /Insights/);
  assert.match(adminPanel, /Access/);
  assert.match(adminPanel, /Maintenance/);
  assert.match(navigation, /admin-tab-group/);
});

test("authenticated admin route uses focused chrome and distinct identities", () => {
  const appShell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");
  const adminPanel = readFileSync(new URL("../src/components/admin/AdminPanel.tsx", import.meta.url), "utf8");
  const headerUrl = new URL("../src/components/admin/AdminShellHeader.tsx", import.meta.url);
  const navigationUrl = new URL("../src/components/admin/AdminSectionNavigation.tsx", import.meta.url);

  assert.equal(existsSync(headerUrl), true);
  assert.equal(existsSync(navigationUrl), true);
  assert.match(appShell, /admin-focused-shell/);
  assert.match(appShell, /active !== "admin"/);
  assert.match(adminPanel, /<AdminShellHeader\b/);
  assert.match(adminPanel, /<AdminSectionNavigation\b/);
  assert.match(readFileSync(headerUrl, "utf8"), /Admin session:/);
  assert.match(readFileSync(headerUrl, "utf8"), /Public account:/);
  assert.match(readFileSync(headerUrl, "utf8"), /Return to app/);
});
test("AdminPanel keeps sensitive admin controls explicit", () => {
  const adminPanel = readFileSync(new URL("../src/components/admin/AdminPanel.tsx", import.meta.url), "utf8");
  const accessUrl = new URL("../src/components/admin/AdminAccessSection.tsx", import.meta.url);
  const analyticsUrl = new URL("../src/components/admin/AdminAnalyticsSection.tsx", import.meta.url);
  const dataUrl = new URL("../src/components/admin/AdminDataSection.tsx", import.meta.url);
  const access = existsSync(accessUrl) ? readFileSync(accessUrl, "utf8") : "";
  const analytics = existsSync(analyticsUrl) ? readFileSync(analyticsUrl, "utf8") : "";
  const data = existsSync(dataUrl) ? readFileSync(dataUrl, "utf8") : "";

  assert.match(analytics, /Delete all opt-in usage analytics records/);
  assert.match(adminPanel, /Start this background job now without changing its saved schedule/);
  assert.match(adminPanel, /Save this job schedule\. It does not run the job immediately/);
  assert.match(access, /Create an admin allow-list entry/);
  assert.match(access, /Sign this administrator out of all active sessions/);
  assert.match(data, /Create a downloadable SQLite backup/);
  assert.match(access, /No administrator accounts are configured yet/);
  assert.match(analytics, /No administrator actions have been recorded yet/);
  assert.match(data, /No database backups have been created yet/);
});
test("Linked Accounts uses typed in-app confirmation for administrator-assisted privacy deletion", () => {
  const adminPanel = readFileSync(new URL("../src/components/admin/AdminPanel.tsx", import.meta.url), "utf8");
  const access = readFileSync(new URL("../src/components/admin/AdminAccessSection.tsx", import.meta.url), "utf8");
  const adminCss = readFileSync(new URL("../src/styles/admin.css", import.meta.url), "utf8");

  assert.match(adminPanel, /\/admin\/user-accounts\/privacy/);
  assert.match(adminPanel, /allowedDiscordIds\.filter\(\(discordId\) => discordId !== account\.discordId\)/);
  assert.match(access, /privacyDeletionConfirmation !== "DELETE"/);
  assert.match(access, /separate administrator identity/);
  assert.match(access, /Discord server membership/);
  assert.match(access, /<Dialog[\s\S]*className="admin-modal account-privacy-deletion-dialog"[\s\S]*backdropClassName="admin-modal-backdrop"/);
  assert.doesNotMatch(access, /window\.confirm/);
  assert.match(adminCss, /\.account-privacy-deletion-dialog\s*\{[^}]*max-height:\s*calc\(100vh - 36px\)/);
});
test("Admin diagnostics stay bounded", () => {
  const adminCss = readFileSync(new URL("../src/styles/admin.css", import.meta.url), "utf8");

  assert.match(adminCss, /\.map-url-diagnostics code \{/);
  assert.match(adminCss, /max-height:\s*150px/);
  assert.match(adminCss, /overflow-wrap:\s*anywhere/);
  assert.match(adminCss, /\.map-url-log-list \{/);
  assert.match(adminCss, /max-height:\s*220px/);
});
test("Admin console uses compact navigation and bounded audit tools", () => {
  const adminPanel = readFileSync(new URL("../src/components/admin/AdminPanel.tsx", import.meta.url), "utf8");
  const navigation = readFileSync(new URL("../src/components/admin/AdminSectionNavigation.tsx", import.meta.url), "utf8");
  const analyticsUrl = new URL("../src/components/admin/AdminAnalyticsSection.tsx", import.meta.url);
  const analytics = existsSync(analyticsUrl) ? readFileSync(analyticsUrl, "utf8") : "";
  const adminCss = readFileSync(new URL("../src/styles/admin.css", import.meta.url), "utf8");

  assert.match(navigation, /admin-section-tabs/);
  assert.match(navigation, /admin-tab-overview/);
  assert.match(adminCss, /admin-nav-divider/);
  assert.match(analytics, /onAuditFilterChange/);
  assert.match(analytics, /filteredAuditLog/);
  assert.match(analytics, /data\.auditData\.auditLog\.length > data\.auditVisibleCount/);
  assert.match(analytics, /Load more actions/);
  assert.match(adminCss, /\.admin-tab-groups\s*\{[\s\S]*display:\s*flex/);
  assert.doesNotMatch(adminCss, /\.admin-section-tabs\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(adminCss, /\.audit-table/);
});

test("Admin diagnostics exposes support-oriented health tools", () => {
  const adminPanel = readFileSync(new URL("../src/components/admin/AdminPanel.tsx", import.meta.url), "utf8");

  assert.match(adminPanel, /Support snapshot/);
  assert.match(adminPanel, /Copy Support Snapshot/);
  assert.match(adminPanel, /Runtime/);
  assert.match(adminPanel, /Public popup count/);
  assert.match(adminPanel, /Local API health/);
});

test("App popup admin uses a compact list and modal editor", () => {
  const popupsSection = readFileSync(new URL("../src/components/admin/AdminPopupsSection.tsx", import.meta.url), "utf8");
  const adminCss = readFileSync(new URL("../src/styles/admin.css", import.meta.url), "utf8");

  assert.match(popupsSection, /popupEditorOpen/);
  assert.match(popupsSection, /openPopupEditor/);
  assert.match(popupsSection, /Save Popup/);
  assert.match(popupsSection, /import \{ Dialog \} from "\.\.\/main\/Dialog";/);
  assert.match(popupsSection, /<Dialog[\s\S]*className="admin-modal"[\s\S]*backdropClassName="admin-modal-backdrop"/);
  assert.match(popupsSection, /admin-modal-backdrop/);
  assert.match(popupsSection, /popup-admin-table/);
  assert.doesNotMatch(popupsSection, /popup-builder-grid/);
  assert.match(adminCss, /\.admin-modal-backdrop/);
  assert.match(adminCss, /\.admin-modal-backdrop\s*\{[^}]*position:\s*fixed/);
  assert.match(adminCss, /\.admin-modal-backdrop\s*\{[^}]*inset:\s*0/);
  assert.match(adminCss, /\.admin-modal-backdrop\s*\{[^}]*overflow:\s*auto/);
  assert.match(adminCss, /\.admin-modal\s*\{[^}]*max-height:\s*calc\(100vh - 36px\)/);
  assert.match(adminCss, /\.popup-admin-table/);
});
test("App popup admin table fits its card without horizontal scrolling", () => {
  const adminCss = readFileSync(new URL("../src/styles/admin.css", import.meta.url), "utf8");

  assert.doesNotMatch(adminCss, /\.popup-admin-table\s*\{[^}]*overflow-x:\s*auto/);
  assert.doesNotMatch(adminCss, /\.popup-admin-table-row\s*\{[^}]*min-width:\s*\d+px/);
  assert.match(adminCss, /\.popup-admin-table-row \.compact-toggle\s*\{[^}]*width:\s*34px/);
  assert.match(adminCss, /\.popup-admin-table-row \.compact-toggle\s*\{[^}]*min-width:\s*0/);
  assert.match(adminCss, /\.popup-admin-table-row \.compact-toggle\s*\{[^}]*max-width:\s*34px/);
  assert.match(adminCss, /\.popup-admin-table-row \.compact-toggle > span\s*\{[^}]*clip-path:\s*inset\(50%\)/);
  assert.match(adminCss, /\.popup-message-preview/);
});


test("App popup admin editor supports page targeting and expiry dates", () => {
  const popupsSection = readFileSync(new URL("../src/components/admin/AdminPopupsSection.tsx", import.meta.url), "utf8");

  assert.match(popupsSection, /Show on page/);
  assert.match(popupsSection, /POPUP_PAGE_OPTIONS/);
  assert.match(popupsSection, /Expiry date/);
  assert.match(popupsSection, /type="date"/);
  assert.match(popupsSection, /hasExpiry/);
});
test("Admin configuration exposes global in-app notification defaults", () => {
  const adminPanel = readFileSync(new URL("../src/components/admin/AdminPanel.tsx", import.meta.url), "utf8");

  assert.match(adminPanel, /In-app notification defaults/);
  assert.match(adminPanel, /updateToastSetting/);
  assert.match(adminPanel, /New market listings/);
  assert.match(adminPanel, /Confirmed market sales/);
  assert.match(adminPanel, /Production starts and completions/);
  assert.match(adminPanel, /"production"/);
  assert.match(adminPanel, /draft\.toastSettings\[key\]/);
});

test("Admin configuration exposes page and tab access control management", () => {
  const adminPanel = readFileSync(new URL("../src/components/admin/AdminPanel.tsx", import.meta.url), "utf8");
  const adminCss = readFileSync(new URL("../src/styles/admin.css", import.meta.url), "utf8");
  const permissions = readFileSync(new URL("../src/server/adminPermissions.mjs", import.meta.url), "utf8");

  assert.match(adminPanel, /Access Control/);
  assert.match(adminPanel, /\/admin\/access-control/);
  assert.match(adminPanel, /pageAccessTargets\(\)/);
  assert.match(adminPanel, /tabAccessTargets\(pageTarget\.page\)/);
  assert.match(adminPanel, /allowedDiscordIds/);
  assert.match(adminPanel, /ACCESS_RULE_MODES/);
  assert.match(adminCss, /\.access-control-list/);
  assert.match(permissions, /\/api\/local\/admin\/access-control/);
  assert.match(permissions, /settings\.manage/);
});
