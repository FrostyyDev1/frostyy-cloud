# Frostyy Cloud

A self-hosted cloud storage platform you run on your own hardware. Sign up, log in, upload/download files, organize folders, share links, search across your whole account, and manage everything from a clean dashboard — no third-party cloud provider involved.

Built as a homelab project and now polished toward private/public beta quality.

## Screenshots

*(add screenshots here before publishing — dashboard, file manager grid/list view, and the mobile layout are good candidates)*

## Features
- Simple email + password signup and login (bcrypt-hashed passwords, first registered account becomes admin)
- Dashboard with real usage data: storage used, file count, shared links, trash count, recent uploads, recent activity
- File manager: grid/list view, search, sort, filter, folders, move-to-folder (with a folder picker), drag-and-drop upload, bulk actions, rename
- Global search across your whole account (not just the current folder), with result locations
- Image/PDF preview, public share links with copy/disable controls and optional expiration
- Favorites, Recent, and a Trash with configurable auto-purge (restore or delete forever any time before that)
- Settings: display name, email, password, theme (light/dark/system), storage summary, plan info, About/version
- Admin dashboard with per-user storage/file breakdown, search, per-user quota overrides, promote/demote, and disable/enable (admin-only)
- Invite-only registration mode for controlled public/beta access
- Concurrency-safe data layer: JSON writes are locked and atomic, so simultaneous requests can't corrupt or clobber each other's data
- Persistent storage via Docker volumes/bind mounts — uploads and accounts survive container restarts and rebuilds
- Responsive layout, usable on mobile

## Tech stack
- **Backend**: Node.js, Express
- **Config**: `.env` loaded automatically via `dotenv` — works the same for `npm start` and Docker Compose
- **Auth**: bcrypt password hashing, httpOnly cookies (optionally signed via `SESSION_SECRET`)
- **Storage**: local filesystem for uploaded files; JSON files for metadata (`data/users.json`, `data/storage.json`, `data/invites.json`, etc.), with per-file locking and atomic writes
- **Frontend**: vanilla HTML/CSS/JS (no framework, no build step) — kept intentionally simple for a self-hosted homelab app
- **Deployment**: Docker + Docker Compose, tested on Raspberry Pi (ARM64)

## Security & reliability features
- Rate-limited login/registration
- Per-file lock + atomic temp-file-then-rename writes on all JSON metadata — verified with a concurrency stress test (`npm run test:concurrency`)
- Every file/folder endpoint checks resource ownership, including move destinations (can't move into someone else's folder, can't move a folder into its own subfolder)
- Path-traversal guard on every stored-file read — a crafted path can never resolve outside the uploads directory
- Filename sanitization, duplicate-name handling, blocked dangerous extensions, per-file size limit, per-account storage quota
- Share links use long random tokens, are revocable, and support optional expiration
- Production-mode error responses never leak stack traces or internal paths
- Invite-only / disabled registration modes for controlled access
- Optional maintenance mode that blocks non-admin API access with a clear message

## Current limitations (be honest with yourself before going public)
- **Metadata storage is JSON files, not a database.** Fine for a homelab or a small private beta; for real public use with many concurrent users, migrate to SQLite or PostgreSQL — the locking layer reduces risk but doesn't replace proper transactional storage at scale.
- **Billing is not connected.** Plans page is a professional placeholder (Free/Self-hosted is real, Pro/Business are "coming soon"). Real billing needs Stripe (or similar), invoicing, plan-based quota enforcement, cancellation flow, and updated Terms/Privacy — none of that is built.
- **Account deletion is a placeholder.** Requesting deletion is logged but does not remove the account or its data, because a safe implementation needs to also handle owned files, shares, and admin implications.
- **Public exposure requires deliberate setup**: HTTPS via a reverse proxy, `SESSION_SECRET` set, `REGISTRATION_MODE` set to `invite` or `disabled`, backups in place, and a review of the checklist below.

## Local development
```bash
npm install
npm start
```
Open http://localhost:3000. Without a `.env` file, sensible local defaults apply (open registration, no session secret, non-production cookies).

## Docker Compose

### 1. Clone the repo
```bash
git clone <your-repo-url> frostyy-cloud
cd frostyy-cloud
```

### 2. Configure your environment
```bash
cp .env.example .env
```
Edit `.env`. At minimum for anything beyond local-only use, set `SESSION_SECRET`. See [Environment variables](#environment-variables) below. Note that `.env.example` ships with `REGISTRATION_MODE=invite` and a placeholder `INVITE_CODES=change-me-first-invite` so you aren't locked out of your own first deployment — sign up with that code, then remove/rotate it (or mint new ones from the Admin dashboard).

### 3. Start the app
```bash
docker compose up -d --build
```
Open http://localhost:3000

### Everyday commands
```bash
docker ps                     # confirm the container is running
docker compose logs -f        # tail logs
docker compose restart        # restart without rebuilding
docker compose down           # stop and remove the container (data persists on the host)
docker compose up -d --build  # rebuild and restart after pulling new code
git pull && docker compose up -d --build   # update to the latest code
```

## Data persistence
Uploaded files and all JSON metadata live on the host in `./uploads` and `./data`, bind-mounted into the container. Restarting, rebuilding, or updating the container does **not** delete this data — only deleting those folders does. `docker compose down -v` is safe too, since this app doesn't rely on anonymous Docker volumes.

## Running on a Raspberry Pi
Runs on any Raspberry Pi capable of running Docker (Pi 3 or newer recommended, 64-bit Raspberry Pi OS).

1. Install Docker and the Compose plugin:
   ```bash
   curl -sSL https://get.docker.com | sh
   sudo usermod -aG docker $USER
   sudo apt install docker-compose-plugin -y
   ```
   Log out and back in for the group change to apply.
2. Follow the Docker Compose steps above from your Pi. The `node:20-alpine` base image supports ARM64 natively, no changes needed.
3. If `./data` or `./uploads` were created by a different user (e.g. copied from another machine), fix ownership:
   ```bash
   sudo chown -R $USER:$USER data uploads
   chmod -R u+rwX data uploads
   ```

### Access from another device on your home network
1. Find your Pi's local IP: `hostname -I`
2. From any device on the same network: `http://<pi-ip-address>:3000`
3. Allow the port through the firewall if needed: `sudo ufw allow 3000`

## Exposing it beyond your home network (HTTPS)
Do not expose port 3000 directly to the internet. Put a reverse proxy in front of it that terminates HTTPS. This app doesn't force one option — pick whichever fits your setup:

- **Cloudflare Tunnel** — no port forwarding, no public IP needed, free TLS. Point the tunnel at `http://localhost:3000`.
- **Caddy** — simplest self-managed option, automatic Let's Encrypt certificates. A minimal `Caddyfile`:
  ```
  cloud.example.com {
    reverse_proxy localhost:3000
  }
  ```
- **Nginx Proxy Manager** — good if you're already running it for other services; point a proxy host at the container's port with "Force SSL" enabled.

Whichever you choose, once real HTTPS is in front of the app:
- Set `NODE_ENV=production` so auth cookies are marked `secure` (browsers won't send them over plain HTTP).
- Set `SESSION_SECRET` so the auth cookie is signed.
- Set `TRUST_PROXY` appropriately (default `1` works for a single reverse proxy hop; see Express's `trust proxy` docs if you're chaining more than one proxy).
- Optionally set `APP_URL` to your public URL for documentation/reference purposes.
- Set `REGISTRATION_MODE=invite` (or `disabled`) — do not leave public registration open.

## Environment variables
| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port the server listens on |
| `NODE_ENV` | (unset) | Set to `production` to enable secure cookies (requires HTTPS) |
| `SESSION_SECRET` | (unset) | Signs the auth cookie so it can't be tampered with. **Set this for any real deployment.** |
| `REGISTRATION_MODE` | `open` | `open` \| `invite` \| `disabled`. Controls who can create an account. |
| `INVITE_CODES` | (unset) | Comma-separated codes seeded into `data/invites.json` on startup (only adds new codes, never resets usage) |
| `MAX_UPLOAD_MB` | `20` | Maximum upload size per file, in megabytes (older name `MAX_FILE_SIZE_MB` still works) |
| `DEFAULT_USER_QUOTA_MB` | `5120` | Storage quota for normal accounts, in MB (older name `STORAGE_QUOTA_MB` still works) |
| `ADMIN_USER_QUOTA_MB` | `102400` | Storage quota for admin accounts, in MB. Accepts `unlimited` or `-1` for no cap. |
| `TRASH_RETENTION_DAYS` | `30` | Days a deleted item stays in Trash before automatic permanent purge |
| `ADMIN_EMAILS` | (unset) | Comma-separated emails force-promoted to `admin` on login, in addition to the first-registered-user rule |
| `APP_URL` | (unset) | Documented public URL of this instance (informational) |
| `TRUST_PROXY` | `1` | Express `trust proxy` setting; use `false` to disable if not behind a reverse proxy |
| `MAINTENANCE_MODE` | `false` | When `true`, non-admin API requests get a 503 maintenance response |

## Admin setup
The **first account ever registered** automatically becomes admin. `ADMIN_EMAILS` remains the way to grant *permanent* admin recovery access (see below) — but day-to-day user management (quotas, promote/demote, disable/enable) is done from the Admin dashboard itself, no `.env` edits or restarts required.

### Managing users from the Admin panel
Sidebar → Admin → Users gives you, per account: role/admin badge (and whether it's `env`-locked via `ADMIN_EMAILS` or a manual promotion), storage used vs. quota and where that quota comes from (custom override, admin default, or user default), file count, and last activity. Search by email or display name to filter the list. From there you can:
- **Set a custom quota** — pick a preset (5 GB / 20 GB / 50 GB / 100 GB / Unlimited) and click Set. This overrides that account's role-based default.
- **Clear a custom quota** — select "Default" and click Set to fall back to the normal admin/user default quota again.
- **Promote/demote** — toggles the `admin` role. You can't change your own role (ask another admin, or use `ADMIN_EMAILS`), and the last remaining active admin can't be demoted, so you can't lock yourself out. Demoting an `ADMIN_EMAILS`-listed account shows a note that it will auto-repromote on next login — remove it from `ADMIN_EMAILS` first if you want the demotion to stick.
- **Disable/enable** — a disabled account is immediately signed out and can't log back in until re-enabled. You can't disable your own account, and (like demote) you can't disable the last remaining active admin.

All of this is admin-only server-side (`requireAdmin` gate on every `/api/admin/*` route) — a non-admin session gets a 403, not just a hidden button.

### How to make yourself admin (emergency/permanent recovery)
Use this for your very first admin account, or to recover admin access if every admin account has been demoted/disabled. For everything else, use the Admin panel above.
1. Open `.env` (create it first with `cp .env.example .env` if you haven't).
2. Set:
   ```bash
   ADMIN_EMAILS=myemail@example.com
   DEFAULT_USER_QUOTA_MB=5120
   ADMIN_USER_QUOTA_MB=102400
   ```
3. Save `.env`.
4. Restart the server (`docker compose restart`, or stop/re-run `npm start`).
5. Log out and log back in (admin status is re-checked and re-persisted on login).
6. Check Settings for the "Admin" badge next to your profile, or Storage/Dashboard for the increased quota.

`.env` is loaded automatically on startup (via `dotenv`) — you no longer need to export variables manually in your shell for local runs. `ADMIN_EMAILS` matches case-insensitively, tolerates spaces around commas, and also checks your account's username as a fallback (useful for older accounts that never set a separate email address).

### Admin storage quota
Admin accounts get a separate, larger (or unlimited) storage quota from `ADMIN_USER_QUOTA_MB`, independent of `DEFAULT_USER_QUOTA_MB` used for everyone else. Examples:
```bash
DEFAULT_USER_QUOTA_MB=5120     # normal users: 5 GB
ADMIN_USER_QUOTA_MB=102400     # admins: 100 GB
```
```bash
ADMIN_USER_QUOTA_MB=unlimited  # or: ADMIN_USER_QUOTA_MB=-1
```
Both forms of "no limit" are equivalent; the UI shows "Unlimited" instead of a percentage. This only applies to accounts with the `admin` role — normal users always use `DEFAULT_USER_QUOTA_MB` regardless of this setting.

## Invite-only registration setup
1. Set `REGISTRATION_MODE=invite` in `.env`.
2. Seed initial codes via `INVITE_CODES=code-one,code-two`, or mint them after the fact from the Admin dashboard (`Invites` — creates a single-use code via `POST /api/admin/invites`).
3. Share codes out-of-band (they're single-use once redeemed). Signup shows an invite-code field automatically when this mode is active.
4. Set `REGISTRATION_MODE=disabled` at any time to cut off new signups entirely without deleting invite data.

## Backup and restore

### What to back up
`./data` (all JSON metadata, including invites), `./uploads` (actual files), and `.env` (your configuration/secrets — store this somewhere safe, separately, since it's gitignored on purpose).

### Back up
```bash
docker compose stop                     # optional but safest: avoids backing up a mid-write file
tar -czf frostyy-backup-$(date +%F).tar.gz data uploads .env
docker compose start
```

### Restore
```bash
docker compose down
tar -xzf frostyy-backup-2026-01-01.tar.gz
docker compose up -d
```

### Verify a backup is good
```bash
tar -tzf frostyy-backup-2026-01-01.tar.gz | head   # lists contents without extracting
node -e "JSON.parse(require('fs').readFileSync('data/users.json'))" && echo "users.json OK"
```

### Scheduled backups (cron)
```bash
crontab -e
# Daily at 3am:
0 3 * * * cd /path/to/frostyy-cloud && tar -czf backups/frostyy-$(date +\%F).tar.gz data uploads .env
```

## Tests
```bash
npm test                  # unit test
npm run test:concurrency  # spins up a disposable server copy and hammers it with concurrent requests
npm run release-check     # runs both of the above
```

## Troubleshooting

**Port already in use / "address already in use" on startup**
```bash
PORT=3001 npm start
```
With Docker, check `docker ps` for a container already publishing that port.

**Permission denied writing to `data/` or `uploads/`**
```bash
sudo chown -R $USER:$USER data uploads
chmod -R u+rwX data uploads
```

**Uploaded files disappeared after a restart**
Confirm `docker-compose.yml` still has the `./data` and `./uploads` volume mounts. This app uses bind mounts (not anonymous volumes), so `docker compose down -v` is safe, but always check `docker ps -a` and `docker volume ls` if something looks off.

**Container won't start / crashes immediately**
```bash
docker compose logs -f
```
Look for a JSON parse error (a hand-edited `data/*.json` file with a syntax error) or an `EADDRINUSE` port conflict.

**Can't reach the app from another device on the network**
Confirm the firewall allows the port (`sudo ufw allow 3000`) and that you're using the host's LAN IP (`hostname -I`), not `localhost`.

**Set `ADMIN_EMAILS` but still not admin**
1. Check the startup log — it prints `[admin] ADMIN_EMAILS configured with N address(es).` if the app actually saw the setting. If it instead says "not set", `.env` isn't being read (make sure it's named exactly `.env` and sits next to `server.js`/`docker-compose.yml`).
2. Make sure you fully restarted the server after editing `.env` — it's only read once at startup.
3. Log out and log back in — admin status is (re)checked at login, not while a session is already active.
4. Matching checks both your account's email *and* username case-insensitively, so this works even for accounts that never set a distinct email address.

**Locked out after setting `REGISTRATION_MODE=invite`**
Temporarily set `REGISTRATION_MODE=open`, restart, create/recover your account, then switch back to `invite`. Or use the seeded `INVITE_CODES` value from `.env.example` on first run.

## Release checklist
Before exposing this beyond your home network:
- [ ] Set `SESSION_SECRET` to a long random value
- [ ] Set `REGISTRATION_MODE=invite` (or `disabled`)
- [ ] Set `ADMIN_EMAILS` to your own account
- [ ] Set `MAX_UPLOAD_MB`, `DEFAULT_USER_QUOTA_MB`, and `ADMIN_USER_QUOTA_MB` to values you're comfortable with
- [ ] Confirm `./data` and `./uploads` are bind-mounted and persist across `docker compose down && docker compose up -d`
- [ ] Take a backup and confirm you can restore it
- [ ] Put HTTPS in front of it (Cloudflare Tunnel, Caddy, or Nginx Proxy Manager) and set `NODE_ENV=production`
- [ ] Spot-check user isolation: log in as two different accounts and confirm neither can see, move into, download, or search the other's files
- [ ] Run `npm run release-check` (tests + concurrency check)
- [ ] Re-read [Current limitations](#current-limitations-be-honest-with-yourself-before-going-public) above and make sure you're comfortable with each one

## Roadmap
- Migrate metadata from JSON files to SQLite/PostgreSQL for heavier public use
- Real billing (Stripe), plan-based quota enforcement, invoicing
- Safe, real account deletion (including owned files and shares)
- Password-protected share links
- Folder drag-and-drop between cards (currently move works via the "Move to…" picker only)
