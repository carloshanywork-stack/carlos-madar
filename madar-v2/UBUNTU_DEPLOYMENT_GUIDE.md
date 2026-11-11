# MADAR V2 — Ubuntu Production Deployment

This guide deploys the V2 SPA and API as one Node.js process managed by PM2, with Cloudflare Tunnel as the public HTTPS ingress. With `STORAGE_MOUNT_PATH` configured, SQLite, uploads, and backups stay on the mounted data filesystem while application code remains on `/`. Use one PM2 fork only; do not scale this SQLite-backed service to multiple workers. Cloudflare Tunnel needs outbound connectivity from the server and does not require an inbound public IP, port forwarding, VPN, Nginx, or an open port 3000.

The supplied deployment script updates the installation in place and stops an existing PM2 app while it installs dependencies and applies database migrations. Schedule a maintenance window. For an existing installation, create and verify a MADAR backup before deploying; the default backups remain on this server and do not replace a separate protected backup copy. The deployment script requires the storage mount to be present and writable before proceeding.

## 1. Ubuntu prerequisites

On Ubuntu 22.04 or 24.04 LTS:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential python3 ufw cron
```

Allow SSH before enabling UFW. For the Tunnel deployment, do not open ports 80, 443, or 3000 inbound; Node binds to loopback and `cloudflared` creates outbound connections. The default UFW policy permits outbound traffic. If egress is restricted, allow DNS and Cloudflare Tunnel connectivity on port 7844 (UDP and TCP), plus HTTPS as required for updates.

```bash
sudo ufw allow OpenSSH
sudo ufw enable
sudo ufw status
sudo systemctl enable --now cron
```

## 2. Install Node.js 22 LTS and PM2

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
node --version
npm --version
pm2 --version
```

Confirm Node reports version 22 or newer. The locked `better-sqlite3` dependency includes a native addon that is rebuilt by the deployment script.

## 3. Clone and configure MADAR V2

Run the application and PM2 under one unprivileged Unix account, not root. For example, create a deployment account and clone the repository as that account:

```bash
sudo adduser --disabled-password --gecos '' madar
sudo install -d -o madar -g madar /var/www/madar-v2
sudo -u madar -H git clone <repository-url> /var/www/madar-v2
```

If the project is already checked out, ensure the MADAR user owns the checkout and its runtime directories. Do not make the project or `.env` world-writable/readable.

### Prepare the separate storage filesystem

Use an already partitioned and formatted filesystem for `/mnt/storage`; **do not run `mkfs`, repartition a disk, or overwrite existing data as part of deployment**. Identify the intended disk and filesystem UUID first:

```bash
lsblk -o NAME,FSTYPE,UUID,SIZE,MOUNTPOINTS
sudo blkid
```

Create the mountpoint, add the filesystem UUID to `/etc/fstab`, and mount it. Use the actual UUID and filesystem type for the storage disk:

```bash
sudo install -d -m 0755 /mnt/storage
sudo nano /etc/fstab
# Example fstab entry (replace UUID and filesystem type; do not format the disk):
# UUID=<storage-filesystem-uuid> /mnt/storage ext4 defaults,noatime,nofail 0 2
sudo mount /mnt/storage
mountpoint /mnt/storage
findmnt /mnt/storage
```

Confirm with `lsblk`/`findmnt` that `/mnt/storage` is on the intended independent device, not merely a directory or bind mount on `/`. Then grant the MADAR service account access to the mounted filesystem root:

```bash
sudo chown madar:madar /mnt/storage
sudo chmod 700 /mnt/storage
```

The application derives these roots from the mount unless explicit overrides are supplied: `/mnt/storage/data` (SQLite, WAL/SHM, thumbnail cache), `/mnt/storage/uploads` (photos and other stored files), and `/mnt/storage/Backups`. Any `MADAR_V2_DATA_DIR`, `MADAR_V2_DATABASE_PATH`, `MADAR_V2_STORAGE_ROOT`, or `MADAR_V2_BACKUP_ROOT` override must remain beneath `/mnt/storage`. Startup verifies an exact Linux mountpoint on a filesystem device different from `/` and fails closed if the mount is absent. This confirms a separate mounted filesystem, not the physical disk topology; verify that separately with `lsblk`.

For an existing MADAR installation, do not just change the path and start the app: first stop it cleanly, make and verify a backup, copy the existing SQLite data and storage tree onto the mounted filesystem, and verify the database and files before enabling the new paths. The application refuses to create a new empty database when it detects the default old database but not the mounted copy. No automatic live-data move is performed.

Create the V2 environment file and edit it as the MADAR account:

```bash
cd /var/www/madar-v2
sudo -u madar -H cp .env.example .env
sudo -u madar -H chmod 600 .env
sudo -u madar -H nano .env
```

Set production values in `.env`. Replace the example hostname and generate a unique signing key with `openssl rand -hex 32`; paste the resulting 64 hexadecimal characters without quotes. Do not commit or share the key.

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
STORAGE_MOUNT_PATH=/mnt/storage
MADAR_V2_JWT_SECRET=<64-hex-character-secret>
REP_ATTENDANCE_MAX_OFFLINE_AGE_HOURS=24
CORS_ORIGINS=https://madar.example.com
COOKIE_SECURE=true
```

`MADAR_V2_JWT_SECRET` must be at least 32 bytes. `REP_ATTENDANCE_MAX_OFFLINE_AGE_HOURS` must be a positive finite number; it defaults to 24 hours. Older offline punches are retained on the representative device for administrator reconciliation and are not applied to payroll. Keep `HOST=127.0.0.1`: the app should not be directly reachable from the network. `COOKIE_SECURE=true` requires HTTPS in the browser, so configure TLS before completing administrator setup or logging in remotely. Leave `MADAR_INITIAL_ADMIN_PASSWORD` unset to create the first administrator using the app's one-time setup screen.

Leave the `MADAR_V2_*` data/database/storage/backup path overrides unset for the standard layout so they resolve under `/mnt/storage`. The deploy script creates and restricts the configured mount-backed runtime directories, plus system-partition `logs/` and `server/assets/`; it does not recursively chmod the source tree.

## 4. Build, initialize, and start with PM2

As the MADAR account:

```bash
cd /var/www/madar-v2
./deploy-ubuntu.sh
```

The script requires the committed lockfiles, uses `npm ci`, rebuilds `better-sqlite3` and `sharp`, builds `client/dist`, runs the additive database initializer, starts/reloads the single PM2 fork, saves the PM2 process list, and checks `http://127.0.0.1:3000/api/health`.

Check process status and logs:

```bash
pm2 status
pm2 logs madar-v2
curl --fail http://127.0.0.1:3000/api/health
```

Expected health response: `{"status":"ok","service":"madar-v2"}`.

## 5. Enable PM2 at boot

Run `pm2 startup` as the MADAR user. PM2 prints a command that must be run with `sudo`; run that exact command, then save the PM2 process list again as MADAR:

```bash
sudo -iu madar
pm2 startup systemd
# Run the sudo command printed by PM2 in a separate privileged shell.
pm2 save
exit
```

After setup, verify the generated `pm2-madar` systemd service is enabled. PM2 must be started, saved, and restarted as the same Unix account that owns the application files. Make the PM2 unit require the storage mount so it cannot start before the data filesystem:

```bash
sudo systemctl edit pm2-madar.service
```

Add this drop-in, then reload systemd. If PM2 generated a differently named unit, use that unit name instead.

```ini
[Unit]
RequiresMountsFor=/mnt/storage
After=mnt-storage.mount
```

```bash
sudo systemctl daemon-reload
sudo systemctl restart pm2-madar.service
```

## 6. Create the first administrator before public access

The application must not be publicly reachable while first-run administrator setup is still open. Keep the Cloudflare Tunnel stopped and complete one-time setup over SSH port forwarding after deployment. From the administrator workstation, run:

```bash
ssh -L 3000:127.0.0.1:3000 <ssh-user>@<server-address>
```

While that SSH connection is open, visit `http://127.0.0.1:3000` in a browser on the workstation and create the first administrator with a unique password of at least 4 characters (and no more than 72 UTF-8 bytes). Sign out and back in to verify the account. The setup endpoint is single-use once an account exists. Do not expose the app through a public hostname until this step is complete.

## 7. Configure the production Cloudflare Tunnel

A stable named Tunnel needs a Cloudflare account and a domain added to Cloudflare; the domain registration itself may have a cost. Quick Tunnels use a temporary `trycloudflare.com` hostname, have no uptime guarantee, and are for testing only. Do not use a Quick Tunnel for production. See Cloudflare's [Tunnel setup](https://developers.cloudflare.com/tunnel/get-started/) and [Quick Tunnel limitations](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) documentation.

Install the official Cloudflare `cloudflared` package on Ubuntu 24.04 amd64 (use the matching `arm64` package if the server is ARM-based):

```bash
cd /var/tmp
curl -fL --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo apt install ./cloudflared.deb
rm cloudflared.deb
cloudflared --version
```

In the Cloudflare dashboard, open **Networking → Tunnels**, create a named tunnel, and choose Linux/amd64 (or the server's actual architecture). The dashboard provides a connector token. Add a **Published application** route for a hostname such as `rep.example.com`, selecting the Cloudflare-managed domain and using this service URL:

```text
http://127.0.0.1:3000
```

Install and start the connector as a system service. Enter the token at the hidden prompt instead of putting its literal value in shell history. Do not commit it, put it in MADAR's `.env`, paste it into tickets, or save it in shell scripts.

```bash
read -rsp 'Cloudflare Tunnel token: ' TUNNEL_TOKEN; printf '\n'
sudo cloudflared service install "$TUNNEL_TOKEN"
unset TUNNEL_TOKEN
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared --no-pager
journalctl -u cloudflared -n 50 --no-pager
```

Do not enable the public route until first-admin setup above is verified. Confirm the tunnel reports **Healthy**, then test `https://rep.example.com/api/health` and sign in from a 4G/5G device. Public HTTPS is terminated at Cloudflare; the origin connection is loopback HTTP on this same host. Keep `COOKIE_SECURE=true`. The MADAR login remains required; a Cloudflare Access policy can be added as an additional access layer if its identity flow suits all representatives.

Cloudflare's plan-specific [maximum request-body size](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/4xx-client-error/error-413/) still applies to uploads sent through the public hostname (Free currently documents a 100 MB limit). MADAR's restore endpoint can accept much larger ZIPs, so restore large backups over SSH/local trusted access or verify Cloudflare's current plan limit before relying on public uploads. Test the largest representative photo/folder upload expected in normal use.

The Tunnel does not need a static IP or inbound firewall rule. It does not make the Ubuntu host, PM2, or the disk independently redundant; the server and internet connection must still be powered and available.

## 8. Optional alternative: Nginx ingress

This is an alternative to Cloudflare Tunnel, not a required part of the Tunnel setup. It requires a public IP/DNS route and inbound web access. Edit `nginx-madar.conf` and replace `server_name _;` with the actual domain. Install Nginx, allow ports 80/443, install and enable the site:

```bash
sudo apt install -y nginx
sudo ufw allow 'Nginx Full'
sudo ln -s /var/www/madar-v2/nginx-madar.conf /etc/nginx/sites-available/madar
sudo ln -s /etc/nginx/sites-available/madar /etc/nginx/sites-enabled/madar
sudo nginx -t
sudo systemctl reload nginx
```

If the destination symlink already exists, inspect it before changing it. The Nginx template allows 250 MB request bodies and long-running uploads/exports, and forwards Socket.IO websocket upgrades. Application-level upload limits still apply.

### HTTPS with Certbot (strongly recommended)

For internet-facing use, enable HTTPS before entering credentials. Keep `COOKIE_SECURE=true`; secure session cookies are not sent over plain HTTP. With DNS and ports 80/443 reachable:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d madar.example.com
sudo nginx -t && sudo systemctl reload nginx
```

Follow Certbot's prompts, including its HTTP-to-HTTPS redirect option. Complete first-administrator setup over SSH port forwarding before directing public DNS to Nginx, then verify `https://madar.example.com/api/health`. For a private LAN-only installation without TLS, do not expose it to the internet; secure cookies require HTTPS, so an HTTP-only setup must deliberately set `COOKIE_SECURE=false` and accept that limitation.

## 9. Daily storage-space alert and operations

The Admin Settings page's **System health and storage** panel reports process uptime, SQLite integrity, total/available capacity, and free percentage for the configured storage filesystem. Detailed health is Admin-only at `GET /api/system/health`; the unauthenticated `GET /api/health` intentionally remains a minimal liveness response for startup checks.

Install a daily host-level check. It runs independently of Node/PM2, confirms `/mnt/storage` is still an actual mount on a different device from `/`, logs low-space alerts to the system journal, and returns an error if the mount is missing rather than measuring the root filesystem:

```bash
bash /var/www/madar-v2/scripts/check-storage-space.sh /mnt/storage 15
sudo crontab -u madar -e
```

Add this line to the MADAR user's crontab (change the time if needed):

```cron
15 8 * * * /usr/bin/bash /var/www/madar-v2/scripts/check-storage-space.sh /mnt/storage 15
```

View alerts with `sudo journalctl -t madar-storage-alert`. If the host has a configured local mail transfer agent, set `MAILTO=ops@example.com` in that crontab to receive the script's warning output by email. The check warns below 15% free and exits non-zero; it does not delete files or backups automatically.

## 10. Operations and safety

- PM2 uses one forked process because the app uses local SQLite and filesystem coordination.
- The app listens only on `127.0.0.1:3000`; Cloudflare Tunnel connects to that loopback address. Never open Node's port 3000 to the network.
- Keep `.env`, SQLite files, customer storage, PM2 logs, and backups private. The deployment script intentionally does not recursively chmod the source tree.
- MADAR's scheduled ZIP backups default to `/mnt/storage/Backups`. Set a separate, protected backup destination/retention policy and periodically test restores on an isolated copy; a backup on the same disk is not disaster recovery.
- `scripts/cloud-backup.sh` creates an **encrypted local** ZIP bundle; it does not upload data. Install `python3`, Info-ZIP (`zip`), GnuPG (`gpg`), and GNU `realpath`/coreutils. Store a passphrase of at least 16 characters in a mode-`0600` key file readable only by the account running the script, outside the repository. The script reads path/passphrase settings from its process environment (it does not source `.env`); with the storage mount exported, default bundle paths follow `/mnt/storage/data`, `/mnt/storage/uploads`, and `/mnt/storage/Backups`.
- Example manual invocation (set the actual protected key-file path first):

  ```bash
  STORAGE_MOUNT_PATH=/mnt/storage \
  MADAR_BACKUP_PASSPHRASE_FILE=/etc/madar/backup-passphrase \
    /usr/bin/bash /var/www/madar-v2/scripts/cloud-backup.sh
  ```

  The output reports its creation time and size. It contains the SQLite online snapshot, configured storage tree (excluding root `.incoming` and `.madar-recovery` stages), and selected configuration/dependency files. It can include encrypted copies of `.env`; protect the passphrase separately. The script copies storage outside the API's maintenance lock, so pause external storage writers and retain MADAR's own backup/restore procedure as the primary consistency-aware workflow. No retention or automatic deletion policy is configured.
- Before redeploying an existing production database, create a fresh backup through MADAR and confirm it completed. The initializer applies schema migrations; do not delete or recreate the database during deployment.
- Inspect `pm2 logs madar-v2`, `sudo journalctl -u cloudflared`, and (only for the optional Nginx setup) Nginx logs after errors or restarts.

## Local verification before deployment

From `madar-v2/` on the development machine:

```bash
npm test
npm --prefix client run build
npm run android:sync
```

The Ubuntu deploy and backup scripts should also pass `bash -n deploy-ubuntu.sh` and `bash -n scripts/cloud-backup.sh` on the server before running. The encrypted backup command itself still requires a disposable test database/storage tree and locally installed `zip`/`gpg` utilities to verify end to end. Validate Nginx syntax with `sudo nginx -t` after installing the site.
