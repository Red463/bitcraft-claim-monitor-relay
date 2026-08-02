import {
  claimSupplyCap,
  toNumber,
  type AnyRecord,
} from "../main-app-data.ts";

export function groupResearchTechnologies(technologies: AnyRecord[]) {
  const researched: AnyRecord[] = [];
  const researching: AnyRecord[] = [];
  const available: AnyRecord[] = [];
  const locked: AnyRecord[] = [];
  for (const technology of technologies) {
    if (technology.isResearched || technology.state === "researched") {
      researched.push(technology);
    } else if (technology.isResearching || technology.state === "researching") {
      researching.push(technology);
    } else if (technology.state === "locked") {
      locked.push(technology);
    } else {
      available.push(technology);
    }
  }
  return { researched, researching, available, locked };
}

export function researchSettlementCaps(claim: AnyRecord, technologies: AnyRecord[]) {
  const researched = technologies.filter(
    (technology) => technology.isResearched || technology.state === "researched",
  );
  const learnedSupplyCap = Math.max(
    ...researched.map((technology) => toNumber(technology.supplies)),
    0,
  );
  return {
    maxTiles: Math.max(
      toNumber(claim.numTiles),
      ...researched.map((technology) => toNumber(technology.area)),
      0,
    ),
    maxSupplies: learnedSupplyCap || claimSupplyCap(claim),
  };
}
