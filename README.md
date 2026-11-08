# Control Plane Gate A

Local iOS-centered control plane starter: TypeScript/Fastify API, separate worker, PostgreSQL, versioned JSON schemas, and OpenAPI.

First commands: `system.health` and `project.dailyBrief`. Pushcut is an unconfigured later adapter. This is not a production system.

`.21amg/` lineage files are preserved.

## Run locally

PostgreSQL 16 must be reachable. Either install it locally or:

```sh
docker compose up -d postgres
cp .env.example .env
npm install
npm run migrate
npm run seed
```

In two terminals:

```sh
npm run api
npm run worker
```

Health command:

```sh
curl -sS http://127.0.0.1:3000/v1/health
curl -sS -X POST http://127.0.0.1:3000/v1/commands \
  -H "Authorization: Bearer local-dev-controller-token" \
  -H "Content-Type: application/json" \
  -d '{"schemaVersion":"1.0","idempotencyKey":"health-test-20261006-0001","action":"system.health","input":{}}'
```

Daily brief uses seed project `33333333-3333-4333-8333-333333333333` and `delivery: "inbox"`.

```sh
npm test
```

Reconstructed contracts live in `packages/contracts/` and `database/`. See those `PROVENANCE.md` files.

Next required gate: **Gate B identity** (authentication, permissions, and database isolation). Do not treat Gate A as a completed release.
