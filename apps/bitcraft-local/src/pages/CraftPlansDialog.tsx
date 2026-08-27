import React from "react";
import { ClipboardList, Copy, Pencil, Plus, Star, Trash2, X } from "lucide-react";
import { Dialog } from "../components/main/Dialog";
import type { AnyRecord } from "../main-app-data";

type Props = {
  open: boolean;
  plans: AnyRecord[];
  selectedPlanId: string;
  userCsrfToken?: string | null;
  adminCsrfToken?: string | null;
  currentUserId?: number | null;
  onClose: () => void;
  onChanged: (planId?: string) => void;
  onSelect: (planId: string) => void;
};

async function api(path: string, csrfToken: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  headers.set("content-type", "application/json");
  if (options.method && options.method !== "GET") headers.set("x-csrf-token", csrfToken);
  const response = await fetch(`/api/local${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

export function CraftPlansDialog({ open, plans, selectedPlanId, userCsrfToken, adminCsrfToken, currentUserId, onClose, onChanged, onSelect }: Props) {
  const [name, setName] = React.useState("");
  const [copyFrom, setCopyFrom] = React.useState("");
  const [scope, setScope] = React.useState<"personal" | "shared">(adminCsrfToken && !userCsrfToken ? "shared" : "personal");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [adminPersonalPlans, setAdminPersonalPlans] = React.useState<AnyRecord[]>([]);
  React.useEffect(() => {
    if (open) return;
    setName("");
    setCopyFrom("");
    setError("");
    setBusy(false);
    setAdminPersonalPlans([]);
  }, [open]);
  React.useEffect(() => {
    if (!open || !adminCsrfToken) return;
    void api("/admin/craft-plans?scope=personal", adminCsrfToken).then((body) => setAdminPersonalPlans(Array.isArray(body.plans) ? body.plans : [])).catch(() => setAdminPersonalPlans([]));
  }, [adminCsrfToken, open]);
  if (!open) return null;

  async function run(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); }
  }

  async function create() {
    const personal = scope === "personal";
    const csrf = personal ? userCsrfToken : adminCsrfToken;
    if (!csrf) throw new Error(personal ? "Sign in with Discord to create a personal plan." : "Administrator access is required.");
    const path = personal ? "/user/craft-plans" : "/admin/craft-plans";
    const result = await api(path, csrf, { method: "POST", body: JSON.stringify({ name, duplicateFromPlanId: copyFrom || undefined }) });
    const id = String(result.plan?.id ?? result.planRecord?.id ?? "");
    setName(""); setCopyFrom(""); onChanged(id || undefined);
  }

  async function remove(plan: AnyRecord) {
    if (!window.confirm(`Delete “${plan.name}”? This cannot be undone.`)) return;
    const personal = plan.scope === "personal" && Number(plan.ownerUserId) === Number(currentUserId) && userCsrfToken;
    const path = personal ? `/user/craft-plans/${encodeURIComponent(plan.id)}` : `/admin/craft-plans/${encodeURIComponent(plan.id)}`;
    const csrf = personal ? userCsrfToken : adminCsrfToken;
    if (!csrf) throw new Error("You cannot delete this plan.");
    await api(path, csrf, { method: "DELETE", body: JSON.stringify({ expectedRevision: plan.revision }) });
    onChanged();
  }

  async function primary(plan: AnyRecord) {
    if (!adminCsrfToken) return;
    await api(`/admin/craft-plans/${encodeURIComponent(plan.id)}/primary`, adminCsrfToken, { method: "POST", body: JSON.stringify({ expectedRevision: plan.revision }) });
    onChanged(plan.id);
  }

  async function rename(plan: AnyRecord) {
    const nextName = window.prompt("Plan name", String(plan.name ?? ""));
    if (nextName == null || nextName.trim() === String(plan.name ?? "").trim()) return;
    const ownedPersonal = plan.scope === "personal" && Number(plan.ownerUserId) === Number(currentUserId) && userCsrfToken;
    const path = ownedPersonal ? `/user/craft-plans/${encodeURIComponent(plan.id)}` : `/admin/craft-plans/${encodeURIComponent(plan.id)}`;
    const csrf = ownedPersonal ? userCsrfToken : adminCsrfToken;
    if (!csrf) throw new Error("You cannot rename this plan.");
    await api(path, csrf, { method: "PUT", body: JSON.stringify({ name: nextName, expectedRevision: plan.revision }) });
    onChanged(plan.id);
  }

  const shared = plans.filter((plan) => plan.scope === "shared");
  const personal = plans.filter((plan) => plan.scope === "personal");
  return <Dialog open={open} onClose={onClose} className="craft-plans-dialog" title="Plans" titleElementId="craft-plans-title">
    <div className="modal-header"><div><h2 id="craft-plans-title"><ClipboardList size={20} /> Plans</h2><p>Open an active plan or create an independent copy.</p></div><button className="icon-button" aria-label="Close plans" onClick={onClose}><X size={18} /></button></div>
    <div className="craft-plans-dialog-body">
      {error ? <div className="alert error" role="alert">{error}</div> : null}
      <section className="form-card craft-plan-create"><h3><Plus size={16} /> New plan</h3>{!userCsrfToken && !adminCsrfToken ? <p className="legend">Sign in with Discord to create a personal plan.</p> : null}<label className="field"><span>Name</span><input maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label><label className="field"><span>Start from</span><select value={copyFrom} onChange={(event) => setCopyFrom(event.target.value)}><option value="">Blank plan</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {plan.scope}</option>)}</select></label>{adminCsrfToken ? <label className="field"><span>Type</span><select value={scope} onChange={(event) => setScope(event.target.value as "personal" | "shared")}><option value="shared">Shared</option>{userCsrfToken ? <option value="personal">Personal</option> : null}</select></label> : null}<button className="toolbar-button primary" disabled={busy || !name.trim()} onClick={() => void run(create)}>{copyFrom ? <Copy size={15} /> : <Plus size={15} />} Create</button></section>
      {[{ title: "Shared plans", rows: shared }, { title: "My plans", rows: personal }, ...(adminCsrfToken ? [{ title: "Admin · Personal plans", rows: adminPersonalPlans.filter((plan) => Number(plan.ownerUserId) !== Number(currentUserId)) }] : [])].map((group) => <section key={group.title} className="craft-plan-library"><h3>{group.title}</h3>{group.rows.length ? group.rows.map((plan) => { const canManagePlan = (plan.scope === "personal" && (userCsrfToken || adminCsrfToken)) || (plan.scope === "shared" && adminCsrfToken); return <article className={plan.id === selectedPlanId ? "is-selected" : ""} key={plan.id}><button className="craft-plan-library-open" onClick={() => onSelect(plan.id)}><strong>{plan.name}</strong><small>{plan.primary ? "Shared · Primary" : plan.scope === "personal" ? `Personal${plan.ownerUserId ? ` · Owner #${plan.ownerUserId}` : ""}` : "Shared"}</small></button><div className="toolbar">{adminCsrfToken && plan.scope === "shared" && !plan.primary ? <button className="toolbar-button" disabled={busy} onClick={() => void run(() => primary(plan))}><Star size={14} /> Make primary</button> : null}{canManagePlan ? <button className="toolbar-button" disabled={busy} onClick={() => void run(() => rename(plan))}><Pencil size={14} /> Rename</button> : null}{canManagePlan ? <button className="toolbar-button danger" disabled={busy || plan.primary} onClick={() => void run(() => remove(plan))}><Trash2 size={14} /> Delete</button> : null}</div></article>; }) : <p className="legend">No plans in this group.</p>}</section>)}
    </div>
  </Dialog>;
}
