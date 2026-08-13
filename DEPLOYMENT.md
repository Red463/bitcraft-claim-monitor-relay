# Relay preview deployment

This runbook installs the standalone
`Red463/bitcraft-claim-monitor-relay` repository as a parallel preview at
`https://relay.timbersteeltrade.com`. It creates an isolated application,
fresh SQLite state, services, locks, backups, keys, and deployment account.
It does not copy production data and does not switch the production domain.

The maintained app remains running and untouched throughout this procedure.
Record the result of this check before and after each supervised bootstrap:

```sh
curl --fail --silent --show-error https://app.timbersteeltrade.com/api/local/health
```

## Locked preview identity

| Purpose | Value |
| --- | --- |
| Repository | `Red463/bitcraft-claim-monitor-relay` |
| GitHub environment and concurrency group | `relay-preview` |
| Updater | `/usr/local/bin/update-bitcraft-claim-monitor-relay` |
| Application | `/opt/bitcraft-claim-monitor-relay` |
| Data | `/var/lib/bitcraft-claim-monitor-relay` |
| Backups | `/var/backups/bitcraft-claim-monitor-relay` |
| Environment file | `/etc/bitcraft-claim-monitor-relay.env` |
| Key directory | `/etc/bitcraft-claim-monitor-relay` |
| Local health | `http://127.0.0.1:19430/api/local/health` |
| Public preview | `https://relay.timbersteeltrade.com` |

The updater keeps immutable releases under
`/opt/bitcraft-claim-monitor-relay/releases/<sha>` and atomically moves the
relative `current` symbolic link. Persistent data, configuration, keys, and
backups never live inside a release.

## Prerequisites

- Ubuntu with Node.js 24, Corepack, Git, Caddy, SQLite, `sudo`, `flock`, and
  systemd.
- A `bitcraft` runtime account.
- DNS for `relay.timbersteeltrade.com` pointing at the VPS.
- Ports 80 and 443 exposed through Caddy. The Relay process stays bound to
  `127.0.0.1:19430`.
- A reviewed full commit SHA reachable from the standalone repository's
  `origin/main`.

## Create isolated directories and keys

Run as root in a supervised session:

```sh
install -d -o bitcraft -g bitcraft -m 0755 /opt/bitcraft-claim-monitor-relay
install -d -o bitcraft -g bitcraft -m 0755 /opt/bitcraft-claim-monitor-relay/releases
install -d -o bitcraft -g bitcraft -m 0700 /opt/bitcraft-claim-monitor-relay/.ssh
install -d -o bitcraft -g bitcraft -m 0700 /var/lib/bitcraft-claim-monitor-relay
install -d -o bitcraft -g bitcraft -m 0700 /var/backups/bitcraft-claim-monitor-relay
install -d -o root -g bitcraft -m 0750 /etc/bitcraft-claim-monitor-relay
install -d -o root -g root -m 0755 /usr/local/lib/bitcraft-claim-monitor-relay

umask 077
openssl rand 32 | basenc --base64url | tr -d '=' \
  > /etc/bitcraft-claim-monitor-relay/backup-encryption.key
openssl rand 32 | basenc --base64url | tr -d '=' \
  > /etc/bitcraft-claim-monitor-relay/privacy-ledger.key
chown root:root /etc/bitcraft-claim-monitor-relay/backup-encryption.key
chmod 0600 /etc/bitcraft-claim-monitor-relay/backup-encryption.key
chown root:bitcraft /etc/bitcraft-claim-monitor-relay/privacy-ledger.key
chmod 0640 /etc/bitcraft-claim-monitor-relay/privacy-ledger.key
```

Use fresh keys. Do not reuse the maintained deployment's key directory.

## Bootstrap a read-only GitHub deploy key

The private standalone repository is fetched by the unprivileged `bitcraft`
account over SSH. Its checkout home is explicitly
`/opt/bitcraft-claim-monitor-relay`, regardless of the home recorded for that
Unix account. The maintained account home is not used or changed: do not create
or alter `/opt/bitcraft-claim-monitor/.ssh` or `/home/bitcraft/.ssh`.

Use a dedicated read-only GitHub deploy key; do not put a personal access token
in the remote URL. If an already-generated private checkout key has been
delivered through a secure channel and its public half is registered as this
repository's read-only deploy key, install it as follows:

```sh
install -d -o bitcraft -g bitcraft -m 0700 /opt/bitcraft-claim-monitor-relay/.ssh
install -o bitcraft -g bitcraft -m 0600 /secure/input/relay-checkout-key \
  /opt/bitcraft-claim-monitor-relay/.ssh/bitcraft-claim-monitor-relay-readonly
install -o bitcraft -g bitcraft -m 0644 /secure/input/relay-checkout-key.pub \
  /opt/bitcraft-claim-monitor-relay/.ssh/bitcraft-claim-monitor-relay-readonly.pub
```

Otherwise, generate the dedicated pair directly inside the Relay checkout
home:

```sh
sudo -u bitcraft env HOME=/opt/bitcraft-claim-monitor-relay sh -c '
  umask 077
  ssh-keygen -q -t ed25519 -N "" \
    -C bitcraft-claim-monitor-relay-readonly \
    -f /opt/bitcraft-claim-monitor-relay/.ssh/bitcraft-claim-monitor-relay-readonly
'
chown bitcraft:bitcraft \
  /opt/bitcraft-claim-monitor-relay/.ssh/bitcraft-claim-monitor-relay-readonly \
  /opt/bitcraft-claim-monitor-relay/.ssh/bitcraft-claim-monitor-relay-readonly.pub
chmod 0600 /opt/bitcraft-claim-monitor-relay/.ssh/bitcraft-claim-monitor-relay-readonly
chmod 0644 /opt/bitcraft-claim-monitor-relay/.ssh/bitcraft-claim-monitor-relay-readonly.pub
```

In `Red463/bitcraft-claim-monitor-relay`, open **Settings → Deploy keys**, add
the contents of the `.pub` file, and leave **Allow write access** unchecked.

Pin GitHub's Ed25519 host key before the first Git operation. Capture the key
to a private temporary file, print its fingerprint, and compare that
fingerprint through a trusted channel with GitHub's currently published SSH
key fingerprints. Do not install it if the fingerprint differs.

```sh
umask 077
GITHUB_HOST_KEYS="$(mktemp)"
ssh-keyscan -t ed25519 github.com >"$GITHUB_HOST_KEYS"
ssh-keygen -lf "$GITHUB_HOST_KEYS"
# Stop here and compare the displayed fingerprint with GitHub's published value.
install -o bitcraft -g bitcraft -m 0600 \
  "$GITHUB_HOST_KEYS" /opt/bitcraft-claim-monitor-relay/.ssh/known_hosts
rm -f "$GITHUB_HOST_KEYS"

install -o bitcraft -g bitcraft -m 0600 /dev/null \
  /opt/bitcraft-claim-monitor-relay/.ssh/config
sudo -u bitcraft env HOME=/opt/bitcraft-claim-monitor-relay \
  sh -c 'cat > /opt/bitcraft-claim-monitor-relay/.ssh/config <<EOF
Host github.com
  HostName github.com
  User git
  IdentityFile /opt/bitcraft-claim-monitor-relay/.ssh/bitcraft-claim-monitor-relay-readonly
  IdentitiesOnly yes
  StrictHostKeyChecking yes
  UserKnownHostsFile /opt/bitcraft-claim-monitor-relay/.ssh/known_hosts
EOF'
chmod 0600 \
  /opt/bitcraft-claim-monitor-relay/.ssh/config \
  /opt/bitcraft-claim-monitor-relay/.ssh/known_hosts
```

## Clone and prepare the initial immutable release

```sh
sudo -u bitcraft env HOME=/opt/bitcraft-claim-monitor-relay \
  GIT_SSH_COMMAND='ssh -F /opt/bitcraft-claim-monitor-relay/.ssh/config' git clone \
  git@github.com:Red463/bitcraft-claim-monitor-relay.git \
  /opt/bitcraft-claim-monitor-relay/source
sudo -u bitcraft env HOME=/opt/bitcraft-claim-monitor-relay \
  GIT_SSH_COMMAND='ssh -F /opt/bitcraft-claim-monitor-relay/.ssh/config' \
  git -C /opt/bitcraft-claim-monitor-relay/source fetch --prune origin main

REVISION="$(sudo -u bitcraft env HOME=/opt/bitcraft-claim-monitor-relay \
  GIT_SSH_COMMAND='ssh -F /opt/bitcraft-claim-monitor-relay/.ssh/config' \
  git -C /opt/bitcraft-claim-monitor-relay/source rev-parse origin/main)"
printf '%s\n' "$REVISION" | grep -Eq '^[0-9a-f]{40}$'
sudo -u bitcraft env HOME=/opt/bitcraft-claim-monitor-relay \
  GIT_SSH_COMMAND='ssh -F /opt/bitcraft-claim-monitor-relay/.ssh/config' \
  git -C /opt/bitcraft-claim-monitor-relay/source \
  merge-base --is-ancestor "$REVISION" origin/main
sudo -u bitcraft env HOME=/opt/bitcraft-claim-monitor-relay \
  GIT_SSH_COMMAND='ssh -F /opt/bitcraft-claim-monitor-relay/.ssh/config' \
  git -C /opt/bitcraft-claim-monitor-relay/source \
  worktree add --detach "/opt/bitcraft-claim-monitor-relay/releases/$REVISION" "$REVISION"

RELEASE="/opt/bitcraft-claim-monitor-relay/releases/$REVISION"
sudo -u bitcraft bash -lc \
  "cd '$RELEASE' && corepack pnpm install --frozen-lockfile"
sudo -u bitcraft bash -lc \
  "cd '$RELEASE' && corepack pnpm --filter @workspace/bitcraft-local test"
sudo -u bitcraft bash -lc \
  "cd '$RELEASE' && corepack pnpm --filter @workspace/bitcraft-local run build"
node --test "$RELEASE"/scripts/test/deploy-*.test.mjs
ln -s "releases/$REVISION" /opt/bitcraft-claim-monitor-relay/current
```

The preview starts with fresh SQLite state. Do not copy an existing database,
accounts, settings, secrets, notification history, or activity history into
`/var/lib/bitcraft-claim-monitor-relay`. The application creates its own
database on first start.

## Protected environment

Copy the non-secret template, then edit the installed file as root:

```sh
install -o root -g root -m 0600 \
  "$RELEASE/deploy/bitcraft-claim-monitor-relay.env.example" \
  /etc/bitcraft-claim-monitor-relay.env
sudoedit /etc/bitcraft-claim-monitor-relay.env
```

Keep Relay enabled and the preview in shadow mode. The web and worker units
also force `DISCORD_DELIVERY_MODE=record` and
`ENABLE_DISCORD_STARTUP=false` in `ExecStart`, after the environment file is
loaded. Conflicting environment-file values therefore cannot enable real
Discord delivery or startup messages.

Set `DISCORD_SANDBOX_CHANNEL_ID` only to a dedicated test channel. Authenticated
Admin manual tests may post to that exact sandbox channel with mentions
disabled. Automatic jobs, outbox delivery, DMs, command registration, and
gateway startup remain in record mode and cannot use the manual test exception.

Do not place private keys, bot tokens, OAuth secrets, or setup keys in Git,
release directories, workflow output, or shell history.

## Install the first updater, helpers, units, and timers

Validate only the Relay units:

```sh
systemd-analyze verify \
  "$RELEASE/deploy/bitcraft-claim-monitor-relay.service" \
  "$RELEASE/deploy/bitcraft-claim-monitor-relay-worker.service" \
  "$RELEASE/deploy/bitcraft-claim-monitor-relay-collector.service" \
  "$RELEASE/deploy/bitcraft-claim-monitor-relay-collector.timer" \
  "$RELEASE/deploy/bitcraft-claim-monitor-relay-backup.service" \
  "$RELEASE/deploy/bitcraft-claim-monitor-relay-backup.timer"
caddy validate --config "$RELEASE/deploy/Caddyfile.example"
bash -n "$RELEASE/deploy/update-bitcraft-claim-monitor-relay"
bash -n "$RELEASE/deploy/backup-bitcraft-claim-monitor-relay"
node --check "$RELEASE/deploy/backup-crypto.mjs"
node --check "$RELEASE/deploy/replay-privacy-deletions.mjs"
```

Install only Relay-named artifacts:

```sh
install -m 0755 "$RELEASE/deploy/update-bitcraft-claim-monitor-relay" /usr/local/bin/update-bitcraft-claim-monitor-relay
install -m 0755 "$RELEASE/deploy/backup-bitcraft-claim-monitor-relay" /usr/local/bin/backup-bitcraft-claim-monitor-relay
install -m 0755 "$RELEASE/deploy/backup-crypto.mjs" /usr/local/lib/bitcraft-claim-monitor-relay/backup-crypto.mjs
install -m 0755 "$RELEASE/deploy/replay-privacy-deletions.mjs" /usr/local/lib/bitcraft-claim-monitor-relay/replay-privacy-deletions.mjs
install -m 0644 "$RELEASE/deploy/bitcraft-claim-monitor-relay.service" /etc/systemd/system/
install -m 0644 "$RELEASE/deploy/bitcraft-claim-monitor-relay-worker.service" /etc/systemd/system/
install -m 0644 "$RELEASE/deploy/bitcraft-claim-monitor-relay-collector.service" /etc/systemd/system/
install -m 0644 "$RELEASE/deploy/bitcraft-claim-monitor-relay-collector.timer" /etc/systemd/system/
install -m 0644 "$RELEASE/deploy/bitcraft-claim-monitor-relay-backup.service" /etc/systemd/system/
install -m 0644 "$RELEASE/deploy/bitcraft-claim-monitor-relay-backup.timer" /etc/systemd/system/

systemctl daemon-reload
systemctl enable --now \
  bitcraft-claim-monitor-relay.service \
  bitcraft-claim-monitor-relay-worker.service \
  bitcraft-claim-monitor-relay-collector.timer \
  bitcraft-claim-monitor-relay-backup.timer
curl --fail --silent --show-error http://127.0.0.1:19430/api/local/health
```

## One-time supervised Caddy bootstrap

`deploy/Caddyfile.example` deliberately contains both the maintained route and
the Relay preview route so an operator can merge the preview beside production.
It is a validation/reference file, not a replacement for the live
configuration.

Routine deployment must not copy `Caddyfile.example` to
`/etc/caddy/Caddyfile`. The updater validates the tracked example but never
installs it or reloads Caddy.

For the one-time supervised Caddy bootstrap:

1. Save a root-only copy of the live configuration.
2. Manually merge only the `relay.timbersteeltrade.com` site block from the
   reviewed release into the live file.
3. Inspect the diff and confirm the maintained site block is unchanged.
4. Validate before reloading.

```sh
install -o root -g root -m 0600 \
  /etc/caddy/Caddyfile \
  /root/Caddyfile.before-relay-preview
sudoedit /etc/caddy/Caddyfile
caddy fmt --diff /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
curl --fail --silent --show-error https://relay.timbersteeltrade.com/api/local/health
curl --fail --silent --show-error https://app.timbersteeltrade.com/api/local/health
```

If validation or either health check fails, restore the saved Caddy file,
validate it, and reload Caddy. This is the only step that changes the shared
proxy configuration.

## Restricted deployment account

Create a password-locked account used only by the workflow:

```sh
adduser --disabled-password --gecos "" --shell /bin/bash relay-deploy
passwd --lock relay-deploy
install -d -o relay-deploy -g relay-deploy -m 0700 /home/relay-deploy/.ssh
install -o relay-deploy -g relay-deploy -m 0600 /dev/null /home/relay-deploy/.ssh/authorized_keys
```

Add the deployment public key to `authorized_keys` with OpenSSH's `restrict`
option:

```txt
restrict ssh-ed25519 REPLACE_WITH_DEPLOYMENT_PUBLIC_KEY relay-preview
```

Allow only the root-owned Relay updater through passwordless sudo:

```sh
visudo -f /etc/sudoers.d/bitcraft-claim-monitor-relay
```

```sudoers
relay-deploy ALL=(root) NOPASSWD: /usr/local/bin/update-bitcraft-claim-monitor-relay *
```

Validate with `visudo -cf /etc/sudoers.d/bitcraft-claim-monitor-relay`.
The updater rejects unknown arguments, requires a full lowercase 40-character
SHA reachable from `origin/main`, and holds the Relay-only deployment lock.
The account receives no other passwordless command.

## GitHub environment and secrets

In the standalone repository, create the protected `relay-preview` environment
with a required reviewer and restrict deployment branches to `main`. Add:

- `RELAY_VPS_HOST`
- `RELAY_VPS_DEPLOY_USER` (`relay-deploy`)
- `RELAY_VPS_SSH_PRIVATE_KEY`
- `RELAY_VPS_KNOWN_HOSTS`

Generate `RELAY_VPS_KNOWN_HOSTS` from the VPS host key and verify its
fingerprint through an independent trusted channel before saving it. Do not use
an unverified `ssh-keyscan` result.

The **Deploy Relay preview** workflow is manual, main-only, serialized by the
`relay-preview` concurrency group, and cannot access these secrets until
verification succeeds and the protected environment is approved. Merging does
not deploy.

To deploy:

1. Merge a reviewed change to `main`.
2. Open Actions and manually run **Deploy Relay preview** from `main`.
3. Select `force_database_backup` only when an extra manual recovery point is
   required.
4. Approve the pending `relay-preview` environment deployment.
5. Check the exact revision and concise summary of status. The full VPS log
   remains on the host for an authorized operator and is not copied into
   GitHub output.

Application deployment preserves the currently installed native-map terrain
and road packs. After deploying a revision that changes map generation, run
**Generate native map packs** from `main` and approve the same protected
`relay-preview` environment. That workflow invokes only the restricted updater,
runs terrain and roads sequentially through their memory-limited systemd units,
validates complete zoom `-5..0` manifests, and enables the weekly terrain and
daily road timers only after both packs pass. A failed generation leaves the
previous pointers active.

Break-glass use of the same exact revision:

```sh
sudo /usr/local/bin/update-bitcraft-claim-monitor-relay \
  --revision 0123456789abcdef0123456789abcdef01234567
```

Add `--verbose` to stream build details. Use `--no-public-check` only while DNS
or Caddy is deliberately unavailable and an administrator is independently
checking local health.

## Deployment behavior and automatic rollback

For every requested revision the updater:

1. Acquires `/run/lock/bitcraft-claim-monitor-relay-deploy.lock`.
2. Fetches `origin/main` and verifies the full SHA is reachable.
3. Creates and builds an immutable detached worktree.
4. Validates only Relay systemd units and the tracked Caddy example.
5. Snapshots the current symlink, updater, helpers, and every live Relay unit,
   then syntax-checks and stages the encrypted-backup helpers.
6. Creates a migration backup when the schema marker changes, or a manual
   backup when requested.
7. Installs only Relay units, atomically switches `current`, and restarts only
   the Relay web and worker.
8. Checks the local release version and public preview.
9. Installs the candidate updater, enables/starts the backup timer, and commits
   the deployment transaction.
10. Prunes old releases as best-effort post-commit maintenance.

Any failure after the live snapshot and before commit—including updater
installation or backup-timer enablement—restores the exact prior symlink,
updater, helpers, and unit files, reloads systemd, and restores the prior web,
worker, and backup-timer runtime state. The previous active release cannot be
pruned before this commit. Post-commit pruning is best effort: a pruning error
is logged as a warning and does not fail or roll back the deployed release.

If any individual restore or systemd reload operation fails, rollback continues
attempting every remaining restore and retains its private transaction snapshot.
The failure summary and full log print the exact recovery snapshot path for
supervised repair. Do not delete that directory until the live installation has
been recovered and checked.

Failed releases are retained for diagnosis. Rollback never restores SQLite
automatically because that could discard writes accepted during deployment.
Database migrations must stay backward compatible with the immediately
previous release.

Before relying on unattended preview deployments, perform one successful
deployment and one forced-failure rollback in a supervised window.

## Protected canonical production cutover workflow

Production admission is available only through
`.github/workflows/cutover-relay-production.yml` on `main`. The operator must
type `app.timbersteeltrade.com` exactly. Do not run the tracked cutover helper
directly: the restricted updater is the only supported entry point and accepts
only the exact full-SHA prepare, apply, and abort modes.

The helper takes all three locks in one fixed order: cutover -> deploy -> backup.
It never calls the ordinary backup or deploy entry points while holding those
locks, so neither helper can recursively reacquire them.

The installed environment has two exact modes. Routine deployments preserve
`BITCRAFT_DEPLOYMENT_MODE=preview`, `DISCORD_DELIVERY_MODE=record`, and
`ENABLE_DISCORD_STARTUP=false`; preview is record-only and has no live gateway.
Only approved apply writes `BITCRAFT_DEPLOYMENT_MODE=canonical`,
`DISCORD_DELIVERY_MODE=live`, `ENABLE_DISCORD_STARTUP=true`, legal confirmation,
and `DISCORD_OAUTH_REDIRECT_URI=https://app.timbersteeltrade.com/api/local/auth/discord/callback`.
Canonical mode owns live Discord through exactly one Relay worker gateway.

Create a distinct GitHub environment named `relay-cutover`. Limit its
deployment branch to `main`, add at least one required reviewer who is not the
workflow initiator, prevent administrators from bypassing the protection, and
disable self-review where the GitHub plan supports it. Configure the same four
SSH secrets already used by `relay-preview`:

- `RELAY_VPS_HOST`
- `RELAY_VPS_DEPLOY_USER`
- `RELAY_VPS_SSH_PRIVATE_KEY`
- `RELAY_VPS_KNOWN_HOSTS`

Keep the key read-only/restricted to the existing deployment account and keep
the known-hosts value pinned. Do not add application tokens, privacy keys,
backup keys, provider credentials, or environment-file contents to either
GitHub environment. The prepare job uses the existing `relay-preview`
environment; the admission-changing apply job alone waits for the required
`relay-cutover` reviewer. The automatic recovery job uses `relay-preview` so a
second approval cannot delay recovery after an apply failure.

Prepare validates the installed topology, enters maintenance, stops writers,
creates and decrypt-verifies the encrypted recovery set, freezes the repair and
migration manifests, and arms a uniquely named 15-minute abort watchdog. Its
GitHub output is limited to the reviewed revision, frozen counts and hashes,
encrypted-backup identifiers, and watchdog deadline. Full command diagnostics
remain only in mode-0600 files below
`/var/log/bitcraft-claim-monitor-relay`; protected manifests/state remain below
`/var/lib/bitcraft-claim-monitor-relay/cutover`. Encrypted cutover artifacts are
one migration recovery set per cutover and follow the existing three-recovery-
point/90-day policy; the active set remains protected for the 14-day forensic
window.

The apply GitHub summary contains only the revision and `success` or `failed`;
the abort summary contains only the revision and `restored` or
`failed-or-admitted`. Neither summary publishes command output, state, paths,
tokens, keys, configuration values, or remote logs. A failed-or-admitted abort
means the admission marker exists and the same revision/hash-bound apply must
be resumed as fix-forward.

The maintenance window has a 10-minute target and a 15-minute abort watchdog.
Prepare must bind the outstanding profession repair prerequisite before it
freezes the selective migration. Old production wins only for approved account,
character-link, access, legal-acceptance, preference, market-watch, planning,
branding, durable Discord, audit, and scheduled-job configuration. Relay-only
ordinary accounts and Relay game/history/provider data remain; Relay-only admin
grants are removed or deactivated; all sessions are revoked; runtime job state,
delivery/outbox data, security telemetry, and provider caches are not copied.

The repair-to-migration seam is intentionally narrow. The outstanding
contribution repair must run after the Task 2 dry-run freezes its inputs, while
Task 2 normally rejects every target-database change as drift. Prepare therefore
binds the exact repair manifest hash, selected IDs/count, and expected post-repair
database/table fingerprints into the migration manifest. Apply accepts only that
one verified transition; a no-repair selection keeps the ordinary zero-drift
path, and any altered repair or unrelated protected-table change still refuses.

The recovery boundary is deliberate: before admission, abort restores the
saved Caddy file, exact Relay environment bytes/metadata, created privacy-key
and readiness files, and recorded service states while retaining encrypted
evidence. Immediately before final Caddy installation, apply writes the
irreversible admission marker. After admission, recovery is fix-forward only;
abort refuses. If GitHub is interrupted, the 15-minute
watchdog invokes the same revision/hash-bound abort; an admitted run will refuse
that abort rather than roll production back across the boundary. The watchdog
waits for any in-flight apply to release the same ordered locks before deciding
whether abort is still permitted. If apply fails after recording admission,
rerun the exact same revision/hash-bound apply command: it resumes only the
unfinished fix-forward phases and never re-runs a completed migration.
After successful admission the old units are persistently disabled and masked.
Their unit files and durable data remain stopped and persistently masked for
the full 14-day forensic window for supervised fix-forward or forensic work.

### Post-admission announcement and soak monitoring

Public verification, exactly one healthy gateway, zero old process health, an
unchanged outbox, connected/applied subscriptions, provider generation
advancement, and every sample of the 30-minute intensive soak must succeed
before the revision-bound custom announcement is inserted into the durable
outbox. Its source key is `canonical-cutover:<40hex>`, it targets the configured
`announcements` channel, disables all mentions, and uses Discord's enforced
revision-derived nonce as defense in depth. Delivery is claimed once before
the network request; an interrupted or ambiguous attempt becomes terminal
`skipped` and is never resent automatically. Verify Discord manually before
any separately approved operator follow-up. The ordinary
`0.53.0-beta.1` update notice is pre-seeded as already announced before Relay
services start.

Apply runs the intensive profile automatically. A supervised operator can run
the same non-mutating, bounded, secret-free verifier from the active release:

```sh
REVISION=0123456789abcdef0123456789abcdef01234567
sudo node /opt/bitcraft-claim-monitor-relay/current/deploy/verify-canonical-soak.mjs --profile intensive --revision "$REVISION"
```

After apply succeeds, schedule the 24-hour follow-up cadence as a transient
systemd service so monitoring does not require an open browser or SSH session:

```sh
REVISION=0123456789abcdef0123456789abcdef01234567
sudo systemd-run \
  --unit="bitcraft-claim-monitor-relay-follow-up-${REVISION:0:12}" \
  --description="BitCraft canonical 24-hour follow-up" \
  --collect \
  /usr/bin/node /opt/bitcraft-claim-monitor-relay/current/deploy/verify-canonical-soak.mjs \
  --profile follow-up --revision "$REVISION"
sudo systemctl status "bitcraft-claim-monitor-relay-follow-up-${REVISION:0:12}" --no-pager -l
sudo journalctl -u "bitcraft-claim-monitor-relay-follow-up-${REVISION:0:12}" -f
```

Both profiles make only GET requests and read-only SQLite/systemd/process
checks. They exit nonzero on any failed sample and print only a bounded JSON
summary. The intensive cadence is one sample per minute for 30 minutes; the
follow-up cadence is one sample every 15 minutes for 24 hours. Both bind the
exact preflight subscription set from the protected cutover state without
printing that state or requiring application secrets. Intensive requires a
frozen outbox before announcement; follow-up permits monotonic healthy live
notification delivery but fails on retry/error state.

## Required 0.53.0-beta.1 contribution and branding repairs

Run this supervised VPS procedure only after the `0.53.0-beta.1` release is
installed and the production repair is separately approved. It runs both
`scripts/repair-relay-contribution-attribution.mjs` and
`scripts/repair-relay-branding-assets.mjs`. It does not send a test message,
drain the Discord outbox, or make any other real Discord send.

Use `root` for systemd, encrypted-backup, and branding-repair commands. Run the
contribution repair as the existing `bitcraft` service account. Branding
manifest format 4 binds the numeric uid, gid, and safe mode of the service-owned
data/branding directory and every source and target asset. A root-run apply
chowns and chmods its private stage to that exact contract before publication,
then verifies it again. Do not pre-create a root-owned branding directory and
do not change ownership between dry-run and apply.

The approved branding source is the stopped, retained local production
branding directory below. Do not download branding or game data from BitJita or
any other network source. If that retained directory is unavailable, stop: a
separately approved operator must first decrypt-verify the matching cutover
recovery artifacts into one mode-0700 local directory and set
`BRANDING_ARCHIVE` to that directory.

### 1. Bind the release and capture the live pre-state

Start one root shell and keep it for the complete procedure:

```sh
set -euo pipefail

EXPECTED_VERSION="0.53.0-beta.1"
RELEASE="$(readlink -f /opt/bitcraft-claim-monitor-relay/current)"
REVISION="$(basename "$RELEASE")"
DATA_DIR="/var/lib/bitcraft-claim-monitor-relay"
DATABASE="$DATA_DIR/bitcraft-local.sqlite"
BACKUP_ROOT="/var/backups/bitcraft-claim-monitor-relay"
BACKUP_KEY="/etc/bitcraft-claim-monitor-relay/backup-encryption.key"
BACKUP_CRYPTO="/usr/local/lib/bitcraft-claim-monitor-relay/backup-crypto.mjs"
CLAIM_ID="1369094286777412590"
BRANDING_ARCHIVE="/var/lib/bitcraft-claim-monitor/branding"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REPAIR_ROOT="$BACKUP_ROOT/repair-${EXPECTED_VERSION}-${REVISION:0:12}-$STAMP"

test "$(node -p "require('$RELEASE/apps/bitcraft-local/package.json').version")" = "$EXPECTED_VERSION"
printf '%s' "$REVISION" | grep -Eq '^[0-9a-f]{40}$'
test -f "$DATABASE"
test -d "$BRANDING_ARCHIVE"
install -d -o bitcraft -g bitcraft -m 0700 "$REPAIR_ROOT"

{
  date -u --iso-8601=seconds
  systemctl status bitcraft-claim-monitor-relay.service --no-pager -l || true
  systemctl status bitcraft-claim-monitor-relay-worker.service --no-pager -l || true
  systemctl status bitcraft-claim-monitor-relay-collector.timer --no-pager -l || true
  curl --fail --silent --show-error http://127.0.0.1:19430/api/local/health
  curl --fail --silent --show-error https://app.timbersteeltrade.com/api/local/health
} > "$REPAIR_ROOT/health-before.txt"
chmod 0600 "$REPAIR_ROOT/health-before.txt"

sqlite3 -noheader -separator '|' "$DATABASE" \
  "SELECT provider || ':' || source_key || ':' || domain, generation
     FROM provider_subscription_health
    ORDER BY provider, source_key, domain;" \
  > "$REPAIR_ROOT/relay-generations-before.txt"
test -s "$REPAIR_ROOT/relay-generations-before.txt"
test "$(sqlite3 "$DATABASE" \
  "SELECT COUNT(*) FROM provider_subscription_health
    WHERE connected != 1 OR generation <= 0 OR last_error IS NOT NULL;")" = "0"
chmod 0600 "$REPAIR_ROOT/relay-generations-before.txt"
```

### 2. Stop every writer and install a persistent no-send runtime

Stop the worker first. The two persistent `/etc/systemd/system` drop-ins replace
`ExecStart`, so their maintenance settings take precedence after the production
environment file. Both processes run in supported preview/record mode, the
worker gateway stays off, all Discord bot-network paths and the manual sandbox
are disabled, and outbox processing is held while Relay collection continues.
Keep these drop-ins installed until a separately approved live
restart; `/run` overrides are forbidden because a reboot would silently remove
the safety boundary.

```sh
systemctl stop bitcraft-claim-monitor-relay-worker.service
systemctl stop \
  bitcraft-claim-monitor-relay-backup.timer \
  bitcraft-claim-monitor-relay-collector.timer \
  bitcraft-claim-monitor-relay-collector.service \
  bitcraft-claim-monitor-relay.service
systemctl is-active --quiet bitcraft-claim-monitor-relay-worker.service && exit 1 || true

WEB_DROPIN="/etc/systemd/system/bitcraft-claim-monitor-relay.service.d/repair-no-discord.conf"
WORKER_DROPIN="/etc/systemd/system/bitcraft-claim-monitor-relay-worker.service.d/repair-no-discord.conf"
install -d -o root -g root -m 0755 "$(dirname "$WEB_DROPIN")" "$(dirname "$WORKER_DROPIN")"
printf '%s\n' \
  '[Service]' \
  'ExecStart=' \
  "ExecStart=/usr/bin/env BITCRAFT_PROCESS_ROLE=web BITCRAFT_DEPLOYMENT_MODE=preview DISCORD_DELIVERY_MODE=record ENABLE_DISCORD_STARTUP=false ENABLE_DISCORD_OUTBOX_PROCESSING=false ENABLE_DISCORD_NETWORK=false DISCORD_SANDBOX_CHANNEL_ID= ENABLE_SERVER_POLLING=false ENABLE_SCHEDULED_JOBS=false /usr/bin/node $RELEASE/apps/bitcraft-local/server.mjs" \
  > "$WEB_DROPIN"
printf '%s\n' \
  '[Service]' \
  'ExecStart=' \
  "ExecStart=/usr/bin/env BITCRAFT_PROCESS_ROLE=worker BITCRAFT_DEPLOYMENT_MODE=preview DISCORD_DELIVERY_MODE=record ENABLE_DISCORD_STARTUP=false ENABLE_DISCORD_OUTBOX_PROCESSING=false ENABLE_DISCORD_NETWORK=false DISCORD_SANDBOX_CHANNEL_ID= ENABLE_SERVER_POLLING=true ENABLE_SCHEDULED_JOBS=false /usr/bin/node $RELEASE/apps/bitcraft-local/worker.mjs" \
  > "$WORKER_DROPIN"
chmod 0644 "$WEB_DROPIN" "$WORKER_DROPIN"
systemctl daemon-reload
systemctl cat bitcraft-claim-monitor-relay.service \
  bitcraft-claim-monitor-relay-worker.service \
  > "$REPAIR_ROOT/repair-units.txt"
chmod 0600 "$REPAIR_ROOT/repair-units.txt"

outbox_fingerprint() {
  /usr/bin/node --input-type=module -e '
    import { createHash } from "node:crypto";
    import { DatabaseSync } from "node:sqlite";
    const db = new DatabaseSync(process.argv[1], { readOnly: true });
    const rows = db.prepare(
      "SELECT * FROM discord_notification_outbox WHERE id <= ? ORDER BY id"
    ).all(BigInt(process.argv[2]));
    db.close();
    const payload = JSON.stringify(rows, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value);
    process.stdout.write(createHash("sha256").update(payload).digest("hex") + "\\n");
  ' "$DATABASE" "$1"
}
OUTBOX_BASELINE_MAX="$(sqlite3 -noheader "$DATABASE" \
  "SELECT COALESCE(MAX(id), 0) FROM discord_notification_outbox;")"
printf '%s\n' "$OUTBOX_BASELINE_MAX" > "$REPAIR_ROOT/outbox-baseline-max.txt"
outbox_fingerprint "$OUTBOX_BASELINE_MAX" > "$REPAIR_ROOT/outbox-before.sha256"
chmod 0600 "$REPAIR_ROOT/outbox-baseline-max.txt" "$REPAIR_ROOT/outbox-before.sha256"
```

### 3. Create and independently verify encrypted recovery artifacts

The backup helper creates, encrypts, decrypt-verifies, and SQLite-validates the
database backup. The second decrypt and checks below independently verify the
artifact beside which both exact manifests will be retained. The branding tar
preserves numeric ownership, modes, ACLs, and xattrs and is also encrypt/decrypt
verified before its plaintext is removed.

```sh
BACKUP_DIR="$REPAIR_ROOT" \
  /usr/local/bin/backup-bitcraft-claim-monitor-relay manual --revision "$REVISION" \
  > "$REPAIR_ROOT/database-backup.log"
chmod 0600 "$REPAIR_ROOT/database-backup.log"

set -- "$REPAIR_ROOT"/bitcraft-local-manual-"${REVISION:0:12}"-*.sqlite.enc
test "$#" -eq 1
DATABASE_BACKUP="$1"
DATABASE_VERIFY="$REPAIR_ROOT/database-verify.sqlite"
node "$BACKUP_CRYPTO" decrypt "$DATABASE_BACKUP" "$DATABASE_VERIFY" "$BACKUP_KEY"
test -z "$(sqlite3 "$DATABASE_VERIFY" 'PRAGMA foreign_key_check;')"
test "$(sqlite3 "$DATABASE_VERIFY" 'PRAGMA integrity_check;')" = "ok"
rm -f "$DATABASE_VERIFY"

BRANDING_PLAIN="$REPAIR_ROOT/branding-backup.tar"
BRANDING_ENCRYPTED="$REPAIR_ROOT/branding-backup.tar.enc"
BRANDING_VERIFY="$REPAIR_ROOT/branding-verify.tar"
tar --acls --xattrs --numeric-owner -C "$DATA_DIR" -cf "$BRANDING_PLAIN" branding
chmod 0600 "$BRANDING_PLAIN"
node "$BACKUP_CRYPTO" encrypt "$BRANDING_PLAIN" "$BRANDING_ENCRYPTED" "$BACKUP_KEY"
node "$BACKUP_CRYPTO" decrypt "$BRANDING_ENCRYPTED" "$BRANDING_VERIFY" "$BACKUP_KEY"
cmp --silent "$BRANDING_PLAIN" "$BRANDING_VERIFY"
tar -tf "$BRANDING_VERIFY" > "$REPAIR_ROOT/branding-backup-files.txt"
chmod 0600 "$REPAIR_ROOT/branding-backup-files.txt"
rm -f "$BRANDING_PLAIN" "$BRANDING_VERIFY"
sha256sum "$DATABASE_BACKUP" "$BRANDING_ENCRYPTED" \
  > "$REPAIR_ROOT/encrypted-backups.sha256"
chmod 0600 "$REPAIR_ROOT/encrypted-backups.sha256"
```

### 4. Freeze both exact manifests, then apply them unchanged

Both dry-runs occur against the same stopped database. Apply branding first
because its manifest binds the complete SQLite state. The contribution repair
then revalidates only its exact selected contribution rows/events under
`BEGIN IMMEDIATE`, so the preceding branding setting change does not weaken or
invalidate its selection. Retain both original JSON files and their hashes
beside the encrypted backups.

```sh
CONTRIBUTION_MANIFEST="$REPAIR_ROOT/contribution-attribution-manifest.json"
BRANDING_MANIFEST="$REPAIR_ROOT/branding-assets-manifest.json"

sudo -u bitcraft env BITCRAFT_LOCAL_DB_PATH="$DATABASE" \
  /usr/bin/node "$RELEASE/scripts/repair-relay-contribution-attribution.mjs" \
  --dry-run --claim-id "$CLAIM_ID" --manifest "$CONTRIBUTION_MANIFEST" \
  > "$REPAIR_ROOT/contribution-dry-run.json"
/usr/bin/node "$RELEASE/scripts/repair-relay-branding-assets.mjs" \
  --dry-run --database "$DATABASE" --archive "$BRANDING_ARCHIVE" \
  --manifest "$BRANDING_MANIFEST" \
  > "$REPAIR_ROOT/branding-dry-run.json"
chmod 0600 \
  "$CONTRIBUTION_MANIFEST" "$BRANDING_MANIFEST" \
  "$REPAIR_ROOT/contribution-dry-run.json" "$REPAIR_ROOT/branding-dry-run.json"
sha256sum "$CONTRIBUTION_MANIFEST" "$BRANDING_MANIFEST" \
  > "$REPAIR_ROOT/repair-manifests.sha256"
chmod 0600 "$REPAIR_ROOT/repair-manifests.sha256"

sha256sum --check "$REPAIR_ROOT/repair-manifests.sha256"
/usr/bin/node "$RELEASE/scripts/repair-relay-branding-assets.mjs" \
  --apply --database "$DATABASE" --archive "$BRANDING_ARCHIVE" \
  --manifest "$BRANDING_MANIFEST" \
  > "$REPAIR_ROOT/branding-apply.json"
sudo -u bitcraft env BITCRAFT_LOCAL_DB_PATH="$DATABASE" \
  /usr/bin/node "$RELEASE/scripts/repair-relay-contribution-attribution.mjs" \
  --apply --manifest "$CONTRIBUTION_MANIFEST" \
  > "$REPAIR_ROOT/contribution-apply.json"
chmod 0600 "$REPAIR_ROOT/branding-apply.json" "$REPAIR_ROOT/contribution-apply.json"
```

Both tools refuse a changed manifest or changed input. If either apply reports
`selection changed`, `selection hash is invalid`, `changed since dry-run`,
`does not match the exact branding repair manifest`, or retained recovery
state, do not edit, re-hash, or replace either JSON file. Keep the stopped
services and all evidence. Resume only the same branding manifest when its
message explicitly requires exact-manifest recovery; otherwise start a new
repair directory with a new encrypted backup and new dry-runs after review.

### 5. Verify SQLite and ownership, then restart no-send Relay

```sh
test -z "$(sqlite3 "$DATABASE" 'PRAGMA foreign_key_check;')"
test "$(sqlite3 "$DATABASE" 'PRAGMA integrity_check;')" = "ok"
test "$(stat -c '%U:%G' "$DATA_DIR/branding")" = "bitcraft:bitcraft"
test -z "$(find "$DATA_DIR/branding" -mindepth 1 -maxdepth 1 -type f \
  \( ! -user bitcraft -o ! -group bitcraft \) -print -quit)"

systemctl start \
  bitcraft-claim-monitor-relay.service \
  bitcraft-claim-monitor-relay-worker.service \
  bitcraft-claim-monitor-relay-collector.timer \
  bitcraft-claim-monitor-relay-backup.timer

WEB_PID="$(systemctl show bitcraft-claim-monitor-relay.service \
  --property MainPID --value)"
WORKER_PID="$(systemctl show bitcraft-claim-monitor-relay-worker.service \
  --property MainPID --value)"
printf '%s' "$WEB_PID" | grep -Eq '^[1-9][0-9]*$'
printf '%s' "$WORKER_PID" | grep -Eq '^[1-9][0-9]*$'
for PID in "$WEB_PID" "$WORKER_PID"; do
  tr '\0' '\n' < "/proc/$PID/environ" | grep -Fx 'BITCRAFT_DEPLOYMENT_MODE=preview'
  tr '\0' '\n' < "/proc/$PID/environ" | grep -Fx 'DISCORD_DELIVERY_MODE=record'
  tr '\0' '\n' < "/proc/$PID/environ" | grep -Fx 'ENABLE_DISCORD_STARTUP=false'
  tr '\0' '\n' < "/proc/$PID/environ" | grep -Fx 'ENABLE_DISCORD_OUTBOX_PROCESSING=false'
  tr '\0' '\n' < "/proc/$PID/environ" | grep -Fx 'ENABLE_DISCORD_NETWORK=false'
  tr '\0' '\n' < "/proc/$PID/environ" | grep -Fx 'DISCORD_SANDBOX_CHANNEL_ID='
done
tr '\0' '\n' < "/proc/$WEB_PID/environ" | grep -Fx 'BITCRAFT_PROCESS_ROLE=web'
tr '\0' '\n' < "/proc/$WORKER_PID/environ" | grep -Fx 'BITCRAFT_PROCESS_ROLE=worker'

for attempt in $(seq 1 60); do
  if curl --fail --silent --show-error \
      http://127.0.0.1:19430/api/local/health \
      > "$REPAIR_ROOT/health-after.json"; then
    break
  fi
  sleep 5
done
verify_repair_health() {
  /usr/bin/node -e '
  const fs = require("node:fs");
  const health = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (health.ok !== true || health.version !== process.argv[2]
      || health.deploymentMode !== process.argv[3]
      || health.buildSha !== process.argv[4]) process.exit(1);
  ' "$1" "$EXPECTED_VERSION" preview "${REVISION:0:12}"
}
verify_repair_health "$REPAIR_ROOT/health-after.json"

for attempt in $(seq 1 60); do
  sqlite3 -noheader -separator '|' "$DATABASE" \
    "SELECT provider || ':' || source_key || ':' || domain, generation
       FROM provider_subscription_health
      WHERE connected = 1 AND generation > 0 AND last_error IS NULL
      ORDER BY provider, source_key, domain;" \
    > "$REPAIR_ROOT/relay-generations-after.txt"
  if awk -F'|' '
      NR == FNR { before[$1] = $2 + 0; expected += 1; next }
      { seen += 1; if (!($1 in before) || $2 + 0 < before[$1]) bad = 1;
        if ($2 + 0 > before[$1]) advanced = 1 }
      END { exit (bad || seen != expected || !advanced) ? 1 : 0 }
    ' "$REPAIR_ROOT/relay-generations-before.txt" \
      "$REPAIR_ROOT/relay-generations-after.txt"; then
    break
  fi
  test "$attempt" -lt 60
  sleep 5
done

outbox_fingerprint "$OUTBOX_BASELINE_MAX" > "$REPAIR_ROOT/outbox-after.sha256"
cmp --silent "$REPAIR_ROOT/outbox-before.sha256" "$REPAIR_ROOT/outbox-after.sha256"
test "$(sqlite3 "$DATABASE" \
  "SELECT COUNT(*) FROM discord_notification_outbox
    WHERE id > $OUTBOX_BASELINE_MAX AND (status != 'pending' OR attempts != 0);")" = "0"
test "$(sqlite3 "$DATABASE" \
  "SELECT COUNT(*) FROM discord_notification_outbox WHERE status = 'sending';")" = "0"
curl --fail --silent --show-error https://app.timbersteeltrade.com/api/local/health \
  > "$REPAIR_ROOT/public-health-after.json"
verify_repair_health "$REPAIR_ROOT/public-health-after.json"
find "$REPAIR_ROOT" -maxdepth 1 -type f -exec chmod 0600 {} +
```

Success requires exact-version preview/record health from both endpoints, the
exact connected subscription set, at least one monotonic Relay generation
advance, byte-equivalent state for every pre-existing outbox row, only
zero-attempt pending rows added during verification, no `sending` row, clean
SQLite checks, and `bitcraft:bitcraft` branding ownership. The persistent
drop-ins intentionally remain active across reboot, so this procedure performs
no real Discord send, exposes no manual sandbox exception, and cannot drain or
recover-mutate the pre-existing outbox.

Removing both `$WEB_DROPIN` and `$WORKER_DROPIN`, running `systemctl
daemon-reload`, and restarting the web and worker services re-enables canonical
live Discord behavior. Those commands are deliberately not part of this
runbook; they require separate explicit operator approval after the repair
evidence has been reviewed.

## Diagnostics

```sh
systemctl status bitcraft-claim-monitor-relay.service --no-pager -l
systemctl status bitcraft-claim-monitor-relay-worker.service --no-pager -l
systemctl status bitcraft-claim-monitor-relay-collector.timer --no-pager -l
systemctl status bitcraft-claim-monitor-relay-backup.timer --no-pager -l
systemctl list-timers 'bitcraft-claim-monitor-relay-*' --all
journalctl -u bitcraft-claim-monitor-relay.service -n 100 --no-pager -l
journalctl -u bitcraft-claim-monitor-relay-worker.service -n 100 --no-pager -l
journalctl -u bitcraft-claim-monitor-relay-backup.service -n 100 --no-pager -l
readlink -f /opt/bitcraft-claim-monitor-relay/current
curl --fail --silent --show-error http://127.0.0.1:19430/api/local/health
curl --fail --silent --show-error https://relay.timbersteeltrade.com/api/local/health
caddy validate --config /etc/caddy/Caddyfile
```

Deployment logs use unpredictable names such as
`/var/log/bitcraft-claim-monitor-relay/update.A1b2C3.log`. The root-owned
directory is mode `0700` and each log is mode `0600`. Logs may contain
operational metadata but must not contain secrets.

## Backups, privacy ledger, and restore

The persistent `bitcraft-claim-monitor-relay-backup.timer` creates encrypted
daily backups at 03:30 Europe/London with a randomized delay of up to 15
minutes. Retention keeps seven daily backups, three migration backups, and
three manual backups. The helper pauses only the Relay worker and collector
while SQLite creates and validates the copy; the Relay web remains available.

```sh
sudo /usr/local/bin/backup-bitcraft-claim-monitor-relay daily
sudo /usr/local/bin/backup-bitcraft-claim-monitor-relay manual \
  --revision 0123456789abcdef0123456789abcdef01234567
sudo /usr/local/bin/backup-bitcraft-claim-monitor-relay --dry-run-prune
sudo /usr/local/bin/backup-bitcraft-claim-monitor-relay --apply-prune
```

Cleanup is confined to `/var/backups/bitcraft-claim-monitor-relay`, takes the
Relay deployment and backup locks, ignores partial/open/new files, and
validates the newest retained legacy-format backup before removing older
legacy-format files.

The privacy deletion ledger is outside SQLite at
`/var/backups/bitcraft-claim-monitor-relay/privacy-deletion-ledger.jsonl`.
Keep it and `/etc/bitcraft-claim-monitor-relay/privacy-ledger.key` with the
encrypted backups. A database restore must replay the privacy deletion ledger
before the restored database can serve traffic, so deleted accounts cannot
reappear.

During canonical cutover the old signing key is installed only as a previous
verification key. Retire it as soon as no unexpired record bears its key ID and
never retain it beyond the remaining 90-day signed-record lifetime. Verify the
ledger with the current and configured previous keys before every restore.

Supervised restore outline:

```sh
BACKUP="/var/backups/bitcraft-claim-monitor-relay/REPLACE.sqlite.enc"
RESTORE="/var/backups/bitcraft-claim-monitor-relay/restore.sqlite.partial"
node /usr/local/lib/bitcraft-claim-monitor-relay/backup-crypto.mjs \
  decrypt "$BACKUP" "$RESTORE" \
  /etc/bitcraft-claim-monitor-relay/backup-encryption.key
sqlite3 "$RESTORE" 'PRAGMA quick_check;'

DATA_DIR=/var/lib/bitcraft-claim-monitor-relay \
BACKUP_DIR=/var/backups/bitcraft-claim-monitor-relay \
CONFIG_DIR=/etc/bitcraft-claim-monitor-relay \
node /opt/bitcraft-claim-monitor-relay/current/deploy/replay-privacy-deletions.mjs \
  "$RESTORE" \
  /var/backups/bitcraft-claim-monitor-relay/privacy-deletion-ledger.jsonl \
  /etc/bitcraft-claim-monitor-relay/privacy-ledger.key
sqlite3 "$RESTORE" 'PRAGMA quick_check;'

systemctl stop \
  bitcraft-claim-monitor-relay-collector.timer \
  bitcraft-claim-monitor-relay-collector.service \
  bitcraft-claim-monitor-relay-worker.service \
  bitcraft-claim-monitor-relay.service
install -o bitcraft -g bitcraft -m 0600 \
  "$RESTORE" /var/lib/bitcraft-claim-monitor-relay/bitcraft-local.sqlite
rm -f "$RESTORE"
systemctl start \
  bitcraft-claim-monitor-relay.service \
  bitcraft-claim-monitor-relay-worker.service \
  bitcraft-claim-monitor-relay-collector.timer
curl --fail --silent --show-error http://127.0.0.1:19430/api/local/health
```

Never restore or copy preview data into the maintained application. Finish by
checking both public health endpoints and recording that the maintained app
remains running and untouched.

Legacy deletion requires a separate approval and a final encrypted archive
that has been decrypt- and restore-verified. No cleanup command is part of this
release; the cutover workflow does not delete legacy unit files, databases,
configuration, ledgers, keys, branding, or forensic evidence.
