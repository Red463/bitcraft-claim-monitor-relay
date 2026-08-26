import React from "react";
import { ChevronRight, Search, X } from "lucide-react";

import { searchPublicClaims, type PublicHint } from "./api";
import { readRecentClaims } from "./preferences.mjs";
import { publicClaimPath } from "./routes.mjs";

type PublicClaimFinderProps = {
  mode: "home" | "dialog";
  idPrefix: string;
  autoFocus?: boolean;
  onSelect?: (claim: PublicHint) => void;
  onClose?: () => void;
};

export function PublicClaimFinder({ mode, idPrefix, autoFocus = false, onSelect, onClose }: PublicClaimFinderProps) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<PublicHint[]>([]);
  const [message, setMessage] = React.useState("");
  const [recent] = React.useState(() => readRecentClaims(window.localStorage));
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  React.useEffect(() => {
    if (mode !== "dialog") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [mode, onClose]);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    try {
      const result = await searchPublicClaims(query);
      setResults(result.hints);
      if (!result.hints.length) setMessage("No matching claims found.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Claim search is unavailable.");
    }
  }

  const entries: PublicHint[] = results.length
    ? results
    : recent.map((value) => ({ claimId: value.claimId, name: value.name, regionId: value.regionId }));
  const content = (
    <section className="public-search-panel">
      <form onSubmit={search}>
        <label htmlFor={`${idPrefix}-input`}>FIND A BITCRAFT CLAIM</label>
        <p id={`${idPrefix}-help`}>Enter at least 3 characters from the claim name, or paste the exact claim ID.</p>
        <div>
          <input ref={inputRef} id={`${idPrefix}-input`} aria-describedby={`${idPrefix}-help`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Claim name or exact claim ID" />
          <button className="toolbar-button primary" type="submit"><Search size={16} /> Search</button>
        </div>
      </form>
      {message ? <p role="status">{message}</p> : null}
      {entries.length > 0 ? (
        <div className="public-search-results">
          <span>{results.length ? "Matches" : "Recent claims"}</span>
          {entries.map((entry) => {
            const href = publicClaimPath(entry);
            return href ? <a key={entry.claimId} href={href} onClick={() => onSelect?.(entry)}><strong>{entry.name}</strong><small>#{entry.claimId} · region {entry.regionId ?? "—"}</small><ChevronRight size={16} /></a> : null;
          })}
        </div>
      ) : null}
    </section>
  );

  if (mode === "home") return content;
  return (
    <div className="public-claim-finder-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
      <section className="public-claim-finder-dialog" role="dialog" aria-modal="true" aria-label="Find a claim">
        <header><div><p className="public-eyebrow">Claim Monitor</p><h2>Find a claim</h2></div><button type="button" aria-label="Close claim finder" onClick={onClose}><X size={18} /></button></header>
        {content}
      </section>
    </div>
  );
}
