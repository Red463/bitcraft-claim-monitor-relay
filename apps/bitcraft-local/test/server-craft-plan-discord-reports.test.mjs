import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCraftPlanDiscordReport,
  buildCraftPlanDiscordEmbed,
  buildUnavailableCraftPlanDiscordReport,
  craftPlanReportOccurrence,
  dueCraftPlanReportOccurrence,
  discordCraftPlanCommandAllowed,
  validateCraftPlanReportSettings,
  normalizeCraftPlanReportRule,
  nextCraftPlanReportOccurrenceIso,
} from "../src/server/craftPlanDiscordReports.mjs";

const materials = [
  { name: "Rough Wood Log", section: "Forestry", required: 100, available: 40, inProgress: 10, missing: 50 },
  { name: "Fine Wood Log", section: "Forestry", required: 20, available: 20, inProgress: 0, missing: 0, hasRecipeUsages: true },
  { name: "Simple Plank", section: "Carpentry", required: 50, available: 10, inProgress: 5, missing: 35 },
  { name: "Thread", section: "Tailor", sectionOverride: "Tailoring", required: 10, available: 0, inProgress: 0, missing: 10 },
];

function makeEffortProgress({ overall, ...sections }) {
  const mapped = Object.fromEntries(Object.entries(sections).map(([name, completion]) => [name, {
    state: "ready", baselineEffort: 100, remainingEffort: 100 - completion, completion,
  }]));
  const overallAggregate = { state: "ready", baselineEffort: 100, remainingEffort: 100 - overall, completion: overall };
  return {
    state: "ready",
    overall: overallAggregate,
    sections: mapped,
    fishingVariants: Object.prototype.hasOwnProperty.call(mapped, "Fishing")
      ? { ocean: { route: "ocean", overall: overallAggregate, sections: mapped } }
      : {},
    warnings: [],
  };
}

function withEffort(plan) {
  const rows = Array.isArray(plan.materials) ? plan.materials : [];
  const canonicalSection = (item) => item.tag === "Wood Log"
    ? "Forestry"
    : item.sectionOverride || (item.section === "Tailor" ? "Tailoring" : item.section);
  const completion = (entries) => {
    const required = entries.reduce((sum, item) => sum + Math.max(0, Number(item.required) || 0), 0);
    const covered = entries.reduce((sum, item) => {
      const estimated = Math.max(0, Number(item.estimatedInProgress) || 0);
      const guaranteed = item.guaranteedInProgress != null
        ? Math.max(0, Number(item.guaranteedInProgress) || 0)
        : estimated > 0 ? 0 : Math.max(0, Number(item.inProgress) || 0);
      return sum + Math.min(Math.max(0, Number(item.required) || 0), Math.max(0, Number(item.available) || 0) + guaranteed);
    }, 0);
    return required > 0 ? Math.round((covered / required) * 1000) / 10 : 100;
  };
  const grouped = Map.groupBy(rows, canonicalSection);
  const sections = Object.fromEntries([...grouped].filter(([name]) => name).map(([name, entries]) => [name, completion(entries)]));
  return { ...plan, effortProgress: makeEffortProgress({ overall: completion(rows), ...sections }) };
}

test("Discord overview uses server effort progress", () => {
  const report = buildCraftPlanDiscordReport({
    enabled: true,
    targets: [{}],
    materials,
    effortProgress: makeEffortProgress({ overall: 72.5, Fishing: 57.2, Forestry: 100, Carpentry: 60, Tailoring: 50 }),
  });
  assert.equal(report.overall.completion, 72.5);
  assert.equal(report.professions.find((row) => row.name === "Forestry").completion, 100);
  assert.equal(report.fishingRoute, "ocean");
});

test("Discord identifies current partial coverage and groups missing sources without implying a stale calculation", () => {
  const report = buildCraftPlanDiscordReport({
    enabled: true, targets: [{}], materials,
    effortProgress: {
      ...makeEffortProgress({ overall: 35, Forestry: 35, Carpentry: 35, Tailoring: 35 }),
      sourceCoverageIncomplete: true,
      unavailableSources: [{ label: "Mosswick bank" }, { label: "Mosswick bank" }, { label: "Modular deployable" }],
    },
  });
  const description = buildCraftPlanDiscordEmbed(report).embeds[0].description;
  assert.equal(report.overall.completion, 35);
  assert.equal(report.sourceCoverageIncomplete, true);
  assert.match(description, /partial coverage/i);
  assert.match(description, /Mosswick bank \(2\)/);
  assert.match(description, /review.*source/i);
  assert.doesNotMatch(description, /waiting for|last complete calculation/i);
});

test("Discord reports lead with confirmed progress and explain projected, stale, and baseline states", () => {
  const confirmed = makeEffortProgress({ overall: 72.5, Forestry: 70, Carpentry: 60, Tailoring: 50 });
  const projected = makeEffortProgress({ overall: 78.5, Forestry: 76, Carpentry: 64, Tailoring: 55 });
  const report = buildCraftPlanDiscordReport({
    enabled: true,
    targets: [{}],
    materials,
    effortProgress: {
      ...confirmed,
      confirmed,
      projected,
      stale: true,
      lastSuccessfulAt: "2026-07-24T08:00:00.000Z",
      unavailableSources: [{ label: "Mosswick storage" }],
      baselineChange: { reasons: ["Selected routes changed"], changedAt: "2026-07-24T07:00:00.000Z" },
    },
  });

  assert.equal(report.overall.completion, 72.5);
  assert.equal(report.overall.projectedCompletion, 78.5);
  assert.equal(report.stale, true);
  assert.deepEqual(report.unavailableSources, ["Mosswick storage"]);
  assert.deepEqual(report.baselineChange.reasons, ["Selected routes changed"]);
  const description = buildCraftPlanDiscordEmbed(report).embeds[0].description;
  assert.match(description, /Confirmed progress/);
  assert.match(description, /Projected after active crafts/);
  assert.match(description, /last complete calculation/i);
  assert.match(description, /Selected routes changed/);
});

test("Discord coverage counts use the confirmed-only material plan", () => {
  const report = buildCraftPlanDiscordReport({
    enabled: true,
    targets: [{}],
    materials: [{
      key: "items:1", name: "Ink", section: "Scholar", required: 100, available: 20,
      guaranteedInProgress: 10, estimatedInProgress: 40, missing: 30, hasRecipeUsages: true,
    }],
    confirmedEffortPlan: {
      materials: [{
        key: "items:1", name: "Ink", section: "Scholar", required: 140, available: 20,
        guaranteedInProgress: 10, estimatedInProgress: 0, missing: 110, hasRecipeUsages: true,
      }],
    },
    effortProgress: makeEffortProgress({ overall: 25, Scholar: 25 }),
  });

  assert.equal(report.overall.required, 140);
  assert.equal(report.overall.covered, 30);
  assert.equal(report.overall.estimatedCraftOutput, 40);
  assert.equal(report.shortages[0].missing, 30);
});

test("Discord uses Relay-neutral guidance when effort is unavailable", () => {
  const report = buildCraftPlanDiscordReport({
    enabled: true,
    targets: [{}],
    materials,
  });
  assert.equal(report.state, "unavailable");
  assert.equal(report.message, "Effort progress is unavailable until compatible Relay catalog data is ready.");
  assert.doesNotMatch(report.message, /refresh|full catalog run|scheduled/i);
  assert.equal(report.overall, undefined);
});

test("Discord labels estimated active output as excluded", () => {
  const estimatedMaterials = materials.map((item, index) => index === 0
    ? { ...item, guaranteedInProgress: 0, estimatedInProgress: 10 }
    : item);
  const report = buildCraftPlanDiscordReport({
    enabled: true,
    targets: [{}],
    materials: estimatedMaterials,
    effortProgress: makeEffortProgress({ overall: 72.5, Forestry: 70, Carpentry: 60, Tailoring: 50 }),
  });
  assert.match(JSON.stringify(buildCraftPlanDiscordEmbed(report)), /shown but not counted toward progress/i);
});

test("craft planner Discord overview reports weighted progress and largest shortages", () => {
  const report = buildCraftPlanDiscordReport(withEffort({ enabled: true, materials, targets: [{ name: "Township" }], totals: { calculatedAt: "2026-07-13T12:00:00.000Z" } }));

  assert.equal(report.state, "ready");
  assert.deepEqual(report.overall, { required: 180, covered: 85, completion: 47.2, completedItems: 1, totalItems: 4 });
  assert.deepEqual(report.professions.map(({ name, completion, completedItems, totalItems }) => [name, completion, completedItems, totalItems]), [
    ["Carpentry", 30, 0, 1],
    ["Forestry", 58.3, 1, 2],
    ["Tailoring", 0, 0, 1],
  ]);
  assert.deepEqual(report.shortages.map(({ name, missing }) => [name, missing]), [
    ["Rough Wood Log", 50],
    ["Simple Plank", 35],
    ["Thread", 10],
  ]);
});

test("craft planner Discord profession reports use canonical taxonomy and ten-item limit", () => {
  const extra = Array.from({ length: 12 }, (_, index) => ({
    name: `Cloth ${index + 1}`,
    section: "Tailor",
    required: index + 1,
    available: 0,
    missing: index + 1,
  }));
  const report = buildCraftPlanDiscordReport(withEffort({ enabled: true, materials: extra, targets: [{}] }), "tailoring");

  assert.equal(report.title, "Tailoring Progress");
  assert.equal(report.shortages.length, 10);
  assert.equal(report.shortages[0].name, "Cloth 12");
  assert.equal(report.shortages[9].name, "Cloth 3");
});

test("craft planner Discord reports use the same gathered-input taxonomy as the Needs Board", () => {
  const report = buildCraftPlanDiscordReport(withEffort({
    enabled: true,
    targets: [{}],
    materials: [{ name: "Rough Wood Log", tag: "Wood Log", section: "Carpentry", required: 100, available: 25, missing: 75, recipeUsages: [{}] }],
  }), "forestry");

  assert.equal(report.profession, "Forestry");
  assert.deepEqual(report.overall, { required: 100, covered: 25, completion: 25, completedItems: 0, totalItems: 1 });
  assert.equal(report.shortages[0].name, "Rough Wood Log");
});

test("Discord resolves legacy Leatherwork effort as Leatherworking progress", () => {
  const leather = [{
    name: "Basic Leather",
    tag: "Leather",
    section: "Carpentry",
    required: 100,
    available: 50,
    missing: 50,
    hasRecipeUsages: true,
  }];
  const report = buildCraftPlanDiscordReport({
    enabled: true,
    targets: [{}],
    materials: leather,
    effortProgress: makeEffortProgress({ overall: 50, Leatherwork: 50 }),
  });

  assert.equal(report.state, "ready");
  assert.deepEqual(report.professions.map(({ name, completion }) => [name, completion]), [["Leatherworking", 50]]);
});

test("Discord profession grouping respects explicit Needs Board section overrides", () => {
  const report = buildCraftPlanDiscordReport({
    enabled: true,
    targets: [{}],
    materials: [{
      name: "Rough Wood Log",
      tag: "Wood Log",
      section: "Forestry",
      sectionOverride: "Farming",
      required: 100,
      available: 25,
      missing: 75,
      hasRecipeUsages: true,
    }],
    effortProgress: makeEffortProgress({ overall: 25, Farming: 25 }),
  });

  assert.deepEqual(report.professions.map(({ name, completion }) => [name, completion]), [["Farming", 25]]);
});

test("Discord reports become unavailable instead of showing false zero profession effort", () => {
  const report = buildCraftPlanDiscordReport({
    enabled: true,
    targets: [{}],
    materials: [{ name: "Basic Leather", tag: "Leather", required: 10, available: 5, missing: 5, hasRecipeUsages: true }],
    effortProgress: makeEffortProgress({ overall: 50, Carpentry: 50 }),
  });

  assert.equal(report.state, "unavailable");
  assert.equal(report.overall, undefined);
});

test("Craft Planner Discord titles include the configured plan name", () => {
  const plan = withEffort({
    enabled: true,
    config: { name: "  T6 Push  " },
    materials,
    targets: [{}],
  });

  assert.equal(buildCraftPlanDiscordReport(plan).title, "T6 Push - Crafting Progress");
  assert.equal(buildCraftPlanDiscordReport(plan, "forestry").title, "T6 Push - Forestry Progress");
  assert.equal(buildCraftPlanDiscordReport(plan, "leatherworking").title, "T6 Push - Leatherworking Progress");
  assert.equal(buildCraftPlanDiscordReport({ enabled: false, config: { name: "T6 Push" } }).title, "T6 Push - Crafting Progress");
});

test("craft planner Discord reports ignore legacy planned output coverage", () => {
  const report = buildCraftPlanDiscordReport(withEffort({
    enabled: true,
    targets: [{}],
    materials: [{ name: "Sturdy Gypsite", tag: "Gypsite", tier: 3, section: "Foraging", required: 78, available: 0, inProgress: 0, plannedOutput: 25.52, missing: 78, recipeUsages: [{}] }],
  }));

  assert.deepEqual(report.overall, { required: 78, covered: 0, completion: 0, completedItems: 0, totalItems: 1 });
});

test("craft planner Discord reports disclose estimated active craft coverage", () => {
  const report = buildCraftPlanDiscordReport(withEffort({
    enabled: true,
    targets: [{}],
    materials: [{
      name: "Straw",
      section: "Farming",
      required: 10,
      available: 2,
      inProgress: 3,
      guaranteedInProgress: 1,
      estimatedInProgress: 2,
      missing: 5,
      recipeUsages: [{}],
    }],
  }));

  assert.deepEqual(report.overall, { required: 10, covered: 3, completion: 30, completedItems: 0, totalItems: 1, estimatedCraftOutput: 2 });
  const payload = buildCraftPlanDiscordEmbed(report);
  assert.match(payload.embeds[0].description, /2 estimated active-craft items are shown but not counted toward progress\./);
});

test("craft planner Discord reports expose disabled, empty, complete, and unknown profession states", () => {
  assert.equal(buildCraftPlanDiscordReport({ enabled: false }).state, "disabled");
  assert.equal(buildCraftPlanDiscordReport({ enabled: true, materials: [], targets: [] }).state, "empty");
  assert.equal(buildCraftPlanDiscordReport(withEffort({ enabled: true, materials: [{ name: "Log", section: "Forestry", required: 10, available: 10, missing: 0, hasRecipeUsages: true }], targets: [{}] })).state, "complete");
  assert.equal(buildCraftPlanDiscordReport({ enabled: true, materials, targets: [{}] }, "alchemy").state, "unknown_profession");
});

test("craft planner report rules normalize safe daily and weekly schedules", () => {
  assert.deepEqual(normalizeCraftPlanReportRule({
    id: " morning ", enabled: true, reportType: "PROFESSION", profession: "Tailor", channelId: " 123 ", frequency: "weekly", time: "08:30", dayOfWeek: 8,
  }), {
    id: "morning",
    enabled: true,
    reportType: "profession",
    profession: "tailoring",
    channelId: "123",
    frequency: "weekly",
    time: "08:30",
    dayOfWeek: 6,
  });
});

test("craft planner occurrences honor Europe/London daily time across daylight saving", () => {
  const rule = normalizeCraftPlanReportRule({ id: "daily", enabled: true, reportType: "overview", channelId: "123", frequency: "daily", time: "09:00" });
  assert.deepEqual(craftPlanReportOccurrence(rule, "Europe/London", new Date("2026-01-13T09:00:30.000Z")), { key: "2026-01-13@09:00", due: true });
  assert.deepEqual(craftPlanReportOccurrence(rule, "Europe/London", new Date("2026-07-13T08:00:30.000Z")), { key: "2026-07-13@09:00", due: true });
  assert.equal(craftPlanReportOccurrence(rule, "Europe/London", new Date("2026-07-13T09:00:30.000Z")).due, false);
});

test("weekly craft planner occurrences require the configured local weekday", () => {
  const rule = normalizeCraftPlanReportRule({ id: "weekly", enabled: true, reportType: "overview", channelId: "123", frequency: "weekly", time: "09:00", dayOfWeek: 1 });
  assert.equal(craftPlanReportOccurrence(rule, "Europe/London", new Date("2026-07-13T08:00:10.000Z")).due, true);
  assert.equal(craftPlanReportOccurrence(rule, "Europe/London", new Date("2026-07-14T08:00:10.000Z")).due, false);
});

test("next Craft Planner report occurrence is returned as an absolute instant", () => {
  const rule = normalizeCraftPlanReportRule({ id: "daily", enabled: true, reportType: "overview", channelId: "123", frequency: "daily", time: "09:00" });
  assert.equal(nextCraftPlanReportOccurrenceIso(rule, "Europe/London", new Date("2026-07-13T08:00:30.000Z")), "2026-07-14T08:00:00.000Z");
});

test("due Craft Planner occurrence catches a schedule missed during a worker restart", () => {
  const rule = normalizeCraftPlanReportRule({ id: "daily", enabled: true, reportType: "overview", channelId: "123456789012345678", frequency: "daily", time: "09:00" });
  assert.deepEqual(
    dueCraftPlanReportOccurrence(rule, "Europe/London", new Date("2026-07-13T08:17:00.000Z"), new Date("2026-07-13T07:45:00.000Z")),
    { key: "2026-07-13@09:00", due: true, scheduledAt: "2026-07-13T08:00:00.000Z" },
  );
});

test("unavailable Craft Planner reports expose a bounded non-sensitive state", () => {
  const report = buildUnavailableCraftPlanDiscordReport(new Error("fetch https://api.example.test?token=secret failed"));
  assert.equal(report.state, "unavailable");
  assert.equal(report.message, "Craft Planner data is temporarily unavailable. Please try again shortly.");
  assert.doesNotMatch(JSON.stringify(report), /secret|token=/i);
});

test("craft planner Discord embeds stay bounded and suppress mentions", () => {
  const report = buildCraftPlanDiscordReport(withEffort({ enabled: true, materials, targets: [{}], calculatedAt: "2026-07-13T12:00:00.000Z" }));
  const payload = buildCraftPlanDiscordEmbed(report, { dashboardUrl: "https://app.timbersteeltrade.com/?page=planning" });

  assert.equal(payload.allowed_mentions.parse.length, 0);
  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.embeds[0].title, "Crafting Progress");
  assert.match(payload.embeds[0].description, /47\.2%/);
  assert.match(payload.embeds[0].description, /85 of 180 units covered/);
  assert.match(payload.embeds[0].description, /1 of 4 requirements complete/);
  assert.match(payload.embeds[0].description, /Open Craft Planner/);
  const professionFields = payload.embeds[0].fields.filter((field) => field.inline);
  assert.deepEqual(professionFields.map((field) => field.name), ["Carpentry", "Forestry", "Tailoring"]);
  assert.match(professionFields[0].value, /30\.0%[\s\S]*0\/1 requirements/);
  assert.match(professionFields[1].value, /58\.3%[\s\S]*1\/2 requirements/);
  const shortages = payload.embeds[0].fields.find((field) => field.name === "Most needed");
  assert.equal(shortages.inline, false);
  assert.match(shortages.value, /Rough Wood Log.*50/);
  assert.ok(JSON.stringify(payload).length < 6000);
});

test("profession Craft Planner embeds keep one focused summary without the overview grid", () => {
  const report = buildCraftPlanDiscordReport(withEffort({ enabled: true, materials, targets: [{}] }), "forestry");
  const payload = buildCraftPlanDiscordEmbed(report);
  const embed = payload.embeds[0];

  assert.equal(embed.title, "Forestry Progress");
  assert.match(embed.description, /58\.3%/);
  assert.match(embed.description, /1 of 2 requirements complete/);
  assert.equal(embed.fields.some((field) => field.inline), false);
  assert.equal(embed.fields[0].name, "Most needed");
  assert.match(embed.fields[0].value, /Rough Wood Log/);
});

test("craft planner command allows the configured role or Discord administrators", () => {
  assert.equal(discordCraftPlanCommandAllowed({ roles: ["role-1"], permissions: "0" }, "role-1"), true);
  assert.equal(discordCraftPlanCommandAllowed({ roles: [], permissions: "8" }, "role-1"), true);
  assert.equal(discordCraftPlanCommandAllowed({ roles: [], permissions: "0" }, "role-1"), false);
  assert.equal(discordCraftPlanCommandAllowed({ roles: [], permissions: "0" }, ""), false);
});

test("craft planner report validation rejects unsafe enabled rules", () => {
  const errors = validateCraftPlanReportSettings({
    timezone: "Not/AZone",
    rules: [
      { id: "same", enabled: true, reportType: "profession", profession: "Unknown", channelId: "", frequency: "daily", time: "99:00" },
      { id: "same", enabled: true, reportType: "overview", channelId: "not-a-channel", frequency: "monthly", time: "09:00" },
    ],
  });
  assert.deepEqual(errors, [
    "Choose a valid IANA timezone.",
    "Report 1 needs a valid profession.",
    "Report 1 needs a Discord channel.",
    "Report 1 needs a valid time.",
    "Report rule IDs must be unique.",
    "Report 2 needs a valid Discord channel.",
    "Report 2 needs a daily or weekly frequency.",
  ]);
});
