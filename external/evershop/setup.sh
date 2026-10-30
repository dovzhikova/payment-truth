#!/bin/sh
# Fetches evershop's PayPal files at a pinned commit, installs the query
# builder, and starts a throwaway Postgres on port 54329 (data in .pg/).
set -e
cd "$(dirname "$0")"
SHA=f33f72cd02bc20fd5d9b2b111bdda46b79b77200
BASE=https://raw.githubusercontent.com/evershopcommerce/evershop/$SHA/packages/evershop/src
FILES="modules/paypal/services/finalizePaypalOrder.ts
modules/paypal/services/paypalWebhook.ts
modules/paypal/pages/frontStore/paypalReturn/index.ts
modules/paypal/api/paypalWebhook/[bodyRaw]webhook.ts
modules/oms/services/updatePaymentStatus.ts
modules/oms/services/addOrderActivityLog.ts
lib/event/emitter.ts"
echo "$FILES" | while read -r f; do
  mkdir -p "vendor/src/$(dirname "$f")"
  url=$(printf '%s/%s' "$BASE" "$f" | sed 's/\[/%5B/g; s/\]/%5D/g')
  curl -fsSL "$url" -o "vendor/src/$f"
done
cp -R shims/. vendor/src/
echo "$SHA" > vendor/COMMIT
npm install --ignore-scripts --no-audit --no-fund --silent
PG=/opt/homebrew/opt/postgresql@15/bin
if [ ! -d .pg ]; then "$PG/initdb" -D .pg -U postgres --auth=trust >/dev/null; fi
"$PG/pg_ctl" -D .pg -o "-p 54329 -k /tmp" -l .pg/log status >/dev/null 2>&1 || "$PG/pg_ctl" -D .pg -o "-p 54329 -k /tmp" -l .pg/log -w start >/dev/null
"$PG/psql" -h /tmp -p 54329 -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='evershop_pt'" | grep -q 1 || "$PG/createdb" -h /tmp -p 54329 -U postgres evershop_pt
echo "evershop @ $SHA ready; Postgres on /tmp:54329"
