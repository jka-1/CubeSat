# CubeSat Demo Repo

This bundle is set up to become the private GitHub repo for the demo-facing telemetry system.

It contains:

- `site/` — the static web files that should live at `/var/www/html`
- `telemetry-bridge/server.js` — the Node UDP-to-SSE bridge that should live at `/opt/cubesat-telemetry/server.js`
- `TELEMETRY_PACKET_V1.md` — the fixed 16-bit packet layout notes for the ESP-to-droplet stream
- `scripts/backup-live.sh` — backs up the currently deployed site and bridge on the droplet
- `scripts/deploy-live.sh` — copies this repo's files into the live droplet paths
- `scripts/rollback-live.sh` — restores a previous backup

The bridge currently accepts:

- the older JSON packet shapes
- the legacy raw INA226 hex packet (`0x0001`)
- the recommended engineering-units hex packet (`0x0002`)
- dashboard command requests at `/command` and `/api/demo/command`

## Recommended GitHub model

- Keep this repo private.
- Treat `main` as "what we are comfortable deploying."
- Make changes on short-lived branches like `feature/i2c-demo-dashboard`.
- Merge into `main` only after you are ready to deploy.
- Add a tag before each live deploy, for example `deploy-2026-08-03-01`.

## Recommended local workflow

1. Clone the private GitHub repo on your laptop.
2. Make changes locally first.
3. Commit and push to a feature branch.
4. Merge into `main` when ready.
5. On the droplet, pull the latest `main`.
6. Run `scripts/backup-live.sh`.
7. Run `scripts/deploy-live.sh`.

## Suggested repo bootstrap

After you create the private GitHub repo, from your laptop:

```bash
git init
git branch -M main
git remote add origin <your-private-github-repo-url>
git add .
git commit -m "Initial telemetry dashboard and bridge import"
git push -u origin main
```

## Suggested droplet checkout

Do not use `/var/www/html` itself as the Git checkout.

Instead, clone the repo into a separate working folder on the droplet, for example:

```bash
mkdir -p /opt/cubesat-demo
cd /opt/cubesat-demo
git clone <your-private-github-repo-url> repo
```

Then deploy from:

```bash
cd /opt/cubesat-demo/repo
SERVICE_NAME=<your-service-name> ./scripts/backup-live.sh
SERVICE_NAME=<your-service-name> ./scripts/deploy-live.sh
```

## Paths assumed by the scripts

- live site root: `/var/www/html`
- live bridge file: `/opt/cubesat-telemetry/server.js`

You can override them with environment variables:

```bash
SITE_ROOT=/var/www/html
BRIDGE_FILE=/opt/cubesat-telemetry/server.js
SERVICE_NAME=<your-service-name>
HEX_DEVICE_ID=esp32-telemetry
PV_INA226_CURRENT_LSB_A=0.001
LOAD_INA226_CURRENT_LSB_A=0.001
MPPT_FAULT_BIT_NAMES=bit0,bit1,bit2,bit3
COMMAND_TARGET_HOST=<optional-fixed-esp32-ip>
COMMAND_TARGET_PORT=<optional-fixed-esp32-port>
```

`PV_INA226_CURRENT_LSB_A` and `LOAD_INA226_CURRENT_LSB_A` are only needed when using the legacy raw INA226 packet format (`0x0001`). The recommended engineering packet (`0x0002`) does not depend on them.

## Finding the service name

On the droplet:

```bash
systemctl list-units --type=service | grep -i cubesat
```

Use the service name shown there when running the scripts.

## Firmware follow-up

The current front-end and bridge can move forward now. Firmware still needs to confirm:

- one real sample packet
- the real shunt value if it is not `100 mΩ`
- MPPT fault meanings
- the dev-board LED test pin or the exact LED demo file
- whether commands will be parsed as the bridge JSON command payloads or a custom raw payload

That is no longer a blocker for setting up the repo and deployment workflow.
