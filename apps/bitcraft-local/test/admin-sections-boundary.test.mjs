import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const adminPanelUrl = new URL("../src/components/admin/AdminPanel.tsx", import.meta.url);
const sectionUrls = {
  access: new URL("../src/components/admin/AdminAccessSection.tsx", import.meta.url),
  analytics: new URL("../src/components/admin/AdminAnalyticsSection.tsx", import.meta.url),
  data: new URL("../src/components/admin/AdminDataSection.tsx", import.meta.url),
  empireMembership: new URL("../src/components/admin/AdminEmpireMembershipSection.tsx", import.meta.url),
};
const configurationNavUrl = new URL("../src/components/admin/AdminConfigurationNav.tsx", import.meta.url);

const sourceIfPresent = (url) => existsSync(url) ? readFileSync(url, "utf8") : "";

test("AdminPanel composes focused admin feature sections", () => {
  const adminPanel = readFileSync(adminPanelUrl, "utf8");

  for (const [name, url] of Object.entries(sectionUrls)) {
    assert.equal(existsSync(url), true, `Admin ${name} section should exist`);
  }
  assert.match(adminPanel, /import \{ AdminAccessSection \} from "\.\/AdminAccessSection";/);
  assert.match(adminPanel, /import \{ AdminAnalyticsSection \} from "\.\/AdminAnalyticsSection";/);
  assert.match(adminPanel, /import \{ AdminDataSection \} from "\.\/AdminDataSection";/);
  assert.match(adminPanel, /import \{ AdminEmpireMembershipSection \} from "\.\/AdminEmpireMembershipSection";/);
  assert.match(adminPanel, /<AdminAccessSection\b/);
  assert.match(adminPanel, /<AdminAnalyticsSection\b/);
  assert.match(adminPanel, /<AdminDataSection\b/);
  assert.match(adminPanel, /<AdminEmpireMembershipSection\b/);
});

test("AdminPanel no longer owns extracted presentation blocks", () => {
  const adminPanel = readFileSync(adminPanelUrl, "utf8");

  assert.doesNotMatch(adminPanel, /<h3>[\s\S]{0,80}Database Browser/);
  assert.doesNotMatch(adminPanel, /<h3>[\s\S]{0,80}Database Backups/);
  assert.doesNotMatch(adminPanel, /<h3>[\s\S]{0,80}Retention Maintenance/);
  assert.doesNotMatch(adminPanel, /<h3>[\s\S]{0,80}Add Discord Administrator/);
  assert.doesNotMatch(adminPanel, /<h3>[\s\S]{0,80}Administrators/);
  assert.doesNotMatch(adminPanel, /<h3>[\s\S]{0,80}Discord Linked Accounts/);
  assert.doesNotMatch(adminPanel, /<h3>[\s\S]{0,80}Usage Analytics/);
  assert.doesNotMatch(adminPanel, /<h3>[\s\S]{0,80}Visitor Security & Location/);
  assert.doesNotMatch(adminPanel, /<h3>[\s\S]{0,80}Audit Trail/);
  assert.doesNotMatch(adminPanel, /<h3>[\s\S]{0,80}Sign-in History/);
});

test("feature sections expose explicit data, pending, error, and action props", () => {
  for (const [name, url] of Object.entries(sectionUrls)) {
    const source = sourceIfPresent(url);
    assert.match(source, new RegExp(`type Admin${name[0].toUpperCase()}${name.slice(1)}SectionProps\\s*=\\s*\\{`));
    assert.match(source, /\bdata\??:/, `Admin ${name} section should receive data explicitly`);
    assert.match(source, /\bpending\??:/, `Admin ${name} section should receive pending state explicitly`);
    assert.match(source, /\berror\??:/, `Admin ${name} section should receive errors explicitly`);
    assert.match(source, /\bon[A-Z][A-Za-z]+\??:/, `Admin ${name} section should receive actions explicitly`);
  }
});

test("configuration uses a labelled responsive category navigator", () => {
  const source = sourceIfPresent(configurationNavUrl);
  assert.equal(existsSync(configurationNavUrl), true);
  assert.match(source, /aria-label="Configuration categories"/);
  assert.match(source, /Configuration category/);
  assert.match(source, /aria-current/);
  assert.match(source, /CONFIGURATION_SECTIONS\.map/);
});

test("dirty configuration navigation uses the shared in-app confirmation", () => {
  const adminPanel = readFileSync(adminPanelUrl, "utf8");
  assert.match(adminPanel, /requestDiscardSettings/);
  assert.match(adminPanel, /<ConfirmAdminActionDialog\b/);
  assert.doesNotMatch(adminPanel, /window\.confirm/);
});
