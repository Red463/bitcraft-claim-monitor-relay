export const LEGAL_VERSION = "2026-07-31";
export const LEGAL_EFFECTIVE_DATE = "2026-07-31";

export const defaultLegalOperator = Object.freeze({
  controllerName: "Thomas Bush",
  projectName: "Timbersteel Claim Monitor",
  privacyEmail: "privacy@timbersteeltrade.com",
  controllerCountry: "United Kingdom",
  governingLaw: "England and Wales",
  minimumAge: 18,
  status: "Timbersteel Claim Monitor is operated by Thomas Bush.",
});

const providerDefinitions = Object.freeze([
  {
    key: "hostworld",
    name: "HostWorld",
    role: "UK virtual private server and database hosting provider",
    data: "Application database, server logs, encrypted backups where configured, and operational files.",
    location: "United Kingdom",
  },
  {
    key: "namecheap",
    name: "Namecheap",
    role: "Domain registrar and DNS provider",
    data: "Domain and DNS configuration; it is not described as the application database host.",
    location: "Provider locations described in Namecheap's privacy information.",
  },
  {
    key: "discord",
    name: "Discord",
    role: "OAuth identity, bot, direct-message, guild, and community platform",
    data: "Discord identity, guild interactions, bot commands, notifications, and moderation data.",
    location: "International processing under Discord's terms and privacy policy.",
  },
  {
    key: "bitcraft-relay",
    name: "BitCraft Relay",
    role: "Current public BitCraft game-data relay",
    data: "Public BitCraft game, character, settlement, inventory, market, and activity information requested by the app server.",
    location: "The Relay operator and infrastructure locations have not been published to this app; processing may occur outside the United Kingdom.",
  },
  {
    key: "proton",
    name: "Proton",
    role: "Email service for privacy and support correspondence",
    data: "Email addresses, message content, attachments, and correspondence records.",
    location: "Switzerland and other locations described by Proton.",
  },
  {
    key: "buy-me-a-coffee",
    name: "Buy Me a Coffee / Publisherr Inc.",
    role: "Optional external contribution service",
    data: "Donation and supporter information made available through that service; the app does not collect card details.",
    location: "International processing under Buy Me a Coffee's terms and privacy policy.",
  },
  {
    key: "github",
    name: "GitHub",
    role: "Source-code, issue, release, and deployment-workflow provider",
    data: "Repository activity and technical deployment metadata, not ordinary app account content by design.",
    location: "International processing under GitHub's privacy statement.",
  },
]);

const retentionRules = Object.freeze([
  { key: "account-data", label: "Discord account, preferences, character link, and acceptance", rule: "While active; delete after 24 months without login", months: 24 },
  { key: "user-sessions", label: "User sessions", rule: "30 days", days: 30 },
  { key: "admin-sessions", label: "Administrator sessions", rule: "7 days", days: 7 },
  { key: "market-watches", label: "Market watches", rule: "Until the user removes them or deletes the account" },
  { key: "market-alerts", label: "Market alert history", rule: "180 days", days: 180 },
  { key: "assignment-audit", label: "Character-assignment and administrator audit", rule: "12 months; identifiers are scrubbed sooner on account deletion", months: 12 },
  { key: "moderation", label: "Moderation records", rule: "While active and normally 12 months after closure, then delete or anonymise", months: 12 },
  { key: "discord-delivery", label: "Discord delivery diagnostics", rule: "90 days or the latest 250 entries, whichever is sooner", days: 90, maximumRows: 250 },
  { key: "discord-interactions", label: "Poll, RSVP, vote, and temporary interaction records", rule: "90 days after the event or interaction", days: 90 },
  { key: "analytics-events", label: "Optional analytics events", rule: "90 days", days: 90 },
  { key: "analytics-identifiers", label: "Analytics consent and browser identifiers", rule: "180 days unless withdrawn sooner", days: 180 },
  { key: "full-ip", label: "Full IP address in security logs", rule: "7 days", days: 7 },
  { key: "security-anonymised", label: "Hashed or anonymised security records", rule: "180 days", days: 180 },
  { key: "craft-audit", label: "Craft Planner audit history", rule: "14 days", days: 14 },
  { key: "empire-membership", label: "Empire membership history", rule: "365 days", days: 365 },
  { key: "server-health", label: "Server-health diagnostics", rule: "7 days", days: 7 },
  { key: "privacy-correspondence", label: "Privacy correspondence", rule: "24 months, unless a dispute or legal obligation requires longer", months: 24 },
  { key: "daily-backups", label: "Daily encrypted backups", rule: "7 recovery points, normally about 7 days", days: 7, maximumRows: 7 },
  { key: "migration-backups", label: "Migration and manual encrypted backups", rule: "3 of each class and no more than 90 days", days: 90, maximumRows: 3 },
  { key: "deletion-ledger", label: "HMAC deletion-restoration ledger", rule: "90 days", days: 90 },
  { key: "inactive-accounts", label: "Inactive accounts", rule: "Delete after 24 months without login, with a warning about 30 days before", months: 24 },
]);

function configuredValue(env, key, fallback) {
  return env?.[key] === undefined ? fallback : String(env[key]).trim();
}

function validatedOperator(env) {
  const operator = {
    controllerName: configuredValue(env, "LEGAL_CONTROLLER_NAME", defaultLegalOperator.controllerName),
    projectName: configuredValue(env, "LEGAL_PROJECT_NAME", defaultLegalOperator.projectName),
    privacyEmail: configuredValue(env, "LEGAL_PRIVACY_EMAIL", defaultLegalOperator.privacyEmail),
    controllerCountry: configuredValue(env, "LEGAL_CONTROLLER_COUNTRY", defaultLegalOperator.controllerCountry),
    governingLaw: configuredValue(env, "LEGAL_GOVERNING_LAW", defaultLegalOperator.governingLaw),
    minimumAge: Number(configuredValue(env, "LEGAL_MINIMUM_AGE", defaultLegalOperator.minimumAge)),
  };
  if (!operator.controllerName) throw new Error("Legal controller name is required");
  if (!operator.projectName) throw new Error("Legal project name is required");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(operator.privacyEmail)) throw new Error("A valid legal privacy email is required");
  if (!operator.controllerCountry) throw new Error("Legal controller country is required");
  if (!operator.governingLaw) throw new Error("Legal governing law is required");
  if (!Number.isInteger(operator.minimumAge) || operator.minimumAge < 18 || operator.minimumAge > 120) {
    throw new Error("Legal minimum age must be an integer of at least 18");
  }
  const status = `${operator.projectName} is operated by ${operator.controllerName}.`;
  return Object.freeze({ ...operator, status });
}

function termsSections(operator) {
  const project = operator.projectName;
  return [
    {
      id: "operator",
      title: "Operator and status",
      paragraphs: [
        operator.status,
        `${project} is unofficial and is not affiliated with Clockwork Labs, BitCraft, BitCraft Relay, Discord, HostWorld, Namecheap, Proton, GitHub, or Buy Me a Coffee.`,
      ],
    },
    {
      id: "eligibility",
      title: "Eligibility",
      paragraphs: [
        `You must be at least ${operator.minimumAge} years old to use ${project}. The service is made available worldwide, but you are responsible for complying with laws and platform rules that apply to you.`,
      ],
    },
    {
      id: "accounts-and-sessions",
      title: "Anonymous use, Discord accounts, and sessions",
      paragraphs: [
        "Some public pages work without an account. Signed-in features use Discord OAuth and may store your Discord ID, profile details, sessions, preferences, and acceptance record.",
        "You must protect access to your Discord account, provide accurate information, and tell the operator promptly if you believe your app access is being misused.",
      ],
    },
    {
      id: "character-linking",
      title: "Character linking",
      paragraphs: [
        "You may request a BitCraft character link. An authorised administrator may also assign and immediately approve a character for your Discord login when reasonably needed to operate the community service.",
        "An administrator assignment is blocked unless the app can first send your Discord account a direct notice. You can unlink the character or delete your app account from Privacy & Data. A character already approved for one Discord account cannot be assigned to another until it is unassigned.",
      ],
    },
    {
      id: "discord-and-app-features",
      title: "Discord, game-data, and app features",
      paragraphs: [
        `${project} may provide Discord bot commands, notifications, guild tools, role management, moderation, polls, events, diagnostics, market watches, alerts, production tools, history, analytics, backups, and administration.`,
        "BitCraft Relay provides current public game data, completed-sale evidence, and live craft-contribution events.",
        "BitCraft information may be public, delayed, partial, unavailable, or inaccurate. Calculations and estimates are operational aids, not guaranteed facts.",
      ],
    },
    {
      id: "acceptable-use",
      title: "Acceptable use",
      paragraphs: ["You must use the service lawfully and in a way that does not harm other people, the service, Discord, BitCraft, or connected providers."],
      bullets: [
        "Do not impersonate another person or submit a knowingly false character link.",
        "Do not bypass access controls or attack, overload, probe, scrape, or disrupt the service.",
        "Do not misuse Discord, BitCraft, or another person's identifiers or personal information.",
        "Do not abuse bot, moderation, notification, administrator, poll, or event functions.",
        "Do not submit unlawful, infringing, deceptive, malicious, or harmful content.",
      ],
    },
    {
      id: "suspension-and-termination",
      title: "Suspension and termination",
      paragraphs: [
        "Access may be restricted for security, abuse prevention, Discord or community moderation, operational, or legal reasons. Where appropriate, you will receive a reason and may request review.",
        "You may stop using the service, unlink your character, or delete your ordinary app account using the available self-service controls. An authorised administrator may also delete the ordinary app account to action an assisted deletion request or where reasonably necessary for security, abuse prevention, legal compliance, or operation of the service.",
        "Deleting an ordinary app account does not remove Discord server membership or a separately authorised administrator identity. The app attempts a Discord direct notice after administrator-assisted deletion, but delivery failure does not undo the deletion.",
      ],
    },
    {
      id: "intellectual-property",
      title: "Intellectual property and trademarks",
      paragraphs: [
        `The ${project} code and original presentation remain subject to their applicable ownership and licence terms. BitCraft, BitCraft Relay, Discord, provider names, game assets, and third-party content belong to their respective owners.`,
      ],
    },
    {
      id: "third-party-services",
      title: "Third-party services",
      paragraphs: [
        "Discord, BitCraft Relay, hosting, domain, email, source-code, and donation services operate under their own terms and privacy policies. The operator does not control their independent availability or processing.",
      ],
    },
    {
      id: "donations",
      title: "Free service and optional donations",
      paragraphs: [
        `${project} is free. The optional Buy Me a Coffee link is a voluntary contribution and creates no subscription, paid entitlement, service level, ownership interest, priority support, or right to influence the project. Payment details are handled by Buy Me a Coffee and its payment providers.`,
      ],
    },
    {
      id: "availability",
      title: "Changes and availability",
      paragraphs: [
        "The service may change, pause, or end and is not guaranteed to be uninterrupted. Reasonable care is taken, but third-party data and derived estimates may be incomplete, delayed, unavailable, or wrong. Do not rely on the app as the sole source for important settlement or financial decisions.",
      ],
    },
    {
      id: "liability",
      title: "Fair liability terms",
      paragraphs: [
        "To the extent permitted by law, the operator is not responsible for losses caused solely by your misuse, unauthorised third-party conduct, or matters genuinely outside reasonable control.",
        "Nothing in these Terms excludes or limits liability for death or personal injury caused by negligence, fraud, deliberate wrongdoing, data-protection duties, mandatory consumer rights, or any liability that cannot lawfully be excluded or limited.",
      ],
    },
    {
      id: "complaints",
      title: "Questions, complaints, and review",
      paragraphs: [
        `Contact ${operator.privacyEmail} for legal/privacy questions or to request review of an access decision. Privacy complaints may also be made to the UK Information Commissioner's Office.`,
      ],
    },
    {
      id: "changes",
      title: "Changes to these Terms",
      paragraphs: [
        "Material changes receive a new legal version. Signed-in users will be asked to accept the current version before continuing to account features.",
      ],
    },
    {
      id: "general-terms",
      title: "General terms",
      paragraphs: [
        "If one term is unenforceable, the remaining terms continue. A delay in enforcing a term is not a waiver. You may not transfer your rights under these Terms without consent; the operator may transfer operation only with appropriate notice and protection. These Terms and the Privacy Policy record the agreement about the service, subject to rights that law does not allow either party to exclude.",
      ],
    },
    {
      id: "governing-law",
      title: "Governing law",
      paragraphs: [
        `These Terms are governed by the law of ${operator.governingLaw}. Mandatory rights and any court rights you have where you live are not removed.`,
      ],
    },
  ];
}

function privacySections(operator) {
  const project = operator.projectName;
  return [
    {
      id: "controller",
      title: "Controller",
      paragraphs: [
        `${operator.controllerName}, based in ${operator.controllerCountry}, is the controller for the personal data described here. Contact: ${operator.privacyEmail}.`,
      ],
    },
    {
      id: "data-we-process",
      title: "Personal data we process",
      paragraphs: [
        "Depending on the features you use, this includes Discord ID and profile data, sessions, settings, legal acceptance, character links, market watches and alerts, bot/guild interactions, role and moderation records, votes and RSVPs, delivery diagnostics, security logs, optional analytics, and privacy correspondence.",
        "Public BitCraft game and settlement data obtained through BitCraft Relay may become personal data in context when it is linked to a Discord account or community activity. Special-category data is not intentionally requested.",
      ],
    },
    {
      id: "lawful-bases",
      title: "Purposes and lawful bases",
      paragraphs: [
        "Contract is used to provide requested accounts, settings, exports, watches, alerts, and other signed-in features. Consent is used for optional analytics and can be withdrawn.",
        "Legitimate interests support secure operation, abuse prevention, proportionate community administration, necessary character linking, diagnostics, and moderation, after balancing those purposes against user rights. Legal obligation is used where records must be handled to meet law, rights requests, or disputes.",
      ],
    },
    {
      id: "character-linking",
      title: "Character linking and administrator assignment",
      paragraphs: [
        "Character ID, name, status, Discord account, assignment administrator, and audit/delivery results are processed to associate community access with the correct public game identity.",
        "An administrator assignment requires a current acceptance and a successful direct notice before the link is committed. Duplicate approved links are blocked. You may unlink or delete the account yourself, and failed removal notifications do not undo removal.",
      ],
    },
    {
      id: "discord-administration",
      title: "Discord administration and moderation",
      paragraphs: [
        "Guild IDs, Discord IDs, commands, roles, warnings, notes, cases, bans, polls, events, and delivery results may be processed to operate requested tools, maintain community safety, investigate abuse, and document proportionate moderation.",
      ],
    },
    {
      id: "analytics",
      title: "Optional analytics and cookies",
      paragraphs: [
        "Optional analytics use consent and are kept separate from Terms acceptance. Rejecting or withdrawing analytics does not block the service. Necessary session, security, consent-choice, and preference storage may still be used to provide and protect requested functions.",
      ],
    },
    {
      id: "sharing",
      title: "Service providers and disclosures",
      paragraphs: [
        "Data is shared only as needed with the providers listed below, where you direct a Discord action, to protect people or the service, to comply with law, or with your permission. The app server requests current public game data, completed-sale evidence, and craft-contribution events from BitCraft Relay. Discord API data is not sold or shared with game-data, donation, or advertising services.",
      ],
    },
    {
      id: "international-transfers",
      title: "International processing",
      paragraphs: [
        "The primary VPS/database arrangement is described as UK-hosted. BitCraft Relay may process data internationally; its operator and infrastructure locations have not been published to this app. Discord, GitHub, Buy Me a Coffee, Proton, Namecheap, and their providers may also process data internationally under their own safeguards and applicable transfer mechanisms.",
      ],
    },
    {
      id: "retention",
      title: "Retention",
      paragraphs: [
        "Data is kept only for the periods or criteria in the retention table below. Shorter deletion applies when you use self-service controls, except where a limited record must be anonymised or retained for security, legal, or dispute reasons.",
      ],
    },
    {
      id: "rights",
      title: "Your rights",
      paragraphs: [
        `Depending on applicable law, you may request access, correction, deletion, restriction, portability, or object to processing, and you may withdraw consent. Use Privacy & Data or email ${operator.privacyEmail}. An authorised administrator can carry out an assisted account deletion where appropriate. Identity checks use only what is reasonably necessary. Requests are normally answered within one month.`,
        "There is no solely automated decision-making that produces legal or similarly significant effects.",
      ],
    },
    {
      id: "deletion-and-backups",
      title: "Deletion, backups, and inactive accounts",
      paragraphs: [
        "Self-service tools can export data, unlink a character, clear preferences, remove market data, withdraw analytics consent, and delete an ordinary app account after recent Discord reauthentication.",
        "An authorised administrator can delete an ordinary app account through the same protected deletion process. This removes associated live app data, including specific-user access-list entries, preserves any separate administrator identity and Discord server membership, and retains only de-identified or pseudonymised records where required. A Discord direct notice is attempted after completion; failure to deliver it does not restore the data.",
        "Live data is removed immediately. Restricted encrypted backups expire within their stated windows. A separate HMAC deletion-restoration ledger, containing no plaintext identity, is replayed before a restored database goes public so an older backup does not restore a deleted account.",
        "Accounts inactive for 24 months are deleted after a warning attempt about 30 days beforehand. Delivery failure does not extend retention.",
      ],
    },
    {
      id: "security",
      title: "Security",
      paragraphs: [
        "Controls include restricted sessions and administrator routes, same-origin and CSRF checks, rate limits, access logging, data minimisation, encrypted application backups, restricted keys, HMAC deletion records, and tested restore procedures. No internet service can promise absolute security.",
      ],
    },
    {
      id: "complaints",
      title: "Complaints",
      paragraphs: [
        `Contact ${operator.privacyEmail} first if you can. You may also complain to the UK Information Commissioner's Office or the data-protection authority available to you.`,
      ],
    },
    {
      id: "contact",
      title: "Contact and policy changes",
      paragraphs: [
        `Email ${operator.privacyEmail}. Material policy changes receive a new version/effective date and signed-in users are prompted on their next visit.`,
      ],
    },
  ];
}

export function legalPolicyForEnvironment(env = {}) {
  if (String(env?.NODE_ENV ?? "").toLowerCase() === "production" && String(env?.LEGAL_CONFIGURATION_CONFIRMED ?? "").toLowerCase() !== "true") {
    throw new Error("Production requires LEGAL_CONFIGURATION_CONFIRMED=true after reviewing the published legal identity");
  }
  const operator = validatedOperator(env);
  return Object.freeze({
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    operator,
    supportUrl: "https://buymeacoffee.com/tom.bush",
    providers: providerDefinitions.map((provider) => ({ ...provider })),
    retention: retentionRules.map((rule) => ({ ...rule })),
    terms: {
      title: "Terms of Service",
      sections: termsSections(operator),
    },
    privacy: {
      title: "Privacy Policy",
      sections: privacySections(operator),
    },
    notice: "These documents describe this service and are not legal advice to users or other operators.",
  });
}

export const CLAIM_MONITOR_LEGAL_VERSION = "2026-08-26";
export const CLAIM_MONITOR_LEGAL_EFFECTIVE_DATE = "2026-08-26";

const claimMonitorProviders = Object.freeze([
  {
    key: "hostworld",
    name: "HostWorld",
    role: "UK virtual private server and database hosting provider",
    data: "Public app accounts, sessions, plans, legal records, security logs, backups, and operational files.",
    location: "United Kingdom",
  },
  {
    key: "discord",
    name: "Discord",
    role: "OAuth identity provider",
    data: "Discord ID, username, global display name, avatar, authorization code, and short-lived access token used for sign-in or recent reauthentication.",
    location: "International processing under Discord's terms and privacy policy.",
  },
  {
    key: "bitcraft-relay",
    name: "BitCraft Relay",
    role: "Public BitCraft game-data relay",
    data: "Claim and catalog lookups requested while a user searches, opens a page, or refreshes visible data.",
    location: "The Relay operator and infrastructure locations have not been published to this app; processing may occur outside the United Kingdom.",
  },
  {
    key: "proton",
    name: "Proton",
    role: "Email service for privacy correspondence",
    data: "Email addresses, message content, attachments, and correspondence records.",
    location: "Switzerland and other locations described by Proton.",
  },
]);

const claimMonitorRetention = Object.freeze([
  { key: "account", label: "Discord account profile, settings, and legal acceptance", rule: "Until account deletion" },
  { key: "inactive-account", label: "Inactive public accounts", rule: "Purge-eligible after 24 months without login only when there is no owned plan and no accepted editor membership; viewer-only memberships do not exempt the account and are removed during purge", months: 24 },
  { key: "sessions", label: "Signed-in sessions", rule: "30 days", days: 30 },
  { key: "reauthentication", label: "Recent deletion reauthentication", rule: "10 minutes", days: 0 },
  { key: "plans", label: "Saved plans and their memberships", rule: "Until the owner deletes or transfers them, or deletes the account after choosing each plan's disposition" },
  { key: "bearer-links", label: "Bearer links", rule: "Until expiry, revocation, plan deletion, or account deletion, whichever occurs first" },
  { key: "full-ip", label: "Full IP address in security logs", rule: "7 days", days: 7 },
  { key: "security-anonymised", label: "Hashed or anonymised security logs", rule: "180 days", days: 180 },
  { key: "exports", label: "Generated account exports", rule: "Returned to the requester and not retained as a separate server file" },
  { key: "privacy-correspondence", label: "Privacy correspondence", rule: "24 months unless a dispute or legal obligation requires longer", months: 24 },
  { key: "backups", label: "Restricted encrypted backups", rule: "According to the published server backup rotation, normally no more than 90 days" },
  { key: "deletion-ledger", label: "Pseudonymous deletion-restoration receipts", rule: "90 days", days: 90 },
]);

function claimMonitorTermsSections(operator) {
  return [
    {
      id: "operator",
      title: "Operator and status",
      paragraphs: [operator.status, "BitCraft Claim Monitor is unofficial and is not affiliated with Clockwork Labs, BitCraft, BitCraft Relay, or Discord."],
    },
    {
      id: "accounts",
      title: "Anonymous use and Discord OAuth accounts",
      paragraphs: [
        "Public claim lookups work without an account. Optional signed-in features use Discord OAuth with the identify scope only and store a separate Claim Monitor account and session.",
        `You must be at least ${operator.minimumAge} years old and protect access to the Discord account used to sign in.`,
      ],
    },
    {
      id: "relay",
      title: "Public game-data lookups",
      paragraphs: [
        "BitCraft Relay supplies public claim and catalog results when you search, open a claim page, refresh visible data, or use a plan feature. Results may be delayed, partial, unavailable, or inaccurate and are not guaranteed facts.",
      ],
    },
    {
      id: "plans-and-links",
      title: "Plans and bearer links",
      paragraphs: [
        "Signed-in users may create plans and choose to share selected plan access through bearer links. Anyone holding a valid bearer link can use the access it grants until it expires or is revoked, so you must protect and revoke links as appropriate.",
      ],
    },
    {
      id: "acceptable-use",
      title: "Acceptable use",
      paragraphs: ["Do not bypass access controls, misuse another person's identifiers or bearer links, overload the service, or submit unlawful or harmful content."],
    },
    {
      id: "availability",
      title: "Availability and liability",
      paragraphs: [
        "The free service may change, pause, or end. Nothing excludes liability that cannot lawfully be excluded, including data-protection duties and mandatory consumer rights.",
      ],
    },
    {
      id: "changes",
      title: "Changes and contact",
      paragraphs: [`Material changes receive a new legal version. Contact ${operator.privacyEmail} with legal or privacy questions.`],
    },
    {
      id: "law",
      title: "Governing law",
      paragraphs: [`These Terms are governed by the law of ${operator.governingLaw}, without removing mandatory rights available where you live.`],
    },
  ];
}

function claimMonitorPrivacySections(operator) {
  return [
    {
      id: "controller",
      title: "Controller",
      paragraphs: [`${operator.controllerName}, based in ${operator.controllerCountry}, is the controller. Contact ${operator.privacyEmail}.`],
    },
    {
      id: "data",
      title: "Personal data we process",
      paragraphs: [
        "An optional Discord OAuth account contains Discord ID, username, global display name, avatar, sessions, settings, legal acceptance, saved plans, plan membership, bearer links, exports requested, recent reauthentication, and deletion records.",
        "Requests may also produce security logs containing IP address, hashed or anonymised network identifiers, request details, and user-agent hashes. Public BitCraft Relay lookups can become personal data in context when saved in a plan or associated with an account.",
      ],
    },
    {
      id: "purposes",
      title: "Purposes and lawful bases",
      paragraphs: [
        "Contract is used to provide requested accounts, sessions, settings, plans, bearer links, exports, and deletion controls. Legitimate interests support proportionate security logging, abuse prevention, diagnostics, and reliable restore safeguards. Legal obligation applies to rights requests and disputes where required.",
      ],
    },
    {
      id: "sharing",
      title: "Providers and international processing",
      paragraphs: [
        "Data is shared only as needed with the providers listed below, to follow your request, protect the service, comply with law, or with your permission. Discord receives the OAuth exchange; BitCraft Relay receives public lookup requests without the Claim Monitor session cookie.",
      ],
    },
    {
      id: "cookies",
      title: "Necessary cookies",
      paragraphs: [
        "Secure HttpOnly cookies hold the Claim Monitor session, OAuth state, and short recent-reauthentication proof. They are necessary for the requested account flow. Optional feedback widgets and usage measurement are not enabled on the public profile.",
      ],
    },
    {
      id: "retention",
      title: "Retention",
      paragraphs: ["The retention table below states the applicable periods or events. Data is removed sooner when a valid deletion request applies, except for limited security, legal, backup, or restore-integrity records."],
    },
    {
      id: "exports-and-deletion",
      title: "Exports, reauthentication, and deletion",
      paragraphs: [
        "A signed-in user can download an account export. Account deletion requires recent reauthentication with the same Discord account and a preflight that identifies the required disposition of owned plans before deletion can complete.",
        "Deletion removes the public Claim Monitor account and associated live public-profile data according to the chosen plan dispositions. It does not delete Discord membership, create or remove an administrator in another service, alter an account in another service, or delete data held independently by providers. Restricted backup copies expire under the backup rotation, and pseudonymous restore receipts prevent deleted public data from silently returning.",
      ],
    },
    {
      id: "rights",
      title: "Your rights",
      paragraphs: [`Depending on applicable law, you may request access, correction, deletion, restriction, portability, or object to processing. Use the account settings or email ${operator.privacyEmail}. Requests are normally answered within one month.`],
    },
    {
      id: "security",
      title: "Security",
      paragraphs: ["Controls include separate public identity tables and cookies, signed OAuth state, same-origin and CSRF checks, short recent reauthentication, rate limits, restricted secrets, encrypted backups, and restore safeguards. No internet service can promise absolute security."],
    },
    {
      id: "complaints",
      title: "Complaints and changes",
      paragraphs: [`Contact ${operator.privacyEmail}. You may also complain to the UK Information Commissioner's Office or another data-protection authority available to you. Material changes receive a new version and effective date.`],
    },
  ];
}

export function claimMonitorLegalPolicyForEnvironment(env = {}) {
  if (String(env?.NODE_ENV ?? "").toLowerCase() === "production"
    && String(env?.PUBLIC_PROFILE_ENABLED ?? "").toLowerCase() === "true"
    && String(env?.PUBLIC_LEGAL_CONFIGURATION_CONFIRMED ?? "").toLowerCase() !== "true") {
    throw new Error("Production requires PUBLIC_LEGAL_CONFIGURATION_CONFIRMED=true after reviewing the Claim Monitor legal documents");
  }
  const operator = validatedOperator({
    ...env,
    LEGAL_PROJECT_NAME: "BitCraft Claim Monitor",
    LEGAL_PRIVACY_EMAIL: "privacy@claim-monitor.com",
  });
  return Object.freeze({
    version: CLAIM_MONITOR_LEGAL_VERSION,
    effectiveDate: CLAIM_MONITOR_LEGAL_EFFECTIVE_DATE,
    operator,
    supportUrl: "",
    providers: claimMonitorProviders.map((provider) => ({ ...provider })),
    retention: claimMonitorRetention.map((rule) => ({ ...rule })),
    terms: { title: "Terms of Service", sections: claimMonitorTermsSections(operator) },
    privacy: { title: "Privacy Policy", sections: claimMonitorPrivacySections(operator) },
    notice: "These documents describe BitCraft Claim Monitor and are not legal advice to users or other operators.",
  });
}
