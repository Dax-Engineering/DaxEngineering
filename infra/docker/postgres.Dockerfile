# Postgres with the DAX role setup and point-in-time recovery (pgBackRest to R2) baked in,
# so the server needs no repo files. The initdb scripts run once, on a new data volume.
FROM postgres:18
RUN apt-get update \
 && apt-get install -y --no-install-recommends pgbackrest jq curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY infra/postgres/initdb/ /docker-entrypoint-initdb.d/
COPY --chmod=755 infra/postgres/pitr/dax-pgbackrest infra/postgres/pitr/dax-entrypoint.sh infra/postgres/pitr/pitr-agent.sh /usr/local/bin/
ENTRYPOINT ["dax-entrypoint.sh"]
CMD ["postgres"]
