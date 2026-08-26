import React from "react";
import { Download, LogIn, LogOut, ShieldCheck, UserRound } from "lucide-react";

import {
  acceptPublicLegal,
  deletePublicAccountProfile,
  loadPublicLegal,
  loadPublicSession,
  logoutPublicSession,
  reviewPublicDeletion,
  startPublicDiscordLogin,
  startPublicPrivacyReauthentication,
  type PublicLegalPolicy,
  type PublicSession,
} from "./accountApi";

type DeletionReview = Awaited<ReturnType<typeof reviewPublicDeletion>>;

export function PublicAccountSettings({ page }: { page: "account" | "settings" }) {
  const [session, setSession] = React.useState<PublicSession | null>(null);
  const [policy, setPolicy] = React.useState<PublicLegalPolicy | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [acceptedTerms, setAcceptedTerms] = React.useState(false);
  const [ageConfirmed, setAgeConfirmed] = React.useState(false);
  const [deletionReview, setDeletionReview] = React.useState<DeletionReview | null>(null);
  const [dispositions, setDispositions] = React.useState<Record<string, string>>({});
  const [deletionConfirmed, setDeletionConfirmed] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    Promise.all([loadPublicSession(), loadPublicLegal()])
      .then(([nextSession, nextPolicy]) => {
        if (!active) return;
        setSession(nextSession);
        setPolicy(nextPolicy);
      })
      .catch((reason) => { if (active) setMessage(reason instanceof Error ? reason.message : "Account settings are unavailable."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function perform(name: string, action: () => Promise<void>) {
    setBusy(name);
    setMessage("");
    try { await action(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "The account request failed."); }
    finally { setBusy(""); }
  }

  async function signIn() {
    await perform("login", async () => {
      const response = await startPublicDiscordLogin({ acceptedTerms, ageConfirmed, returnTo: "/settings" });
      window.location.assign(response.authorizeUrl);
    });
  }

  const csrfToken = session?.csrfToken ?? "";
  const ownedPlans = deletionReview?.ownedPlans ?? [];
  const deletionReady = Boolean(deletionReview)
    && ownedPlans.every((plan) => Boolean(dispositions[plan.id]))
    && deletionConfirmed;
  const title = page === "account" ? "Account" : "Settings";
  if (loading) return <section className="public-panel public-account-panel" role="status">Loading account settings…</section>;

  return <section className="public-panel public-account-panel">
    <header><div><p className="public-eyebrow">Claim Monitor</p><h1>{title}</h1></div>{session?.user?.avatarUrl ? <img src={session.user.avatarUrl} alt="" /> : <UserRound size={30} />}</header>
    {message ? <p className="public-account-message" role="status">{message}</p> : null}

    {!session?.user ? <div className="public-account-section">
      <h2>Sign in</h2>
      <p>Use a separate Claim Monitor account for saved plans and settings. Discord OAuth requests the identify scope only.</p>
      <label className="public-check"><input type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} /> I accept the <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</label>
      <label className="public-check"><input type="checkbox" checked={ageConfirmed} onChange={(event) => setAgeConfirmed(event.target.checked)} /> I confirm I am at least {policy?.operator.minimumAge ?? 18} years old.</label>
      <button className="toolbar-button primary" disabled={!session?.discordLoginEnabled || !acceptedTerms || !ageConfirmed || busy === "login"} onClick={() => void signIn()}><LogIn size={16} /> Sign in with Discord</button>
      {!session?.discordLoginEnabled ? <p>Public sign-in is not enabled yet.</p> : null}
    </div> : <>
      <div className="public-account-section">
        <h2>{session.user.globalName || session.user.username}</h2>
        <p>@{session.user.username} · Discord ID {session.user.discordId}</p>
        <div className="public-account-actions">
          <a className="toolbar-button" href="/api/public/auth/privacy/export"><Download size={16} /> Download my data</a>
          <button className="toolbar-button" disabled={!csrfToken || busy === "logout"} onClick={() => void perform("logout", async () => { await logoutPublicSession(csrfToken); setSession({ ...session, user: null, csrfToken: null }); })}><LogOut size={16} /> Sign out</button>
        </div>
      </div>

      {session.legal.requiresAcceptance ? <div className="public-account-section is-warning">
        <h2>Accept the current documents</h2>
        <p>Review the current <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a> before continuing with signed-in features.</p>
        <label className="public-check"><input type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} /> I accept the current documents.</label>
        <label className="public-check"><input type="checkbox" checked={ageConfirmed} onChange={(event) => setAgeConfirmed(event.target.checked)} /> I confirm I am at least {policy?.operator.minimumAge ?? 18} years old.</label>
        <button className="toolbar-button primary" disabled={!acceptedTerms || !ageConfirmed || busy === "legal"} onClick={() => void perform("legal", async () => setSession(await acceptPublicLegal(csrfToken)))}><ShieldCheck size={16} /> Accept the current documents</button>
      </div> : null}

      <div className="public-account-section">
        <h2>Privacy &amp; data</h2>
        <p>Download an export at any time. Account-deletion review requires a fresh sign-in with the same Discord account.</p>
        <div className="public-account-actions">
          <button className="toolbar-button" disabled={!csrfToken || busy === "reauth"} onClick={() => void perform("reauth", async () => { const response = await startPublicPrivacyReauthentication(csrfToken); window.location.assign(response.authorizeUrl); })}><ShieldCheck size={16} /> Reauthenticate with Discord</button>
          <button className="toolbar-button danger" disabled={!csrfToken || busy === "delete-review"} onClick={() => void perform("delete-review", async () => { const result = await reviewPublicDeletion(csrfToken); setDeletionReview(result); setDispositions({}); setDeletionConfirmed(false); setMessage(result.planDispositionReviewRequired ? "Recent sign-in confirmed. Choose what happens to every owned plan." : "Recent sign-in confirmed. Review the permanent deletion below."); })}>Review account deletion</button>
        </div>
        {deletionReview ? <div className="public-deletion-review">
          <h3>Owned plan dispositions</h3>
          {ownedPlans.length ? ownedPlans.map((plan) => <label key={plan.id}>
            <span><strong>{plan.title}</strong> · Claim #{plan.claimId}</span>
            <select aria-label={`Disposition for ${plan.title}`} value={dispositions[plan.id] ?? ""} onChange={(event) => setDispositions((current) => ({ ...current, [plan.id]: event.target.value }))}>
              <option value="">Choose an action</option>
              <option value="delete">Permanently delete plan</option>
              {plan.acceptedEditors.map((editor) => <option key={editor.userId} value={`transfer:${editor.userId}`}>Transfer to accepted editor · {editor.globalName || editor.username || editor.userId}</option>)}
            </select>
          </label>) : <p>This account owns no plans.</p>}
          <label className="public-check"><input type="checkbox" checked={deletionConfirmed} onChange={(event) => setDeletionConfirmed(event.target.checked)} /> I understand this permanently deletes the public Claim Monitor account and any plans marked for deletion.</label>
          <button className="toolbar-button danger" disabled={!deletionReady || busy === "delete-account"} onClick={() => void perform("delete-account", async () => {
            const selected = ownedPlans.map((plan) => {
              const value = dispositions[plan.id];
              if (value === "delete") return { planId: plan.id, action: "delete" as const };
              return { planId: plan.id, action: "transfer" as const, userId: Number(value.split(":")[1]) };
            });
            const receipt = await deletePublicAccountProfile(selected, csrfToken);
            setDeletionReview(null);
            setSession({ ...session, user: null, csrfToken: null });
            setMessage(`Claim Monitor account deleted. Receipt ${receipt.receiptId}.`);
          })}>Delete Claim Monitor account</button>
        </div> : null}
        <p>Questions or rights requests: <a href="mailto:privacy@claim-monitor.com">privacy@claim-monitor.com</a>.</p>
      </div>
    </>}
  </section>;
}
