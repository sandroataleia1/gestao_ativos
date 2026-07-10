#!/bin/sh
# Restaura um backup gerado por scripts/backup.sh — DESTRUTIVO (o dump usa
# --clean --if-exists, ou seja, apaga e recria os objetos existentes antes
# de restaurar). Sempre pede confirmação explícita. Para o serviço `app`
# antes de restaurar (evita escrita concorrente durante a restauração) e
# sobe de novo no final.
#
# Uso:
#   ./scripts/restore.sh backups/patrium_20260101_030000.sql.gz

set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$SCRIPT_DIR"

ENV_FILE=".env.production"
COMPOSE_FILE="docker-compose.prod.yml"

BACKUP_FILE="${1:-}"
if [ -z "$BACKUP_FILE" ]; then
  echo "Uso: $0 <arquivo.sql.gz>" >&2
  exit 1
fi
if [ ! -f "$BACKUP_FILE" ]; then
  echo "Erro: arquivo '$BACKUP_FILE' não encontrado." >&2
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "Erro: $ENV_FILE não encontrado." >&2
  exit 1
fi

# shellcheck disable=SC1090
. "./$ENV_FILE"

echo "!! Isso vai APAGAR os dados atuais do banco '$POSTGRES_DB' e restaurar"
echo "!! a partir de: $BACKUP_FILE"
printf "Digite RESTAURAR para confirmar: "
read -r CONFIRMATION
if [ "$CONFIRMATION" != "RESTAURAR" ]; then
  echo "Cancelado."
  exit 1
fi

echo "Parando o serviço app..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" stop app

echo "Restaurando $BACKUP_FILE ..."
gunzip -c "$BACKUP_FILE" | docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"

echo "Subindo o serviço app novamente..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" start app

echo "Restauração concluída."
