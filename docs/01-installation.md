# Installation

This guide takes you from nothing to a running IndexSphere you can log in to.

- [Requirements](#requirements)
- [Option A: Docker with HTTPS (recommended)](#option-a-docker-with-https-recommended)
- [Option B: Docker, plain HTTP](#option-b-docker-plain-http)
- [Option C: single container](#option-c-single-container)
- [Option D: from source (no Docker)](#option-d-from-source-no-docker)
- [First login](#first-login)
- [Verify the installation](#verify-the-installation)
- [Upgrading](#upgrading)
- [Uninstalling](#uninstalling)

---

## Requirements

| | Minimum | Recommended |
|---|---|---|
| CPU | 1 vCPU | 2 vCPU |
| Memory | 1 GB for the container | 2 GB if many users generate PDF reports at once |
| Disk | 1 GB | 5 GB (audit log and caches grow with use; see [Operations](07-operations.md#data-retention)) |
| Docker | 20.10+ with Compose v2 | — |
| Node.js (source installs only) | 20.x | 22.x LTS |

Network access IndexSphere needs:

| From IndexSphere to | Port | Why |
|---|---|---|
| Elasticsearch / OpenSearch | 9200 (or your HTTP port) | Cluster management |
| ClickHouse | 8123 (HTTP) or 8443 (HTTPS) | ClickHouse management |
| `services.nvd.nist.gov`, `api.osv.dev`, `www.cisa.gov`, `api.first.org` | 443 | Vulnerability lookups (optional, see [Vulnerabilities](05-vulnerabilities.md#air-gapped-deployments)) |
| Your SMTP server | 25 / 465 / 587 | Email alerts and scheduled reports (optional) |
| Your AI provider (OpenAI, Anthropic, Ollama, …) | 443 / 11434 | AI query builder (optional) |

Users only need to reach IndexSphere itself (443 with Option A, 3000 with Options B–D).

---

## Option A: Docker with HTTPS (recommended)

This runs IndexSphere behind NGINX with TLS, an HTTP-to-HTTPS redirect and HSTS.

```bash
git clone <your-repo-url> indexsphere && cd indexsphere

# 1. A strong secret signs sessions and encrypts stored cluster passwords. Keep it safe:
#    if it changes, users are logged out and saved connection passwords must be re-entered.
echo "JWT_SECRET=$(openssl rand -hex 32)" > .env

# 2. Start. A self-signed certificate is generated on first run.
docker compose -f docker-compose.nginx.yml --env-file .env up -d

# 3. Open https://<server-name>
```

**Use your own certificate.** Put `fullchain.pem` and `privkey.pem` in `certs/` before starting. The certificate generator skips generation when they exist.

```bash
cp /etc/letsencrypt/live/indexsphere.example.com/fullchain.pem certs/
cp /etc/letsencrypt/live/indexsphere.example.com/privkey.pem  certs/
docker compose -f docker-compose.nginx.yml --env-file .env up -d
```

## Option B: Docker, plain HTTP

Use this for internal networks or when TLS is terminated elsewhere (a load balancer, an ingress).

```bash
echo "JWT_SECRET=$(openssl rand -hex 32)" > .env
docker compose -f docker-compose.production.yml --env-file .env up -d
# Open http://<server-name>:3000
```

> The session cookie is marked `Secure` in production, and browsers refuse `Secure` cookies over plain HTTP (except on `localhost`).
> If you really serve IndexSphere over HTTP on an internal network, add `COOKIE_SECURE=false` to `.env`. Otherwise sign-in will appear to work but immediately return to the sign-in page.
> Prefer HTTPS (Option A) or a TLS-terminating proxy.

## Option C: single container

```bash
docker build -f Dockerfile.production -t indexsphere:latest .
docker run -d --name indexsphere \
  -p 3000:3000 \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -v indexsphere-data:/app/data \
  --memory 1g \
  --restart unless-stopped \
  indexsphere:latest
```

Mount `/app/data` on a volume. It holds the SQLite database with users, saved connections, alerts, reports and the audit log.

## Option D: from source (no Docker)

```bash
# Node.js 22 LTS, plus build tools for the native modules (better-sqlite3, bcrypt)
sudo apt-get install -y build-essential python3     # Debian/Ubuntu
git clone <your-repo-url> indexsphere && cd indexsphere
npm ci
npm run build

export JWT_SECRET="$(openssl rand -hex 32)"
export NODE_ENV=production
export NODE_OPTIONS=--max-old-space-size=384
npm start            # listens on :3000
```

To run it as a service, create a systemd unit like this:

```ini
# /etc/systemd/system/indexsphere.service
[Unit]
Description=IndexSphere
After=network.target

[Service]
WorkingDirectory=/opt/indexsphere
EnvironmentFile=/opt/indexsphere/.env
Environment=NODE_ENV=production
Environment=NODE_OPTIONS=--max-old-space-size=384
ExecStart=/usr/bin/npm start
Restart=on-failure
User=indexsphere

[Install]
WantedBy=multi-user.target
```

PDF reports need a Chromium. `npm ci` downloads one for Puppeteer. To use the system browser instead, set `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`.

---

## First login

1. Open IndexSphere and sign in as **`admin` / `admin`**. To choose a different initial password, set `ADMIN_DEFAULT_PASSWORD` before the first start.
2. You must change the password before anything else works, and the API refuses all other calls until you do.
3. Create the other accounts under **Advanced → User Management**. Roles are described in [Security](06-security.md#roles).
4. Add your clusters under **Advanced → Connections** (see the [User Guide](03-user-guide.md#connecting-to-a-cluster)).

The `admin/admin` default only applies while the data volume is empty. Once the password is changed it is never reset unless the volume is deleted.

## Verify the installation

```bash
curl -fsS http://localhost:3000/api/health      # {"status":"healthy",...}
docker compose -f docker-compose.nginx.yml ps   # all services "healthy"
docker logs indexsphere-prod 2>&1 | grep scheduler   # "[scheduler] started" exactly once
```

## Upgrading

```bash
git pull
docker compose -f docker-compose.nginx.yml build
docker compose -f docker-compose.nginx.yml up -d
```

Database migrations run automatically at startup and only ever add tables or columns. Back up `/app/data` first anyway (see [Operations → Backup](07-operations.md#backup-and-restore)). After an upgrade the server restarts, which logs everyone out by design.

## Uninstalling

```bash
docker compose -f docker-compose.nginx.yml down          # keep data
docker compose -f docker-compose.nginx.yml down -v       # also delete the data volume
```
