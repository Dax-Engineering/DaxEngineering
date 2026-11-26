# Postgres with the DAX role setup baked in, so the server needs no repo files.
# The scripts in initdb run once, when the data volume is first created.
FROM postgres:18-alpine
COPY infra/postgres/initdb/ /docker-entrypoint-initdb.d/
