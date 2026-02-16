# Inkeep Agents Docker Compose for Optional Local Dev

> [!WARNING]
> These Docker Compose configurations are **for local development and testing only**.
> They are **not suitable for production use** and should not be deployed in live environments.

## Automated setup (recommended)

If you're working with the [Inkeep Agents](https://github.com/inkeep/agents) monorepo or a quickstart project created with `npx @inkeep/create-agents`, run:

```bash
pnpm setup-dev:optional
```

This clones this repo, starts all services, generates credentials, and wires env vars to your `.env` automatically. See the [main repo docs](https://github.com/inkeep/agents) for details.

Lifecycle commands:
- `pnpm optional:stop` — stop optional services
- `pnpm optional:status` — show service status
- `pnpm optional:reset` — nuke data and re-setup from scratch

If you used the automated setup, you can skip the manual steps below.

---

## Services overview

This setup provides 4 service profiles for local development with the Inkeep Agents Framework:

### 1. [Nango](https://github.com/NangoHQ/nango)
Inkeep Agents uses Nango to store credentials.
- **Nango Server**: `localhost:3050`
- **Nango Connect UI**: `localhost:3051`

### 2. [SigNoz](https://github.com/SigNoz/signoz)
SigNoz is the underlying service to view Spans and Traces in the Inkeep Manage UI.
- **SigNoz UI**: `localhost:3080`
- **OTLP gRPC**: `localhost:4317`
- **OTLP HTTP**: `localhost:4318`

### 3. [OTEL Collector](https://github.com/open-telemetry/opentelemetry-collector)
A standalone OpenTelemetry Collector that forwards traces to multiple destinations. The Inkeep Agents API sends traces to the OTEL Collector, which then forwards them to SigNoz and Jaeger.
- **OTLP gRPC**: `localhost:14317`
- **OTLP HTTP**: `localhost:14318`

### 4. [Jaeger](https://github.com/jaegertracing/jaeger)
An optional tool to view traces from the Inkeep Agents Framework.
- **Jaeger UI**: `localhost:16686`
- **OTLP gRPC**: `localhost:24317`
- **OTLP HTTP**: `localhost:24318`

---

## Manual setup

Use these steps if you're running this repo standalone (without `pnpm setup-dev:optional`).

### 1. Clone this repository

### 2. Configure environment variables

```bash
cp .env.docker.example .env && \
  encryption_key=$(openssl rand -base64 32) && \
  sed -i '' "s|<REPLACE_WITH_NANGO_ENCRYPTION_KEY>|$encryption_key|" .env && \
  echo "Docker environment file created with auto-generated encryption key"
```

Optionally, generate a Nango API secret key (so you don't need to retrieve it from the dashboard later):

```bash
nango_key=$(openssl rand -hex 16) && \
  echo "NANGO_SECRET_KEY_DEV=$nango_key" >> .env && \
  echo "Nango secret key: $nango_key (add this as NANGO_SECRET_KEY in your agents .env)"
```

### 3. Start

```bash
docker compose up -d
```

### 4. Retrieve `NANGO_SECRET_KEY`

If you set `NANGO_SECRET_KEY_DEV` in step 2, use that value as `NANGO_SECRET_KEY` in your agents `.env`.

Otherwise, retrieve it from the Nango dashboard:
- Open Nango at `http://localhost:3050`
- Navigate to Environment Settings and copy the Secret Key

### 5. Create `SIGNOZ_API_KEY`

- Open SigNoz at `http://localhost:3080`
- Create an account on first login
- Navigate to Settings → Account Settings → API Keys → New Key
- Create a new API key with at least the Viewer role

---

## Updating

```bash
docker compose stop
docker compose rm -f
docker compose pull
docker compose up -d
```
