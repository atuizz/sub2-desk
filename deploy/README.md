# Sub2 Desk Compose

This Compose file runs the Sub2 Desk static frontend and proxies it to an existing compatible Sub2API backend. It does not provision or replace the backend, PostgreSQL, Redis, TLS certificates, or backups.

```sh
cp deploy/.env.example deploy/.env
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Set `SUB2API_UPSTREAM` to a reachable HTTP(S) origin without credentials, path, or trailing slash. Use a service name when the backend is on the same Compose network; use `host.docker.internal` for a host service on Docker Desktop. Put HTTPS termination and certificates in the outer reverse proxy.
