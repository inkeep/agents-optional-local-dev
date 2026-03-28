#!/usr/bin/env bash

set -euo pipefail

if [ -f .env ]; then
  echo "Error: .env already exists."
  exit 1
fi

# Copy example env file
cp .env.docker.example .env

# Generate secrets
nango_encryption_key=$(openssl rand -base64 32)
nango_dashboard_password=$(openssl rand -base64 8)
signoz_tokenizer_jwt_secret=$(openssl rand -base64 32)

# Create temp file
tmp_file=$(mktemp)

# Replace placeholders in .env
sed \
  -e "s|<REPLACE_WITH_NANGO_ENCRYPTION_KEY>|$nango_encryption_key|" \
  -e "s|<REPLACE_WITH_NANGO_DASHBOARD_PASSWORD>|$nango_dashboard_password|" \
  -e "s|<REPLACE_WITH_SIGNOZ_TOKENIZER_JWT_SECRET>|$signoz_tokenizer_jwt_secret|" \
  .env > "$tmp_file"

# Move updated file into place
mv "$tmp_file" .env

echo "Docker environment file created with auto-generated NANGO_ENCRYPTION_KEY, NANGO_DASHBOARD_PASSWORD, and SIGNOZ_TOKENIZER_JWT_SECRET"
