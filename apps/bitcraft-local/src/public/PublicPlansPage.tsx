import React from "react";
import { Archive, Clipboard, Copy, Link2, Plus, RefreshCw, Save, Trash2, UserPlus } from "lucide-react";

import { loadPublicSession, type PublicSession } from "./accountApi";
import {
  createPublicPlan,
  loadPublicPlan,
  loadPublicPlanEvents,
  loadPublicPlans,
  mutatePublicPlanAccess,
  PublicPlanRequestError,
  savePublicPlanDocument,
} from "./planApi";

type Route = { id: "plans" | "plan-new" | "plan"; params: Record<string, string> };
type Row = Record<string, any>;

const EMPTY_DOCUMENT = Object.freeze({
  schemaVersion: 1,
  targets: [],
  routeOverrides: {},
  multipliers: {},
  sectionOverrides: {},
  rowNameOverrides: {},
});

function roleLabel(value: unknown) {
  const role = String(value ?? "viewer");
  return role.slice(0, 1).toUpperCase() + role.slice(1);
}

function dateLabel(value: unknown) {
  const time = Date.parse(String(value ?? ""));
  return Number.isFinite(time) ? new Date(time).toLocaleString() : "—";
}

async function copyText(value: string) {
  if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable. Select and copy the text manually.");
  await navigator.clipboard.writeText(value);
}

function SignInRequired() {
  return <section className="public-panel public-plan-workspace"><h1>My plans</h1><p>Sign in with Discord to create and collaborate on saved plans.</p><a className="toolbar-button primary" href="/settings">Open account settings</a></section>;
}

function MyPlans({ plans }: { plans: Row[] }) {
  return <section className="public-panel public-plan-workspace">
    <header className="public-plan-header"><div><p className="public-eyebrow">Collaboration</p><h1>My plans</h1></div><a className="toolbar-button primary" href="/plans/new"><Plus size={16} /> New plan</a></header>
    {plans.length ? <div className="public-plan-list">{plans.map((plan) => <a href={`/plans/${encodeURIComponent(String(plan.id))}`} key={String(plan.id)}>
      <div><strong>{String(plan.title)}</strong><span>Claim #{String(plan.claimId)} · {String(plan.status)}</span></div>
      <span className="public-plan-role">{roleLabel(plan.role)}</span>
    </a>)}</div> : <p>No plans yet. Create the first plan for your claim.</p>}
  </section>;
}

function NewPlan({ csrfToken }: { csrfToken: string }) {
  const [claimId, setClaimId] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const plan = await createPublicPlan({ claimId, title, document: EMPTY_DOCUMENT, csrfToken });
      window.location.assign(`/plans/${encodeURIComponent(String(plan.id))}`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "The plan could not be created.");
    } finally { setBusy(false); }
  }
  return <section className="public-panel public-plan-workspace"><header><p className="public-eyebrow">My plans</p><h1>Create plan</h1></header>
    <form className="public-plan-form" onSubmit={submit}>
      <label><span>Claim ID</span><input required inputMode="numeric" pattern="0|[1-9][0-9]*" value={claimId} onChange={(event) => setClaimId(event.target.value)} /></label>
      <label><span>Plan title</span><input required maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      {message ? <p role="alert">{message}</p> : null}
      <div className="public-account-actions"><a className="toolbar-button" href="/plans">Cancel</a><button className="toolbar-button primary" disabled={busy}><Plus size={16} /> {busy ? "Creating…" : "Create plan"}</button></div>
    </form>
  </section>;
}

function PlanEditor({ initialPlan, csrfToken }: { initialPlan: Row; csrfToken: string }) {
  const [plan, setPlan] = React.useState(initialPlan);
  const [draft, setDraft] = React.useState(() => JSON.stringify(initialPlan.document, null, 2));
  const [draftDocumentRevision, setDraftDocumentRevision] = React.useState(() => Number(initialPlan.revisions.document));
  const [events, setEvents] = React.useState<Row[]>([]);
  const [busy, setBusy] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [conflict, setConflict] = React.useState(false);
  const [createdSecret, setCreatedSecret] = React.useState("");
  const [inviteRole, setInviteRole] = React.useState("editor");
  const [shareLabel, setShareLabel] = React.useState("Read-only plan");
  const isOwner = plan.role === "owner";
  const canEdit = isOwner || plan.role === "editor";

  const refresh = React.useCallback(async ({ replaceDraft = true } = {}) => {
    const [next, nextEvents] = await Promise.all([loadPublicPlan(String(plan.id)), loadPublicPlanEvents(String(plan.id))]);
    setPlan(next); setEvents(nextEvents);
    if (replaceDraft) {
      setDraft(JSON.stringify(next.document, null, 2));
      setDraftDocumentRevision(Number(next.revisions.document));
    }
  }, [plan.id]);
  React.useEffect(() => { void loadPublicPlanEvents(String(plan.id)).then(setEvents).catch(() => setEvents([])); }, [plan.id]);

  async function run(name: string, action: () => Promise<void>) {
    setBusy(name); setMessage(""); setConflict(false);
    try { await action(); }
    catch (reason) {
      if (reason instanceof PublicPlanRequestError && reason.code === "revision_conflict") setConflict(true);
      setMessage(reason instanceof Error ? reason.message : "The plan request failed.");
    } finally { setBusy(""); }
  }

  async function accessMutation(name: string, path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) {
    await run(name, async () => {
      const result = await mutatePublicPlanAccess<Row>({ path, method, body, accessRevision: Number(plan.revisions.access), csrfToken });
      if (name === "clone" && result.plan?.id) {
        window.location.assign(`/plans/${encodeURIComponent(String(result.plan.id))}`);
        return;
      }
      await refresh({ replaceDraft: false });
      if (result.invite?.token) setCreatedSecret(`${location.origin}/invites/${result.invite.id}#token=${result.invite.token}`);
      if (result.shareLink?.token) setCreatedSecret(`${location.origin}/shared-plans/${plan.id}#share=${result.shareLink.token}`);
    });
  }

  async function saveDocument() {
    await run("save", async () => {
      let document;
      try { document = JSON.parse(draft); } catch { throw new Error("Plan document must be valid JSON."); }
      const saved = await savePublicPlanDocument({ planId: String(plan.id), document, documentRevision: draftDocumentRevision, csrfToken });
      setPlan(saved); setDraft(JSON.stringify(saved.document, null, 2)); setDraftDocumentRevision(Number(saved.revisions.document));
    });
  }

  return <section className="public-panel public-plan-workspace">
    <header className="public-plan-header"><div><p className="public-eyebrow">Claim #{String(plan.claimId)} · {roleLabel(plan.role)}</p><h1>{String(plan.title)}</h1><span className="public-plan-role">{String(plan.status)}</span></div><a className="toolbar-button" href="/plans">Back to My plans</a></header>
    {message ? <div className="public-plan-message" role="alert">{message}{conflict ? <div className="public-account-actions"><button className="toolbar-button" onClick={() => void run("reload", () => refresh())}><RefreshCw size={15} /> Reload server version</button><button className="toolbar-button" onClick={() => void run("copy", () => copyText(draft))}><Clipboard size={15} /> Copy unsaved draft</button></div> : null}</div> : null}
    <div className="public-plan-editor-grid">
      <section><h2>Plan document</h2><p>Targets use typed catalog keys such as <code>items:7</code> or <code>cargo:7</code>. Quantities remain decimal strings.</p><textarea aria-label="Plan document JSON" spellCheck={false} readOnly={!canEdit} value={draft} onInput={(event) => setDraft(event.currentTarget.value)} />
        {canEdit ? <button className="toolbar-button primary" disabled={Boolean(busy)} onClick={() => void saveDocument()}><Save size={16} /> {busy === "save" ? "Saving…" : "Save plan"}</button> : null}
      </section>
      <section><h2>Plan actions</h2><div className="public-plan-actions">
        {canEdit ? <button className="toolbar-button" disabled={Boolean(busy)} onClick={() => void accessMutation("clone", `/api/public/plans/${plan.id}/clone`, "POST", { title: `${plan.title} copy` })}><Copy size={15} /> Clone</button> : null}
        {isOwner ? <><button className="toolbar-button" disabled={Boolean(busy)} onClick={() => void accessMutation("archive", `/api/public/plans/${plan.id}/status`, "PATCH", { status: plan.status === "archived" ? "active" : "archived" })}><Archive size={15} /> {plan.status === "archived" ? "Unarchive" : "Archive"}</button><button className="toolbar-button danger" disabled={Boolean(busy)} onClick={() => void run("delete", async () => { await mutatePublicPlanAccess({ path: `/api/public/plans/${plan.id}`, method: "DELETE", accessRevision: Number(plan.revisions.access), csrfToken }); window.location.assign("/plans"); })}><Trash2 size={15} /> Delete permanently</button></> : null}
      </div></section>
    </div>
    {isOwner ? <div className="public-plan-access-grid">
      <section><h2>Invitations</h2><div className="public-plan-inline"><select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}><option value="editor">Editor</option><option value="viewer">Viewer</option></select><button className="toolbar-button" onClick={() => void accessMutation("invite", `/api/public/plans/${plan.id}/invites`, "POST", { role: inviteRole })}><UserPlus size={15} /> Create invite</button></div>{(plan.access?.invites ?? []).map((invite: Row) => <article key={invite.id}><span>{roleLabel(invite.role)} · expires {dateLabel(invite.expiresAt)}</span><button onClick={() => void accessMutation(`invite:${invite.id}`, `/api/public/plans/${plan.id}/invites/${invite.id}`, "DELETE")}>Revoke</button></article>)}</section>
      <section><h2>Share links</h2><div className="public-plan-inline"><input value={shareLabel} maxLength={80} onChange={(event) => setShareLabel(event.target.value)} /><button className="toolbar-button" onClick={() => void accessMutation("share", `/api/public/plans/${plan.id}/share-links`, "POST", { label: shareLabel })}><Link2 size={15} /> Create link</button></div>{(plan.access?.shareLinks ?? []).map((link: Row) => <article key={link.id}><span>{String(link.label)}</span><button onClick={() => void accessMutation(`share:${link.id}`, `/api/public/plans/${plan.id}/share-links/${link.id}`, "DELETE")}>Revoke</button></article>)}</section>
      <section><h2>Members</h2>{(plan.access?.members ?? []).length ? (plan.access.members as Row[]).map((member) => <article key={member.userId}><div><strong>{String(member.globalName || member.username || member.userId)}</strong><span>{roleLabel(member.role)}</span></div><select value={member.role} onChange={(event) => void accessMutation(`member:${member.userId}`, `/api/public/plans/${plan.id}/members/${member.userId}`, "PATCH", { role: event.target.value })}><option value="editor">Editor</option><option value="viewer">Viewer</option></select><button onClick={() => void accessMutation(`remove:${member.userId}`, `/api/public/plans/${plan.id}/members/${member.userId}`, "DELETE")}>Remove</button>{member.role === "editor" ? <button onClick={() => void accessMutation(`transfer:${member.userId}`, `/api/public/plans/${plan.id}/transfer`, "POST", { userId: member.userId })}>Transfer ownership</button> : null}</article>) : <p>No accepted collaborators.</p>}</section>
    </div> : null}
    {createdSecret ? <section className="public-plan-secret"><h2>Copy this link now</h2><p>Secrets are shown once and are never stored in plan history.</p><input readOnly value={createdSecret} aria-label="New collaboration link" /><button className="toolbar-button" onClick={() => void run("copy-secret", () => copyText(createdSecret))}><Clipboard size={15} /> Copy link</button></section> : null}
    <section><h2>Recent activity</h2><div className="public-table">{events.length ? events.map((event) => <article key={event.id}><strong>{String(event.type)}</strong><span>{dateLabel(event.createdAt)}{event.actor ? ` · ${String(event.actor.globalName || event.actor.username || "Member")}` : ""}</span></article>) : <p>No activity recorded.</p>}</div></section>
  </section>;
}

export function PublicPlansPage({ route }: { route: Route }) {
  const [session, setSession] = React.useState<PublicSession | null>(null);
  const [plans, setPlans] = React.useState<Row[]>([]);
  const [plan, setPlan] = React.useState<Row | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [message, setMessage] = React.useState("");
  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const current = await loadPublicSession();
        if (!active) return;
        setSession(current);
        if (!current.user) return;
        if (route.id === "plans") setPlans(await loadPublicPlans());
        if (route.id === "plan") setPlan(await loadPublicPlan(route.params.id));
      } catch (reason) {
        if (active) setMessage(reason instanceof Error ? reason.message : "Plans are unavailable.");
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [route.id, route.params.id]);
  if (loading) return <section className="public-panel public-plan-workspace" role="status">Loading plans…</section>;
  if (!session?.user) return <SignInRequired />;
  if (session.legal.requiresAcceptance) return <section className="public-panel public-plan-workspace"><h1>Plans need current legal acceptance</h1><p>Accept the current Terms and Privacy Policy before managing plans.</p><a className="toolbar-button primary" href="/settings">Review account settings</a></section>;
  if (message) return <section className="public-panel public-plan-workspace" role="alert"><h1>Plans unavailable</h1><p>{message}</p></section>;
  if (route.id === "plans") return <MyPlans plans={plans} />;
  if (route.id === "plan-new") return <NewPlan csrfToken={session.csrfToken ?? ""} />;
  if (plan) return <PlanEditor initialPlan={plan} csrfToken={session.csrfToken ?? ""} />;
  return <section className="public-panel public-plan-workspace" role="status">Loading plan…</section>;
}
