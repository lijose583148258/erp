#!/usr/bin/env bash
set -euo pipefail

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"   --set=replication_password="$POSTGRES_REPLICATION_PASSWORD" <<'SQL'
CREATE ROLE ailaoda_replica WITH REPLICATION LOGIN PASSWORD :'replication_password';
SQL

printf '\nhost replication ailaoda_replica 0.0.0.0/0 scram-sha-256\n' >> "$PGDATA/pg_hba.conf"
