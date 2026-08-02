import React from "react";
import { parseDateValue, toNumber, type AnyRecord } from "../../main-app-data";
import { unique } from "../../utils/array";
import { formatNumber } from "../../utils/format";
import { DataTable } from "./DataTable";
import { Info } from "./Stats";
import { AsyncState } from "./AsyncState";

/*
 * Shared chrome for the public app: page headers, loading/error states, the
 * live-data warning banner, and the sidebar refresh status widget.
 */

export function Header({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="section-header">
      <div>
        <h2>{title}</h2>
        {children ? <p>{children}</p> : null}
      </div>
    </div>
  );
}

export function ToolbarButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button className="toolbar-button" onClick={onClick}>{children}</button>;
}

export function TablePanel({ title, subtitle, rows, columns }: { title: string; subtitle: string; rows: AnyRecord[]; columns: Array<[string, (row: AnyRecord, index: number) => React.ReactNode]> }) {
  return <div className="panel"><Header title={title}>{subtitle}</Header><DataTable rows={rows} columns={columns} scrollLabel={`${title} table`} emptyState={`No ${title.toLowerCase()} records were returned.`} /></div>;
}

export function AppSkeleton() {
  return <div className="panel app-skeleton" role="status" aria-live="polite" aria-busy="true" aria-label="Loading page data"><div className="skeleton-line title" /><div className="skeleton-grid">{[0, 1, 2, 3].map((id) => <div key={id} />)}</div><div className="skeleton-block" /><div className="skeleton-block short" /></div>;
}

export type ApiStatusDiagnostics = {
  appVersion: string;
  page: string;
  claimId: string;
  url: string;
  loading: boolean;
  lastSuccessfulRefresh: string | null;
  warningCount: number;
  dataCounts: Record<string, number>;
  warnings: string[];
};

export function ApiStatusBanner({
  warnings,
  lastUpdated,
  diagnostics,
  status,
}: {
  warnings: string[];
  lastUpdated: Date | null;
  diagnostics: ApiStatusDiagnostics;
  status: "stale" | "partial";
}) {
  const uniqueWarnings = unique(warnings).slice(0, 6);
  if (!uniqueWarnings.length) return null;
  const diagnosticLog = JSON.stringify({ ...diagnostics, warnings: uniqueWarnings }, null, 2);
  const statusCopy = status === "stale"
    ? {
        kind: "stale" as const,
        title: "Live game data refresh issue",
        detail: "Showing latest saved data. Some live details may be stale.",
      }
    : {
        kind: "warning" as const,
        title: "Some live details are incomplete",
        detail: "Relay data is live, but some optional names or calculated fields are unavailable.",
      };
  return (
    <section className="api-status-banner">
      <div className="api-status-main">
        <AsyncState kind={statusCopy.kind} title={statusCopy.title} detail={statusCopy.detail} compact />
        <small className="api-status-meta">{lastUpdated ? `Last successful refresh: ${lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Waiting for a successful refresh."}</small>
      </div>
      <details className="api-status-details">
        <summary>Details</summary>
        <div className="api-status-diagnostic-grid">
          <Info label="Page" value={diagnostics.page} />
          <Info label="Settlement ID" value={diagnostics.claimId} />
          <Info label="Warnings" value={formatNumber(uniqueWarnings.length)} />
          <Info label="Refresh state" value={diagnostics.loading ? "Refreshing" : "Idle"} />
          <Info label="Members loaded" value={formatNumber(diagnostics.dataCounts.members)} />
          <Info label="Crafts loaded" value={formatNumber(diagnostics.dataCounts.crafts)} />
        </div>
        <ul>
          {uniqueWarnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
        <div className="api-status-log">
          {/* The diagnostic block is intentionally copyable so users can send
              enough context to debug transient data-provider issues. */}
          <span>Copyable diagnostic context</span>
          <code>{diagnosticLog}</code>
        </div>
      </details>
    </section>
  );
}

function collectorTimeLabel(value: unknown): string {
  const date = parseDateValue(value);
  return date ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Waiting";
}

export function RefreshStatus({
  loading,
  lastUpdated,
  collectorStatus,
  intervalSeconds,
}: {
  loading: boolean;
  lastUpdated: Date | null;
  collectorStatus: AnyRecord | null | undefined;
  intervalSeconds: number;
}) {
  const collectors = Object.entries((collectorStatus?.collectors ?? {}) as Record<string, AnyRecord>);
  const collectorDetail = (collector: AnyRecord) => {
    if (collector.running) {
      const hasProgress = collector.progressCurrent != null && collector.progressTotal != null;
      const progress = hasProgress ? ` (${toNumber(collector.progressCurrent)} / ${toNumber(collector.progressTotal)})` : "";
      return `${collector.currentStep ?? "Running"}${progress}`;
    }
    return collector.lastError ? `Error: ${collector.lastError}` : `Updated ${collectorTimeLabel(collector.lastSuccessAt)}`;
  };
  return (
    <div className="refresh-status" aria-label={`Live updates apply immediately; local fallback refreshes every ${intervalSeconds} seconds`} tabIndex={0}>
      <span className={`refresh-dot ${loading ? "refreshing" : ""}`} />
      <span className="refresh-copy">
        <small>{loading ? "Refreshing" : "Last refresh"}</small>
        <time>{lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Waiting..."}</time>
      </span>
      {collectors.length ? (
        <div className="refresh-breakdown" role="tooltip">
          {/* This hover panel reports background reconciliation. It is
              diagnostic only; page data can also come directly from a current
              provider generation. */}
          <header>
            <strong>Reconciliation status</strong>
            <span>{collectorStatus?.intervalMs ? `Reconciliation every ${Math.round(toNumber(collectorStatus.intervalMs) / 1000)}s` : "Reconciliation schedule"}</span>
          </header>
          <div className="refresh-breakdown-list">
            {collectors.map(([key, collector]) => (
              <div className="refresh-breakdown-row" key={key}>
                <span className={`collector-dot ${collector.running ? "is-running" : collector.lastError ? "is-error" : collector.lastSuccessAt ? "is-ok" : ""}`} />
                <span>
                  <strong>{collector.label ?? key}</strong>
                  <small>{collectorDetail(collector)}</small>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ApiErrorState({ message }: { message: string }) {
  return (
    <section className="api-error-state">
      <AsyncState
        kind="error"
        title="Unable to refresh live game data"
        detail="The data provider may be having a temporary issue. The app will recover automatically when the next refresh succeeds."
        action={<details>
          <summary>Technical detail</summary>
          <code>{message}</code>
        </details>}
      />
    </section>
  );
}
