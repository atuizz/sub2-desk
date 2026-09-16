# Sub2 Desk Compose

## Full stack

Run on Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/atuizz/sub2-desk/v1.1.1/deploy/install.sh | bash
```

This installs the frontend, official Sub2API 0.2.4, PostgreSQL 18 and Redis 8. It generates persistent random credentials in `~/sub2-desk/.env` (mode 600), waits for all services and prints the initial admin login. Docker Engine is installed through its official installer if absent on Linux; root/sudo is required for that step. Docker Desktop must already be running on macOS/WSL2. Linux amd64 is the CI-tested platform.

`SUB2_DESK_PORT` and `SUB2_DESK_INSTALL_DIR` can override first-install defaults. Repeated runs preserve `.env` and Docker volumes. Service names are private to a directory-specific Compose project; only frontend port 8080 is published. Run `bash ~/sub2-desk/manage.sh ps` or `logs --tail 100` for diagnostics. Back up PostgreSQL, backend data and `.env` before upgrades. Never use `down -v` to stop a production instance.

The script pins the release and backend version; it is not an automatic database rollback or TLS installer. A domain, HTTPS and production backup scheduling are operator-managed. Official environment mappings follow [upstream deployment](https://github.com/Wei-Shaw/sub2api/blob/v0.2.4/deploy/docker-compose.yml).

## Frontend only

This Compose file runs the Sub2 Desk static frontend and proxies it to an existing compatible Sub2API backend. It does not provision or replace the backend, PostgreSQL, Redis, TLS certificates, or backups.

```sh
cp deploy/.env.example deploy/.env
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Set `SUB2API_UPSTREAM` to a reachable HTTP(S) origin without credentials, path, or trailing slash. Use a service name when the backend is on the same Compose network; use `host.docker.internal` for a host service on Docker Desktop. Put HTTPS termination and certificates in the outer reverse proxy.
