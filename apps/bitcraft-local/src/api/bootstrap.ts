import type { PublicLegalPolicy } from "../components/main/LegalAcceptanceDialog";
import type { AppSettings, UserAuthState } from "../types/settings";

export type BootstrapConfig = Partial<AppSettings> & Pick<AppSettings, "claimId" | "refreshSeconds">;
export type BootstrapAuth = UserAuthState & { authenticated: boolean };
export type BootstrapLegal = PublicLegalPolicy & {
  acceptanceRequired: boolean;
  termsDigest?: string;
  privacyDigest?: string;
};
export type BootstrapPayload = {
  config: BootstrapConfig;
  auth: BootstrapAuth;
  legal: BootstrapLegal;
  build: { version: string; buildSha: string };
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function normalizeBootstrap(value: unknown): BootstrapPayload {
  const source = record(value);
  const config = record(source.config);
  const claimId = String(config.claimId ?? "").trim();
  if (!/^\d+$/.test(claimId)) throw new Error("Bootstrap config did not include a valid claim ID.");

  const auth = record(source.auth);
  const authLegal = record(auth.legal);
  const legal = record(source.legal);
  const operator = record(legal.operator);
  const build = record(source.build);
  const refreshSeconds = Number(config.refreshSeconds);

  return {
    config: {
      ...config,
      claimId,
      refreshSeconds: Number.isFinite(refreshSeconds) ? refreshSeconds : 30,
    } as BootstrapConfig,
    auth: {
      authenticated: auth.authenticated === true,
      user: auth.user && typeof auth.user === "object" ? auth.user as BootstrapAuth["user"] : null,
      csrfToken: typeof auth.csrfToken === "string" ? auth.csrfToken : null,
      discordLoginEnabled: auth.discordLoginEnabled === true,
      legal: {
        version: String(authLegal.version ?? legal.version ?? ""),
        termsDigest: String(authLegal.termsDigest ?? legal.termsDigest ?? ""),
        privacyDigest: String(authLegal.privacyDigest ?? legal.privacyDigest ?? ""),
        acceptedAt: typeof authLegal.acceptedAt === "string" ? authLegal.acceptedAt : null,
        requiresAcceptance: authLegal.requiresAcceptance === true || legal.acceptanceRequired === true,
      },
    },
    legal: {
      ...legal,
      version: String(legal.version ?? ""),
      effectiveDate: String(legal.effectiveDate ?? ""),
      operator: {
        controllerName: String(operator.controllerName ?? ""),
        projectName: String(operator.projectName ?? ""),
        privacyEmail: String(operator.privacyEmail ?? ""),
        status: String(operator.status ?? ""),
        minimumAge: Number(operator.minimumAge) || 18,
      },
      acceptanceRequired: legal.acceptanceRequired === true,
      termsDigest: typeof legal.termsDigest === "string" ? legal.termsDigest : undefined,
      privacyDigest: typeof legal.privacyDigest === "string" ? legal.privacyDigest : undefined,
    },
    build: {
      version: String(build.version ?? ""),
      buildSha: String(build.buildSha ?? ""),
    },
  };
}

export async function loadBootstrap(
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<BootstrapPayload> {
  const response = await fetchImpl("/api/local/bootstrap", { cache: "no-store", signal });
  if (!response.ok) throw new Error(`Bootstrap request failed with HTTP ${response.status}.`);
  return normalizeBootstrap(await response.json());
}
