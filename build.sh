#!/bin/bash
# Netlify build: copies only the files the app needs into site/ (the published
# folder), so the SQL, edge-function source, tests and tooling aren't public,
# and generates config.js from environment variables.
set -e

rm -rf site
mkdir -p site
cp index.html confirm.html share.html app.js sw.js manifest.webmanifest apple-touch-icon.png site/
cp -r dist icons src site/
rm -f site/src/js/README.md site/src/js/core/config.example.js site/src/js/core/config.js

if [ -n "$SUPABASE_URL" ] && [ -n "$SUPABASE_PUBLISHABLE_KEY" ]; then
  cat > site/src/js/core/config.js <<EOF
window.StorecipeConfig = {
  SUPABASE_URL: "${SUPABASE_URL}",
  SUPABASE_PUBLISHABLE_KEY: "${SUPABASE_PUBLISHABLE_KEY}",
  TURNSTILE_SITE_KEY: "${TURNSTILE_SITE_KEY:-}"
};
EOF
  echo "config.js generated successfully."
else
  echo "Warning: SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY not set. Skipping config.js."
fi
