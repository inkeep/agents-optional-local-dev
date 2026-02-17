# Inkeep Agents Docker Compose for Optional Local Dev

> [!WARNING]
> These Docker Compose configurations are **for local development and testing only**.
> They are **not suitable for production use** and should not be deployed in live environments.

## Automated setup (recommended)

If you're working with the [Inkeep Agents](https://github.com/inkeep/agents) monorepo or a quickstart project created with `npx @inkeep/create-agents`, run:

```bash
pnpm setup-dev:optional
```

This clones this repo into `.optional-services/` in your project, starts all services, generates credentials, and writes env vars to your `.env`. See the [main repo docs](https://github.com/inkeep/agents) for details.

Lifecycle commands:
- `pnpm optional:stop` — stop optional services
- `pnpm optional:status` — show service status
- `pnpm optional:reset` — remove all data and re-run setup

If you used the automated setup, you can skip the manual steps below.

### Direct invocation

If you cloned this repo manually and want to use the setup script directly:

```bash
CALLER_ENV_FILE=/path/to/your/project/.env ./scripts/setup.sh
./scripts/setup.sh --stop
./scripts/setup.sh --status
```

`CALLER_ENV_FILE` tells the script where to write service URLs and API keys. Required for `setup` and `--reset`; optional for `--stop` and `--status`.

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

Clone as `.optional-services/` (matching the automated setup default) or any directory you prefer.

### 2. Configure environment variables

```bash
cp .env.docker.example .env && \
  nango_encryption_key=$(openssl rand -base64 32) && \
  nango_dashboard_password=$(openssl rand -base64 8) && \
  tmp_file=$(mktemp) && \
  sed \
    -e "s|<REPLACE_WITH_NANGO_ENCRYPTION_KEY>|$nango_encryption_key|" \
    -e "s|<REPLACE_WITH_NANGO_DASHBOARD_PASSWORD>|$nango_dashboard_password|" \
    .env > "$tmp_file" && \
  mv "$tmp_file" .env && \
  echo ".env created with auto-generated NANGO_ENCRYPTION_KEY and NANGO_DASHBOARD_PASSWORD"
```

Optionally, pre-generate a Nango secret key (avoids retrieving it from the dashboard later):

```bash
_hex=$(openssl rand -hex 16) && \
  nango_key=$(echo "$_hex" | sed 's/^\(.\{8\}\)\(.\{4\}\).\(.\{3\}\).\(.\{3\}\)\(.\{12\}\)$/\1-\2-4\3-a\4-\5/') && \
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

---

## License

This project is licensed under the [Apache License 2.0](LICENSE).

This repository includes third-party configuration files under their own
licenses (MIT, ELv2). See [NOTICE](NOTICE) for details.
