#!/bin/sh
# Backup do Postgres de produção — como todo dado da aplicação (inclusive
# fotos de custódia e logo da empresa, guardados em base64 nas próprias
# colunas, mesmo padrão de CustodyPhoto.dataUrl) mora no banco, este backup
# cobre 100% do estado da aplicação; não existe volume de upload separado
# pra se preocupar.
#
# Uso:
#   ./scripts/backup.sh
#   RETENTION_DAYS=30 ./scripts/backup.sh   (padrão: 14 dias)
#
# Agendar via cron do host, ex. todo dia às 3h:
#   0 3 * * * cd /caminho/do/projeto && ./scripts/backup.sh >> backups/backup.log 2>&1

set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$SCRIPT_DIR"

ENV_FILE=".env.production"
COMPOSE_FILE="docker-compose.prod.yml"
BACKUP_DIR="backups"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Erro: $ENV_FILE não encontrado. Copie .env.production.example e preencha antes." >&2
  exit 1
fi

# shellcheck disable=SC1090
. "./$ENV_FILE"

mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUT_FILE="$BACKUP_DIR/patrium_${TIMESTAMP}.sql.gz"

echo "Gerando backup em $OUT_FILE ..."

# --clean --if-exists: o dump já vem pronto pra restaurar direto (dropa e
# recria os objetos), sem precisar de um passo manual de limpeza antes do
# restore.
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" --clean --if-exists -d "$POSTGRES_DB" \
  | gzip > "$OUT_FILE"

SIZE=$(du -h "$OUT_FILE" | cut -f1)
echo "Backup concluído: $OUT_FILE ($SIZE)"

echo "Removendo backups com mais de $RETENTION_DAYS dia(s)..."
find "$BACKUP_DIR" -name "patrium_*.sql.gz" -type f -mtime "+$RETENTION_DAYS" -print -delete
