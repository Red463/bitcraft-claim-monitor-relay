import { plannerTaxonomyFor } from "../pages/craftPlanningTaxonomyData.mjs";

const professionAliases = new Map([
  ["carpentry", "Carpentry"], ["farming", "Farming"], ["fishing", "Fishing"],
  ["foraging", "Foraging"], ["forestry", "Forestry"], ["hunting", "Hunting"],
  ["leatherwork", "Leatherworking"], ["leatherworking", "Leatherworking"],
  ["masonry", "Masonry"], ["mining", "Mining"], ["scholar", "Scholar"],
  ["smithing", "Smithing"], ["tailor", "Tailoring"], ["tailoring", "Tailoring"],
  ["cooking", "Cooking"],
]);

export const craftPlanReportProfessions = [...new Set(professionAliases.values())].sort();

function number(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeCraftPlanReportProfession(value) {
  const key = String(value ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
  return professionAliases.get(key) ?? "";
}

function craftPlanReportTitle(plan = {}, profession = "") {
  const base = profession ? `${profession} Progress` : "Crafting Progress";
  const configuredName = String(plan?.config?.name ?? "").trim();
  const compatibilityName = String(plan?.name ?? "").trim();
  const planName = configuredName || compatibilityName;
  return planName ? `${planName} - ${base}` : base;
}

function effortSectionForProfession(effort = {}, profession = "") {
  const sections = effort?.sections && typeof effort.sections === "object" ? effort.sections : {};
  if (sections[profession]?.completion != null) return sections[profession];
  return Object.entries(sections).find(([name]) => normalizeCraftPlanReportProfession(name) === profession)?.[1];
}

function materialProfession(material = {}) {
  const taxonomy = plannerTaxonomyFor(material);
  if (taxonomy.hidden) return "";
  const sectionOverride = String(material.sectionOverride ?? "").trim();
  return normalizeCraftPlanReportProfession(sectionOverride || taxonomy.section || material.section || material.profession || "");
}

function summarize(materials) {
  const required = materials.reduce((sum, item) => sum + Math.max(0, number(item.bufferedRequired ?? item.required)), 0);
  const covered = materials.reduce((sum, item) => {
    const itemRequired = Math.max(0, number(item.bufferedRequired ?? item.required));
    const estimated = Math.max(0, number(item.estimatedInProgress));
    const guaranteed = item.guaranteedInProgress != null
      ? Math.max(0, number(item.guaranteedInProgress))
      : estimated > 0 ? 0 : Math.max(0, number(item.inProgress));
    return sum + Math.min(itemRequired, Math.max(0, number(item.available) + guaranteed));
  }, 0);
  const completedItems = materials.filter((item) => {
    const itemRequired = Math.max(0, number(item.bufferedRequired ?? item.required));
    const estimated = Math.max(0, number(item.estimatedInProgress));
    const guaranteed = item.guaranteedInProgress != null
      ? Math.max(0, number(item.guaranteedInProgress))
      : estimated > 0 ? 0 : Math.max(0, number(item.inProgress));
    const itemCovered = Math.max(0, number(item.available) + guaranteed);
    return itemRequired > 0 && itemCovered >= itemRequired;
  }).length;
  const estimatedCraftOutput = materials.reduce((sum, item) => {
    const itemRequired = Math.max(0, number(item.bufferedRequired ?? item.required));
    const confirmedCoverage = Math.max(0, number(item.available) + number(item.guaranteedInProgress));
    const remainingAfterConfirmed = Math.max(0, itemRequired - confirmedCoverage);
    return sum + Math.min(remainingAfterConfirmed, Math.max(0, number(item.estimatedInProgress)));
  }, 0);
  return {
    required,
    covered,
    completedItems,
    totalItems: materials.length,
    ...(estimatedCraftOutput > 0 ? { estimatedCraftOutput } : {}),
  };
}

function boundedEffortWarning(summary = {}) {
  const warning = Array.isArray(summary?.warnings)
    ? summary.warnings.find((value) => String(value).trim())
    : "";
  return String(warning || "Effort progress is unavailable until compatible Relay catalog data is ready.")
    .replaceAll("@", "@\u200b")
    .slice(0, 500);
}

function relevantMaterials(plan = {}) {
  return (Array.isArray(plan.materials) ? plan.materials : []).filter((material) => {
    if (material.isTarget) return false;
    const required = number(material.bufferedRequired ?? material.required);
    return required > 0 && (number(material.missing) > 0 || material.hasRecipeUsages || Array.isArray(material.recipeUsages));
  });
}

function reportMaterialKey(material = {}) {
  const key = String(material.key ?? "").trim();
  if (key) return key;
  const id = String(material.id ?? material.itemId ?? "").trim();
  if (!id) return "";
  const kind = String(material.kind ?? (Number(material.itemType) === 1 ? "cargo" : "items"));
  return `${kind}:${id}`;
}

export function buildCraftPlanDiscordReport(plan = {}, requestedProfession = "") {
  if (!plan.enabled) return { state: "disabled", title: craftPlanReportTitle(plan), message: "Craft Planner is disabled." };
  if (!Array.isArray(plan.targets) || plan.targets.length === 0) return { state: "empty", title: craftPlanReportTitle(plan), message: "Craft Planner has no configured targets." };
  const profession = requestedProfession ? normalizeCraftPlanReportProfession(requestedProfession) : "";
  if (requestedProfession && !profession) return { state: "unknown_profession", title: craftPlanReportTitle(plan), message: "That profession is not available." };
  const title = craftPlanReportTitle(plan, profession);

  const all = relevantMaterials(plan);
  const selected = profession ? all.filter((material) => materialProfession(material) === profession) : all;
  const hasConfirmedMaterials = Array.isArray(plan.confirmedEffortPlan?.materials);
  const confirmedMaterials = relevantMaterials({
    ...plan,
    materials: hasConfirmedMaterials ? plan.confirmedEffortPlan.materials : plan.materials,
  });
  const confirmedByKey = new Map(confirmedMaterials.map((material) => [reportMaterialKey(material), material]).filter(([key]) => key));
  const confirmedFor = (entries) => hasConfirmedMaterials
    ? entries.map((material) => confirmedByKey.get(reportMaterialKey(material)) ?? material)
    : entries;
  if (profession && selected.length === 0) return { state: "empty_profession", title, message: `${profession} has no requirements in the current plan.`, profession };

  const effortStatus = plan.effortProgress ?? {};
  const effort = effortStatus?.fishingVariants?.ocean ?? effortStatus;
  const confirmedEffort = effort?.confirmed ?? effortStatus?.confirmed ?? effort;
  const projectedEffort = effort?.projected ?? effortStatus?.projected ?? confirmedEffort;
  const overallEffort = profession ? effortSectionForProfession(confirmedEffort, profession) : confirmedEffort?.overall;
  if (!confirmedEffort || overallEffort?.completion == null) {
    return {
      state: "unavailable",
      title,
      message: boundedEffortWarning(effortStatus),
      ...(profession ? { profession } : {}),
    };
  }

  const byProfession = new Map();
  for (const material of all) {
    const name = materialProfession(material);
    if (!name) continue;
    if (!byProfession.has(name)) byProfession.set(name, []);
    byProfession.get(name).push(material);
  }
  const professionEntries = [...byProfession.entries()].filter(([name]) => !profession || name === profession);
  const unresolvedProfession = professionEntries.some(([name]) => effortSectionForProfession(confirmedEffort, name)?.completion == null);
  if (unresolvedProfession) {
    return {
      state: "unavailable",
      title,
      message: boundedEffortWarning(effortStatus),
      ...(profession ? { profession } : {}),
    };
  }
  const shortages = selected
    .map((material) => ({ name: String(material.name ?? material.label ?? material.itemName ?? "Unknown item").slice(0, 100), missing: Math.max(0, number(material.missing)), profession: materialProfession(material) }))
    .filter((item) => item.missing > 0)
    .sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name))
    .slice(0, profession ? 10 : 5);
  const projectedOverallEffort = profession ? effortSectionForProfession(projectedEffort, profession) : projectedEffort?.overall;
  const selectedSummary = summarize(selected);
  const confirmedSummary = summarize(confirmedFor(selected));
  const overall = {
    ...confirmedSummary,
    ...(selectedSummary.estimatedCraftOutput > 0 ? { estimatedCraftOutput: selectedSummary.estimatedCraftOutput } : {}),
    completion: number(overallEffort.completion),
    ...(projectedOverallEffort?.completion != null && number(projectedOverallEffort.completion) > number(overallEffort.completion)
      ? { projectedCompletion: number(projectedOverallEffort.completion) }
      : {}),
  };
  const professions = professionEntries
    .map(([name, entries]) => {
      const confirmed = effortSectionForProfession(confirmedEffort, name);
      const projected = effortSectionForProfession(projectedEffort, name);
      return {
        name,
        ...summarize(confirmedFor(entries)),
        completion: number(confirmed.completion),
        ...(projected?.completion != null && number(projected.completion) > number(confirmed.completion)
          ? { projectedCompletion: number(projected.completion) }
          : {}),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const unavailableSources = (Array.isArray(effortStatus.unavailableSources) ? effortStatus.unavailableSources : [])
    .map((source) => safeDiscordText(source?.label ?? source?.sourceId ?? "Planner source", 100))
    .filter(Boolean);

  return {
    state: shortages.length === 0 ? "complete" : "ready",
    title,
    profession,
    overall,
    professions,
    shortages,
    ...(effortStatus.stale ? {
      stale: true,
      lastSuccessfulAt: String(effortStatus.lastSuccessfulAt ?? ""),
      unavailableSources,
    } : {}),
    ...(effortStatus.sourceCoverageIncomplete ? { sourceCoverageIncomplete: true, unavailableSources } : {}),
    ...(effortStatus.baselineChange ? {
      baselineChange: {
        changedAt: String(effortStatus.baselineChange.changedAt ?? ""),
        reasons: (Array.isArray(effortStatus.baselineChange.reasons) ? effortStatus.baselineChange.reasons : [])
          .map((reason) => safeDiscordText(reason, 180))
          .filter(Boolean)
          .slice(0, 5),
      },
    } : {}),
    ...(effortSectionForProfession(confirmedEffort, "Fishing") || plan.effortProgress?.fishingVariants?.ocean ? { fishingRoute: "ocean" } : {}),
    calculatedAt: String(plan.totals?.calculatedAt ?? plan.calculatedAt ?? new Date().toISOString()),
  };
}

export function buildUnavailableCraftPlanDiscordReport() {
  return {
    state: "unavailable",
    title: "Crafting Progress",
    message: "Craft Planner data is temporarily unavailable. Please try again shortly.",
  };
}

export function validCraftPlanReportTimezone(value) {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: String(value) }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function normalizeCraftPlanReportRule(value = {}, index = 0) {
  const reportType = String(value.reportType ?? "overview").toLowerCase() === "profession" ? "profession" : "overview";
  const professionName = reportType === "profession" ? normalizeCraftPlanReportProfession(value.profession) : "";
  const frequency = String(value.frequency ?? "daily").toLowerCase() === "weekly" ? "weekly" : "daily";
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value.time ?? "")) ? String(value.time) : "09:00";
  return {
    id: String(value.id ?? `report-${index + 1}`).trim().slice(0, 64) || `report-${index + 1}`,
    enabled: value.enabled === true && (reportType === "overview" || Boolean(professionName)),
    reportType,
    profession: professionName ? professionName.toLowerCase() : "",
    channelId: String(value.channelId ?? "").trim(),
    frequency,
    time,
    dayOfWeek: Math.min(6, Math.max(0, Math.floor(number(value.dayOfWeek ?? 1)))),
  };
}

export function normalizeCraftPlanReportSettings(value = {}) {
  const timezone = validCraftPlanReportTimezone(value.timezone) ? String(value.timezone) : "Europe/London";
  const seen = new Set();
  const rules = (Array.isArray(value.rules) ? value.rules : []).slice(0, 50).map(normalizeCraftPlanReportRule).map((rule, index) => {
    let id = rule.id;
    while (seen.has(id)) id = `${rule.id}-${index + 1}`.slice(0, 64);
    seen.add(id);
    return { ...rule, id };
  });
  return {
    scheduledEnabled: value.scheduledEnabled === true,
    commandRoleId: String(value.commandRoleId ?? "").trim(),
    timezone,
    rules,
  };
}

export function validateCraftPlanReportSettings(value = {}) {
  const errors = [];
  if (!validCraftPlanReportTimezone(value.timezone ?? "Europe/London")) errors.push("Choose a valid IANA timezone.");
  const seen = new Set();
  for (const [index, rule] of (Array.isArray(value.rules) ? value.rules : []).entries()) {
    const label = `Report ${index + 1}`;
    if (rule.reportType === "profession" && !normalizeCraftPlanReportProfession(rule.profession)) errors.push(`${label} needs a valid profession.`);
    const channelId = String(rule.channelId ?? "").trim();
    if (rule.enabled === true && !channelId) errors.push(`${label} needs a Discord channel.`);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(rule.time ?? ""))) errors.push(`${label} needs a valid time.`);
    const id = String(rule.id ?? "").trim();
    if (id && seen.has(id)) errors.push("Report rule IDs must be unique.");
    seen.add(id);
    if (rule.enabled === true && channelId && !/^\d{17,20}$/.test(channelId)) errors.push(`${label} needs a valid Discord channel.`);
    if (!['daily', 'weekly'].includes(String(rule.frequency ?? ""))) errors.push(`${label} needs a daily or weekly frequency.`);
  }
  return errors;
}

export function craftPlanReportOccurrence(rule, timezone, at = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: validCraftPlanReportTimezone(timezone) ? timezone : "Europe/London",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  }).formatToParts(at).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const localTime = `${parts.hour}:${parts.minute}`;
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const dayMatches = rule.frequency !== "weekly" || weekdays[parts.weekday] === rule.dayOfWeek;
  return { key: `${date}@${rule.time}`, due: Boolean(rule.enabled && dayMatches && localTime === rule.time) };
}

export function dueCraftPlanReportOccurrence(rule, timezone, at = new Date(), since = new Date(at.getTime() - 24 * 60 * 60 * 1000)) {
  if (!rule?.enabled) return { key: "", due: false, scheduledAt: null };
  const lowerBound = Math.max(since.getTime(), at.getTime() - 24 * 60 * 60 * 1000);
  const cursor = new Date(at);
  cursor.setUTCSeconds(0, 0);
  while (cursor.getTime() >= lowerBound) {
    const occurrence = craftPlanReportOccurrence(rule, timezone, cursor);
    if (occurrence.due) return { ...occurrence, scheduledAt: cursor.toISOString() };
    cursor.setUTCMinutes(cursor.getUTCMinutes() - 1);
  }
  return { key: "", due: false, scheduledAt: null };
}

export function nextCraftPlanReportOccurrenceIso(rule, timezone, from = new Date()) {
  if (!rule?.enabled) return null;
  const targetMinute = Number(String(rule.time).split(":")[1]) || 0;
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 0, targetMinute % 15));
  const limit = (rule.frequency === "weekly" ? 9 : 3) * 24 * 4;
  for (let quarterHour = 0; quarterHour < limit; quarterHour += 1) {
    if (cursor > from && craftPlanReportOccurrence(rule, timezone, cursor).due) return cursor.toISOString();
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 15);
  }
  return null;
}

function safeDiscordText(value, max = 100) {
  return String(value ?? "").replaceAll("@", "@\u200b").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
}

function progressBar(completion, segments = 10) {
  const filled = Math.min(segments, Math.max(0, Math.round((number(completion) / 100) * segments)));
  return `${"\u2588".repeat(filled)}${"\u2591".repeat(segments - filled)}`;
}

function progressSummary(summary, segments = 10) {
  return `\`${progressBar(summary.completion, segments)}\` **${number(summary.completion).toFixed(1)}%**`;
}

export function buildCraftPlanDiscordEmbed(report = {}, { dashboardUrl = "https://app.timbersteeltrade.com/?page=planning" } = {}) {
  if (!report.overall) {
    return {
      embeds: [{ title: safeDiscordText(report.title || "Crafting Progress", 256), description: safeDiscordText(report.message || "Craft Planner data is unavailable.", 4000), color: 0xf0c64f }],
      allowed_mentions: { parse: [] },
    };
  }
  const summary = `${progressSummary(report.overall)}\nConfirmed progress from stock and guaranteed active crafts`;
  const projectedNote = number(report.overall.projectedCompletion) > number(report.overall.completion)
    ? `Projected after active crafts: ${progressSummary({ completion: report.overall.projectedCompletion })}`
    : "";
  const coverage = `${Math.round(number(report.overall.covered)).toLocaleString()} of ${Math.round(number(report.overall.required)).toLocaleString()} units covered`;
  const requirements = `${Math.round(number(report.overall.completedItems)).toLocaleString()} of ${Math.round(number(report.overall.totalItems)).toLocaleString()} requirements complete`;
  const professionFields = report.profession ? [] : (report.professions ?? []).map((entry) => ({
    name: safeDiscordText(entry.name),
    value: `${progressSummary(entry, 8)}\n${Math.round(number(entry.completedItems)).toLocaleString()}/${Math.round(number(entry.totalItems)).toLocaleString()} requirements`.slice(0, 1024),
    inline: true,
  }));
  const shortages = (report.shortages ?? []).map((item) => `\u2022 **${safeDiscordText(item.name)}** \u2014 **${Math.ceil(item.missing).toLocaleString()}** needed`);
  const estimateNote = number(report.overall.estimatedCraftOutput) > 0
    ? `*${Math.floor(number(report.overall.estimatedCraftOutput)).toLocaleString()} estimated active-craft items are shown but not counted toward progress.*`
    : "";
  const routeNote = report.fishingRoute === "ocean" ? "Fishing route: Ocean" : "";
  const staleNote = report.stale
    ? `⚠️ Showing the last complete calculation${report.lastSuccessfulAt ? ` from <t:${Math.floor(new Date(report.lastSuccessfulAt).getTime() / 1000)}:R>` : ""}${report.unavailableSources?.length ? `; waiting for ${report.unavailableSources.join(", ")}` : ""}.`
    : "";
  const missingSourceCounts = new Map();
  for (const label of report.unavailableSources ?? []) {
    missingSourceCounts.set(label, (missingSourceCounts.get(label) ?? 0) + 1);
  }
  const missingSourceSummary = [...missingSourceCounts]
    .map(([label, count]) => `${label}${count > 1 ? ` (${count})` : ""}`).join(", ");
  const partialNote = report.sourceCoverageIncomplete
    ? `⚠️ Current progress has partial coverage; missing containers are excluded${missingSourceSummary ? `: ${missingSourceSummary}` : ""}. Review the plan's source selections.`
    : "";
  const baselineNote = report.baselineChange?.reasons?.length
    ? `ℹ️ Plan baseline changed: ${report.baselineChange.reasons.join("; ")}.`
    : "";
  const description = [summary, projectedNote, coverage, requirements, routeNote, estimateNote, staleNote, partialNote, baselineNote, `\n[Open Craft Planner](${dashboardUrl})`].filter(Boolean).join("\n").slice(0, 4000);
  return {
    embeds: [{
      title: safeDiscordText(report.title || "Crafting Progress", 256),
      description,
      color: report.state === "complete" ? 0x4ee28a : 0xf0c64f,
      fields: [
        ...professionFields,
        { name: shortages.length ? "Most needed" : "Status", value: (shortages.length ? shortages.join("\n") : "All tracked requirements are covered.").slice(0, 1024), inline: false },
      ],
      timestamp: report.calculatedAt || new Date().toISOString(),
      footer: { text: "Timbersteel Trade \u00b7 Craft Planner" },
    }],
    allowed_mentions: { parse: [] },
  };
}

export function discordCraftPlanCommandAllowed(member = {}, configuredRoleId = "") {
  let permissions = 0n;
  try { permissions = BigInt(String(member.permissions ?? "0")); } catch {}
  if ((permissions & 8n) === 8n) return true;
  const roleId = String(configuredRoleId ?? "").trim();
  return Boolean(roleId && Array.isArray(member.roles) && member.roles.map(String).includes(roleId));
}
