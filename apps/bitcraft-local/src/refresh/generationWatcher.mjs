import { PAGE_REFRESH_POLL_MS } from "./pageRefresh.mjs";
import { pageGenerationDomains } from "../api/pageDomains.ts";

export const INTERVAL_PAGE_GENERATION_POLL_MS = 30_000;

function generationNumber(value) {
  const generation = Number(value);
  return Number.isSafeInteger(generation) && generation >= 0 ? generation : 0;
}

export function createGameDataGenerationWatcher(options) {
  const claimId = String(options.claimId ?? "");
  const domains = [...new Set((options.domains ?? []).map(String).filter(Boolean))].sort();
  const domainKey = domains.join(",");
  const domainSet = new Set(domains);
  const search = new URLSearchParams({ claimId, domains: domainKey });
  const fetcher = options.fetch ?? globalThis.fetch;
  const EventSourceClass = options.EventSource ?? globalThis.EventSource;
  const setIntervalFn = options.setInterval ?? globalThis.setInterval;
  const clearIntervalFn = options.clearInterval ?? globalThis.clearInterval;
  const onGeneration = options.onGeneration ?? (() => {});
  let lastGeneration = 0;
  let closed = false;
  let pollInFlight = false;

  function apply(event) {
    if (event?.claimId != null && String(event.claimId) !== claimId) return;
    if (Array.isArray(event?.changedDomains) && !event.changedDomains.some((domain) => domainSet.has(String(domain)))) return;
    const generation = generationNumber(event?.generation);
    if (closed || generation <= lastGeneration) return;
    lastGeneration = generation;
    onGeneration(generation, event);
  }

  async function poll() {
    if (closed || pollInFlight || (options.isVisible && !options.isVisible())) return;
    pollInFlight = true;
    try {
      const response = await fetcher(`/api/local/game-data/generation?${search}`);
      if (response.ok) apply(await response.json());
    } catch {
      // The last rendered generation stays authoritative until a later poll succeeds.
    } finally {
      pollInFlight = false;
    }
  }

  const events = new EventSourceClass(`/api/local/game-data/events?${search}`);
  events.onmessage = (message) => {
    try {
      apply(JSON.parse(message.data));
    } catch {
      // Ignore malformed invalidations; the generation poll remains active.
    }
  };
  void poll();
  const pollTimer = setIntervalFn(() => void poll(), options.pollMs ?? PAGE_REFRESH_POLL_MS);

  return {
    stop() {
      if (closed) return;
      closed = true;
      events.close();
      clearIntervalFn(pollTimer);
    },
  };
}

export function createPageGameDataGenerationWatcher(options) {
  const { activePanel, ...watcherOptions } = options;
  const claimId = String(options.claimId ?? "");
  const domains = pageGenerationDomains(activePanel);
  if (!claimId || domains.length === 0) return null;
  return createGameDataGenerationWatcher({
    ...watcherOptions,
    claimId,
    domains,
    pollMs: activePanel === "craft-monitor" ? PAGE_REFRESH_POLL_MS : INTERVAL_PAGE_GENERATION_POLL_MS,
  });
}
