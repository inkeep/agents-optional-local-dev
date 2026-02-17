## Nango: Setup and Configuration

> **Note:** If you used the automated setup (`pnpm setup-dev:optional` from the [agents](https://github.com/inkeep/agents) monorepo), Nango is already configured and the API key is written to your `.env`. The steps below are for manual setup or troubleshooting.

This guide covers how to configure the Inkeep Agents Framework to work with the self-hosted Nango instance.

### 1) Start Nango

Nango runs as part of the optional services stack:

```bash
cp .env.docker.example .env && \
  encryption_key=$(openssl rand -base64 32) && \
  sed -i '' "s|<REPLACE_WITH_NANGO_ENCRYPTION_KEY>|$encryption_key|" .env && \
  echo "Docker environment file created with auto-generated encryption key"
```

Start all services (includes Nango, SigNoz, OTEL Collector, and Jaeger):
```bash
docker compose up -d
```

**Nango Services:**
- **Nango Server**: `http://localhost:3050` (Dashboard/API)
- **Nango Connect UI**: `http://localhost:3051` (OAuth flows)


### 2) Configure the framework to use Nango

Once Nango is running, configure the framework to connect to your local instance.

**Important:** Use real credentials from your Nango dashboard (no placeholders). The framework rejects `your_nango_secret_key`.

#### Get your Nango API Key

**Option A — Pre-set via environment variable (recommended):**

Generate a key and add it to your `.env` before starting Docker:

```bash
nango_key=$(openssl rand -hex 16) && \
  echo "NANGO_SECRET_KEY_DEV=$nango_key" >> .env && \
  echo "Nango secret key: $nango_key"
```

Then restart Nango: `docker compose up -d nango-server`

Use this key as `NANGO_SECRET_KEY` in your agents `.env`.

**Option B — Copy from dashboard:**

1. Open the Nango Dashboard: `http://localhost:3050`
2. Navigate to **Environment Settings** → **API Keys**
3. Copy your **Secret Key**

#### Set the key in your agents `.env`

Add (or update) this line in your agents project `.env`:

```bash
NANGO_SECRET_KEY=<your-nango-secret-key>
```

**Restart your development processes** to pick up the new environment variables.

### 3) Verify the integration

Test that everything is working correctly:

1. **Launch the Agent Builder app** (after configuring `.env` above)
2. **Navigate to the Credentials page**: `/credentials`
3. **Click "New Credential"**
4. **Select "Bearer Authentication"**
5. **Fill in the form**:
    - Name: `your-api-key-name`
    - API Key: `your-api-key`
6. **Click "Create Credential"**
7. **Refresh the Credentials page** and verify the new credential appears

### 4) Managing the setup

**View logs:**
```bash
# View Nango logs
docker compose logs nango-server -f

# View all services
docker compose logs -f
```

**Update Nango:**
```bash
# Update providers (new integrations) - optional
curl -o nango/providers.yaml https://raw.githubusercontent.com/NangoHQ/nango/master/packages/providers/providers.yaml

# Update Docker image
docker compose pull nango-server
docker compose up -d nango-server
```

**Reset Nango data:**
```bash
# Stop services
docker compose down

# Remove Nango data (caution: this deletes all configurations and connections)
docker volume rm agents-optional-local-dev_nango-db

# Restart
docker compose up -d
```

---

## Alternative: Use Nango Cloud

Instead of self-hosting Nango, you can use Nango Cloud:

1. **Create a Nango Cloud account**: Visit [nango.dev](https://nango.dev)
2. **Get your Secret Key**: Find it in Environment Settings
3. **Configure environment variables** in your agents `.env`:

```bash
# Nango Cloud configuration
NANGO_SECRET_KEY="your-nango-cloud-secret-key"
# Leave NANGO_HOST unset to use Nango Cloud
```

**Note:** When using Nango Cloud, omit the `NANGO_HOST` environment variables to automatically use the cloud endpoints.

### References

- **Nango Documentation**: [docs.nango.dev](https://docs.nango.dev)
- **Self-hosting Config**: [docs.nango.dev/guides/self-hosting/free-self-hosting/configuration](https://docs.nango.dev/guides/self-hosting/free-self-hosting/configuration)
- **Local Setup**: [docs.nango.dev/guides/self-hosting/free-self-hosting/locally](https://docs.nango.dev/guides/self-hosting/free-self-hosting/locally)
- **Nango GitHub**: [github.com/NangoHQ/nango](https://github.com/NangoHQ/nango)
