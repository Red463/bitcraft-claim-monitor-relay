function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function positive(value) {
  return Math.max(0, number(value));
}

function text(value) {
  return String(value ?? "").trim();
}

function itemName(item) {
  return text(item?.name ?? item?.label ?? item?.id) || "Output";
}

function isTechnicalIdentity(value) {
  const identity = text(value);
  return /^\d+$/.test(identity) || /^(?:items|cargo|route|recipe|building|producer|resource|possibility):\S+$/i.test(identity);
}

export function acquisitionRouteReviewItemName(item) {
  const identity = text(item?.key ?? item?.id);
  const name = [item?.name, item?.label, item?.tag]
    .map(text)
    .find((candidate) => candidate && candidate !== identity && !isTechnicalIdentity(candidate));
  if (name) return name;
  return identity.startsWith("cargo:") || text(item?.kind) === "cargo" ? "Unknown cargo" : "Unknown item";
}

function stationName(route) {
  return text(route?.buildingName ?? route?.building_name ?? route?.stationName ?? route?.station_name);
}

function routeName(route) {
  return text(route?.label ?? route?.name ?? route?.recipeName ?? route?.id);
}

function isGatheringRoute(route) {
  return text(route?.routeType).startsWith("gathering");
}

function isByproductRoute(route) {
  return text(route?.routeType).endsWith("-byproduct");
}

function isGenericRecipeName(value) {
  return /^Recipe(?:\s*->|$)/i.test(text(value));
}

function hasNumericTemplate(value) {
  return /\{\d+\}/.test(text(value));
}

function gatheringSourceName(route) {
  const sources = [...new Set((Array.isArray(route?.gatheringSources) ? route.gatheringSources : [])
    .map((source) => text(source?.label ?? source?.name ?? source?.tag))
    .filter(Boolean))];
  if (sources.length === 1) return sources[0];
  if (sources.length > 1) return `${sources.slice(0, -1).join(", ")} or ${sources.at(-1)}`;
  const source = route?.gatheringSource;
  return text(source?.label ?? source?.name ?? source?.tag ?? route?.producer?.tag ?? route?.producer?.name)
    || (text(source?.skill) ? `${text(source.skill)} resource node` : "resource node");
}

function inputNames(route) {
  return (Array.isArray(route?.inputs) ? route.inputs : [])
    .map(itemName)
    .filter((value) => value && value !== "Output");
}

function withStation(label, route) {
  const station = stationName(route);
  if (!station || label.toLocaleLowerCase().includes(station.toLocaleLowerCase())) return label;
  return `${label} at ${station}`;
}

export function acquisitionRouteKind(route) {
  if (route?.isTransportRoute === true) return "Logistics";
  if (isGatheringRoute(route) && route?.gatheringMode === "prospecting") return "Prospecting";
  if (isGatheringRoute(route)) return isByproductRoute(route) ? "Gathering byproduct" : "Gathering";
  return isByproductRoute(route) ? "Craft byproduct" : "Crafting";
}

export function acquisitionRouteLabel(route, output = {}) {
  const label = routeName(route);
  if (route?.isTransportRoute === true && label && !isGenericRecipeName(label)) return withStation(label, route);

  if (isGatheringRoute(route)) {
    const source = gatheringSourceName(route);
    if (route?.gatheringMode === "prospecting") return `Prospect at ${source}`;
    if (isByproductRoute(route)) {
      const producer = text(route?.producer?.name ?? route?.producer?.label);
      return producer
        ? `Gather byproduct from ${source} while collecting ${producer}`
        : `Gather byproduct from ${source}`;
    }
    return `Gather from ${source}`;
  }

  const templatedLabel = hasNumericTemplate(label);
  if (label && !isGenericRecipeName(label) && !templatedLabel) return withStation(label, route);
  const inputs = inputNames(route);
  const outputName = itemName(output);
  if (inputs.length) {
    const processLabel = `${templatedLabel ? "Process " : ""}${inputs.join(" + ")} -> ${outputName}`;
    return withStation(processLabel, route);
  }
  return withStation(templatedLabel ? `Produce ${outputName}` : label || `Produce ${outputName}`, route);
}

function reviewRouteLabel(route, output) {
  const outputName = acquisitionRouteReviewItemName(output);
  const routeIdentity = text(route?.id);
  const displayRouteName = [route?.label, route?.name, route?.recipeName]
    .map(text)
    .find((candidate) => candidate && candidate !== routeIdentity && !isTechnicalIdentity(candidate));
  const producerName = route?.producer && typeof route.producer === "object"
    ? acquisitionRouteReviewItemName(route.producer)
    : "";
  const friendlyRoute = {
    ...route,
    id: undefined,
    label: displayRouteName || undefined,
    name: undefined,
    recipeName: undefined,
    buildingName: route?.buildingName ?? route?.producerRecipe?.buildingName,
    producer: producerName ? { name: producerName } : route?.producer,
    inputs: (Array.isArray(route?.inputs) ? route.inputs : []).map((input) => ({ ...input, id: undefined, key: undefined, name: acquisitionRouteReviewItemName(input) })),
  };
  const label = acquisitionRouteLabel(friendlyRoute, { ...output, id: undefined, key: undefined, name: outputName });
  if (!isGatheringRoute(route)) return label.replaceAll(" -> ", " → ");
  if (route?.gatheringMode === "prospecting") return label.replace(/^Prospect at /, `Prospect for ${outputName} at `);
  if (isByproductRoute(route)) return label.replace(/^Gather byproduct from /, `Gather ${outputName} from `);
  return label.replace(/^Gather from /, `Gather ${outputName} from `);
}

export function acquisitionRouteReviewPresentation(route, output = {}) {
  const label = reviewRouteLabel(route, output);
  const outputName = acquisitionRouteReviewItemName(output);
  if (route?.probabilityStatus === "unavailable") {
    return { label, yield: "Probability data unavailable", probability: "unavailable" };
  }

  const guaranteed = route?.probabilityStatus === "guaranteed" && route?.isProbabilistic !== true;
  const probability = guaranteed ? "guaranteed" : "expected";
  if (isGatheringRoute(route)) {
    const expected = positive(route?.expectedPerProgress ?? route?.expectedYield);
    if (expected <= 0) return { label, yield: "Probability data unavailable", probability: "unavailable" };
    const basis = route?.gatheringMode === "prospecting" ? "extraction progress" : "node progress";
    const prefix = guaranteed ? "Produces" : "About";
    const yieldText = expected < 1
      ? `${prefix} 1 ${outputName} per ${formatProbabilityRate(1 / expected)} ${basis}`
      : `${prefix} ${formatProbabilityRate(expected)} ${outputName} per ${basis}`;
    return { label, yield: yieldText, probability };
  }

  const expected = positive(route?.expectedPerCraft ?? route?.expectedYield ?? route?.guaranteedYield);
  if (expected <= 0) return { label, yield: "Probability data unavailable", probability: "unavailable" };
  return {
    label,
    yield: `${guaranteed ? "Produces" : "About"} ${formatProbabilityRate(expected)} ${outputName} per craft`,
    probability,
  };
}

export function acquisitionRouteReviewTechnicalDetails(route, output = {}) {
  if (route?.probabilityStatus === "unavailable") return [];
  const details = [];
  const guaranteed = route?.probabilityStatus === "guaranteed" && route?.isProbabilistic !== true;
  const addRate = (label, value) => {
    if (value == null || value === "") return;
    const rate = number(value);
    if (Number.isFinite(Number(value)) && rate >= 0) details.push({ label, value: rate > 0 ? formatProbabilityRate(rate) : "None" });
  };

  if (isGatheringRoute(route)) {
    const basis = route?.gatheringMode === "prospecting" ? "extraction progress" : "node progress";
    addRate(`${guaranteed ? "Guaranteed" : "Average"} output per ${basis}`, route?.expectedPerProgress ?? route?.expectedYield);
    if (!guaranteed && route?.guaranteedYield != null) addRate(`Guaranteed output per ${basis}`, route.guaranteedYield);
    if (route?.gatheringMode === "prospecting") {
      details.push({ label: "Full-node estimate", value: "Unavailable for prospecting routes" });
    } else {
      addRate("Average output per fully gathered node", route?.expectedPerResource);
      addRate("Node progress to exhaustion", route?.resourceHealth);
    }
  } else {
    addRate(`${guaranteed ? "Guaranteed" : "Average"} output per craft`, route?.expectedPerCraft ?? route?.expectedYield);
    if (!guaranteed && route?.guaranteedYield != null) addRate("Guaranteed output per craft", route.guaranteedYield);
    addRate("Actions per craft", route?.actionsRequired);
  }

  const dropChance = Number(route?.dropChance);
  if (route?.dropChance != null && Number.isFinite(dropChance) && dropChance >= 0 && dropChance <= 1) {
    details.push({ label: "Chance per producer run", value: `${formatProbabilityRate(dropChance * 100)}%` });
    const dropQuantity = Number(route?.dropQuantity);
    if (route?.dropQuantity != null && Number.isFinite(dropQuantity) && dropQuantity >= 0) {
      details.push({
        label: "Average on a successful drop",
        value: `${dropQuantity > 0 ? formatProbabilityRate(dropQuantity) : "None"} ${itemName(output)}`,
      });
    }
  }
  return details;
}

export function acquisitionRouteReviewTechnicalFacts(route, output = {}) {
  const facts = [];
  const routeIdentity = text(route?.id);
  if (routeIdentity) facts.push({ label: "Route identity", value: routeIdentity, code: true });
  facts.push({ label: "Route type", value: acquisitionRouteKind(route) });
  facts.push({ label: "Probability evidence", value: text(route?.probabilityStatus) || "Not supplied" });

  const inputIdentities = (Array.isArray(route?.inputs) ? route.inputs : [])
    .map((input) => {
      const identity = text(input?.key ?? input?.id);
      return identity ? `${identity} ×${formatProbabilityRate(positive(input?.quantity))}` : "";
    })
    .filter(Boolean);
  if (inputIdentities.length) facts.push({ label: "Input identities", value: inputIdentities.join(", "), code: true });
  facts.push(...acquisitionRouteReviewTechnicalDetails(route, output));

  const source = route?.gatheringSource;
  const sourceLabel = typeof source === "string" ? text(source) : text(source?.label ?? source?.name ?? source?.tag ?? source?.skill);
  if (sourceLabel) facts.push({ label: "Source", value: sourceLabel });

  const producer = route?.producer;
  const producerLabel = typeof producer === "string" ? "" : text(producer?.name ?? producer?.label ?? producer?.tag);
  const producerIdentity = typeof producer === "string" ? text(producer) : text(producer?.key ?? producer?.id);
  if (producerLabel) facts.push({ label: "Producer", value: producerLabel });
  if (producerIdentity) facts.push({ label: "Producer identity", value: producerIdentity, code: true });

  const producerRecipe = route?.producerRecipe;
  const recipeLabel = typeof producerRecipe === "string" ? "" : text(producerRecipe?.name ?? producerRecipe?.label);
  const recipeIdentity = typeof producerRecipe === "string" ? text(producerRecipe) : text(producerRecipe?.id);
  if (recipeLabel) facts.push({ label: "Producer recipe", value: recipeLabel });
  if (recipeIdentity) facts.push({ label: "Producer recipe identity", value: recipeIdentity, code: true });

  const station = text(producerRecipe?.buildingName ?? route?.buildingName);
  const skill = text(producerRecipe?.skillName ?? route?.gatheringSkill);
  if (station) facts.push({ label: "Station", value: station });
  if (skill) facts.push({ label: "Skill", value: skill });
  if (route?.gatheringMode) facts.push({ label: "Gathering mode", value: text(route.gatheringMode) });
  return facts;
}

export function acquisitionRouteMetrics(route, options = {}) {
  if (route?.probabilityStatus === "unavailable") return { status: "unavailable" };

  const needed = positive(options.missingQuantity);
  const probabilistic = route?.probabilityStatus === "expected" || route?.isProbabilistic === true;
  const multiplier = probabilistic ? Math.max(1, number(options.multiplier) || 1) : 1;
  const bufferedNeed = needed * multiplier;
  const expectedPerProgress = positive(route?.expectedPerProgress ?? (isGatheringRoute(route) ? route?.expectedYield : 0));

  if (isGatheringRoute(route)) {
    if (route?.gatheringMode !== "prospecting") {
      const expectedPerNode = positive(route?.expectedPerResource);
      const resourceHealth = positive(route?.resourceHealth);
      if (expectedPerNode > 0 && resourceHealth > 0) {
        const exactUnits = bufferedNeed / expectedPerNode;
        return {
          status: "available",
          basis: "node",
          expectedPerUnit: expectedPerNode,
          exactUnits,
          plannedUnits: Math.ceil(exactUnits),
          totalProgress: Math.ceil(exactUnits * resourceHealth),
          progressPerExpectedItem: expectedPerProgress > 0 ? 1 / expectedPerProgress : null,
          totalActions: null,
        };
      }
    }

    if (expectedPerProgress <= 0) return { status: "unavailable" };
    const exactUnits = bufferedNeed / expectedPerProgress;
    return {
      status: "available",
      basis: "progress",
      expectedPerUnit: expectedPerProgress,
      exactUnits,
      plannedUnits: Math.ceil(exactUnits),
      totalProgress: Math.ceil(exactUnits),
      progressPerExpectedItem: 1 / expectedPerProgress,
      totalActions: null,
    };
  }

  const expectedPerCraft = positive(route?.expectedPerCraft ?? route?.expectedYield ?? route?.guaranteedYield);
  if (expectedPerCraft <= 0) return { status: "unavailable" };
  const exactUnits = bufferedNeed / expectedPerCraft;
  const plannedUnits = Math.ceil(exactUnits);
  return {
    status: "available",
    basis: "craft",
    expectedPerUnit: expectedPerCraft,
    exactUnits,
    plannedUnits,
    totalProgress: null,
    progressPerExpectedItem: null,
    totalActions: plannedUnits * Math.max(1, positive(route?.actionsRequired) || 1),
  };
}

export function formatProbabilityRate(value) {
  const rate = number(value);
  if (rate === 0) return "0";
  if (Math.abs(rate) < 0.000001) return rate.toExponential(2).replace(/\.0+e/, "e");
  return rate.toLocaleString(undefined, { maximumFractionDigits: 6 });
}
