#!/bin/sh
# Bootstrap do certificado TLS — resolve o problema do ovo-e-galinha: o
# nginx (nginx/conf.d/patrium.conf) tem um bloco `listen 443 ssl` apontando
# pra certbot/conf/live/$DOMAIN/, mas esse caminho só existe DEPOIS que o
# certbot emite um certificado de verdade — e o certbot só consegue emitir
# com o nginx já respondendo o desafio ACME na porta 80. Rodar só uma vez,
# no primeiro deploy (deploys seguintes reaproveitam o certificado já
# emitido; a renovação automática é o serviço `certbot` do
# docker-compose.prod.yml).
#
# Uso: ./scripts/init-letsencrypt.sh

set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$SCRIPT_DIR"

ENV_FILE=".env.production"
COMPOSE_FILE="docker-compose.prod.yml"

if [ ! -f "$ENV_FILE" ]; then
  echo "Erro: $ENV_FILE não encontrado. Copie .env.production.example e preencha antes." >&2
  exit 1
fi
# shellcheck disable=SC1090
. "./$ENV_FILE"

if [ -z "${DOMAIN:-}" ] || [ -z "${CERTBOT_EMAIL:-}" ]; then
  echo "Erro: defina DOMAIN e CERTBOT_EMAIL em $ENV_FILE antes de rodar este script." >&2
  exit 1
fi

if grep -q "__DOMAIN__" nginx/conf.d/patrium.conf; then
  echo "Erro: substitua __DOMAIN__ por '$DOMAIN' em nginx/conf.d/patrium.conf antes de rodar este script." >&2
  echo "  sed -i \"s/__DOMAIN__/$DOMAIN/g\" nginx/conf.d/patrium.conf" >&2
  exit 1
fi

CERT_PATH="certbot/conf/live/$DOMAIN"

if [ -f "$CERT_PATH/fullchain.pem" ]; then
  echo "Já existe certificado em $CERT_PATH — nada a fazer. Renovação é automática (serviço certbot)."
  exit 0
fi

echo "1/4 — Gerando certificado dummy (autoassinado) pra permitir o nginx subir..."
mkdir -p "$CERT_PATH"
docker run --rm -v "$(pwd)/certbot/conf:/etc/letsencrypt" alpine/openssl req -x509 -nodes \
  -newkey rsa:2048 -days 1 \
  -keyout "/etc/letsencrypt/live/$DOMAIN/privkey.pem" \
  -out "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" \
  -subj "/CN=$DOMAIN"

echo "2/4 — Subindo nginx (e app/postgres) com o certificado dummy..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d postgres app nginx

echo "3/4 — Removendo o dummy e pedindo o certificado real ao Let's Encrypt..."
rm -rf "certbot/conf/live/$DOMAIN" "certbot/conf/archive/$DOMAIN" "certbot/conf/renewal/$DOMAIN.conf"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" run --rm --entrypoint "\
  certbot certonly --webroot -w /var/www/certbot \
    --email $CERTBOT_EMAIL -d $DOMAIN \
    --rsa-key-size 4096 --agree-tos --non-interactive" certbot

echo "4/4 — Recarregando o nginx com o certificado real..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec nginx nginx -s reload

echo "Pronto. Certificado emitido em $CERT_PATH — renovação automática via serviço 'certbot'."
