# Deploy de produção (Docker)

Como colocar o Patrium (Gestão de Ativos) no ar numa VPS usando Docker
Compose: aplicação, Postgres e nginx (TLS + compressão + cache) em
containers, com backup/restore e health checks.

## Arquitetura

```
                      ┌────────────────────────────────────────┐
 Internet ── 80/443 ─▶│ nginx (container, IP fixo 172.28.0.10)  │
                      │  - TLS (Let's Encrypt via certbot)      │
                      │  - gzip, cache de _next/static          │
                      │  - proxy_buffering off (streaming)      │
                      └───────────────┬──────────────────────────┘
                                       │ rede interna patrium_net
                      ┌────────────────▼──────────┐   ┌───────────────┐
                      │ app (Next.js, porta 3000)  │──▶│ postgres      │
                      │ output: standalone         │   │ (sem porta    │
                      └────────────────────────────┘   │ publicada)    │
                                                        └───────────────┘
```

Só as portas 80/443 do `nginx` são publicadas no host. `app` e `postgres`
só existem dentro da rede `patrium_net` — não são alcançáveis diretamente
da internet.

Um único container `app` (não múltiplas réplicas): rate limiting
(`lib/rate-limit.ts`) e cache (`lib/cache.ts`) são em memória do processo,
por design (ver comentários nesses arquivos) — não escale horizontalmente
sem migrar isso para um storage compartilhado primeiro.

## Pré-requisitos

- Docker Engine + Docker Compose plugin instalados na VPS (`docker
  compose version`).
- Domínio já com o DNS apontando pro IP da VPS (registro `A`), **antes** de
  rodar o bootstrap de TLS — o Let's Encrypt valida por HTTP.
- Portas 80 e 443 liberadas no firewall da VPS.

## Primeiro deploy

1. Clonar o repositório na VPS e entrar na pasta do projeto.

2. Criar o arquivo de variáveis de ambiente:
   ```bash
   cp .env.production.example .env.production
   ```
   Preencher **todas** as variáveis — ver tabela completa mais abaixo.
   Gerar o segredo do Better Auth:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

3. Ajustar o domínio no nginx (o arquivo vem com um placeholder):
   ```bash
   sed -i "s/__DOMAIN__/SEU_DOMINIO_AQUI/g" nginx/conf.d/patrium.conf
   ```
   (mesmo domínio que você colocou em `DOMAIN=` no `.env.production`).

4. Emitir o certificado TLS (só uma vez — resolve o bootstrap
   ovo-e-galinha do nginx precisar de um certificado antes de conseguir
   subir; ver comentários em `scripts/init-letsencrypt.sh`):
   ```bash
   ./scripts/init-letsencrypt.sh
   ```

5. Rodar as migrations e o seed inicial (o serviço `migrate` só sobe sob
   demanda — usa o estágio `builder` do `Dockerfile`, que tem o Prisma CLI
   completo; o `app` roda só o output enxuto de `output: standalone` e não
   tem essas ferramentas):
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production \
     run --rm migrate npx prisma migrate deploy
   docker compose -f docker-compose.prod.yml --env-file .env.production \
     run --rm migrate npx prisma db seed
   ```

6. Confirmar que os 3 serviços principais estão de pé e saudáveis:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production ps
   curl -I https://SEU_DOMINIO_AQUI/api/health
   ```

## Deploy de atualização (código já rodando antes)

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production build app
docker compose -f docker-compose.prod.yml --env-file .env.production \
  run --rm migrate npx prisma migrate deploy
docker compose -f docker-compose.prod.yml --env-file .env.production up -d app
```

`up -d app` recria só o container da aplicação (nova imagem), sem tocar em
`postgres`/`nginx`/`certbot` — sem perda de dados, e o Postgres nem
reinicia.

## Backup e restore

```bash
./scripts/backup.sh                    # gera backups/patrium_<timestamp>.sql.gz
RETENTION_DAYS=30 ./scripts/backup.sh   # muda a retenção (padrão: 14 dias)

./scripts/restore.sh backups/patrium_20260101_030000.sql.gz
```

Como toda a informação da aplicação (inclusive fotos de custódia e logo da
empresa, guardadas em base64 nas próprias colunas) mora no Postgres, este
backup cobre 100% do estado — não existe volume de upload de arquivo
separado para se preocupar.

`restore.sh` é destrutivo (o dump usa `--clean --if-exists`) — pede
confirmação explícita digitando `RESTAURAR`, para o serviço `app` antes de
restaurar, e sobe ele de novo no final.

Agendar backup diário via cron do host:
```
0 3 * * * cd /caminho/do/projeto && ./scripts/backup.sh >> backups/backup.log 2>&1
```

**Teste o restore pelo menos uma vez, num ambiente que não seja produção,**
antes de confiar nele numa emergência real.

## Renovação de certificado

Automática — o serviço `certbot` do `docker-compose.prod.yml` roda em loop
(`certbot renew` a cada 12h; só renova certificados a menos de 30 dias do
vencimento). Testar sem gastar o limite de emissões do Let's Encrypt:
```bash
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec certbot certbot renew --dry-run
```

## Variáveis de ambiente

Ver `.env.production.example` para o template completo com comentários.
Resumo:

| Variável | Obrigatória | Descrição |
|---|---|---|
| `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` | Sim | Credenciais do Postgres (container `postgres` + `DATABASE_URL` do `app`, montada pelo Compose). |
| `DOMAIN` / `CERTBOT_EMAIL` | Sim | Domínio público e e-mail pro Let's Encrypt. |
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` | Sim | Autenticação (assinatura de sessão) e URL pública (`https://` + `DOMAIN`). |
| `EVOLUTION_API_URL` / `EVOLUTION_API_ADMIN_KEY` | Não | Sem isso, "Conectar WhatsApp" fica indisponível; resto do app funciona normalmente. |
| `SENTRY_DSN` | Não | Sem DSN, cai no fallback de log estruturado. |
| `SMTP_*` | Não | Sem `SMTP_HOST`, recuperação de senha só loga em vez de enviar e-mail de verdade. |
| `LOG_LEVEL` | Não | Padrão `info`. |
| `METRICS_TOKEN` | Recomendado | Protege `GET /api/metrics`; sem ele, o endpoint fica aberto. |

## Observabilidade

- `GET /api/health` — status do banco, versão, uptime (usado pelo
  `HEALTHCHECK` do container e do Compose). Ver `app/api/health/route.ts`.
- `GET /api/metrics` (Prometheus) — protegido por `METRICS_TOKEN`. Ver
  `docs/observability.md` para o formato completo e como integrar com
  Grafana/Prometheus.
- Logging estruturado e auditoria: `docs/observability.md`.
- Escala/paginação/cache de aplicação: `docs/performance.md`.

## Troubleshooting

- **`init-letsencrypt.sh` falha pedindo o certificado real**: confirme que
  o DNS do domínio já resolve pro IP da VPS (`dig +short SEU_DOMINIO`) e
  que a porta 80 está acessível externamente antes de rodar o script de
  novo.
- **Container `app` fica "unhealthy"**: `docker compose -f
  docker-compose.prod.yml --env-file .env.production logs app` — geralmente
  `DATABASE_URL`/credenciais erradas ou o Postgres ainda não estava pronto
  (o `depends_on: condition: service_healthy` deveria evitar isso, mas
  confira `docker compose ps` pro status do `postgres`).
- **Streaming trava/demora demais** (Dashboard não aparece progressivamente):
  confirme que `nginx/conf.d/patrium.conf` tem `proxy_buffering off;` no
  bloco `location /` e que `next.config.ts` ainda manda o header
  `X-Accel-Buffering: no`.
- **Upload de planilha de importação falha com "Payload too large"**:
  `client_max_body_size` em `nginx/nginx.conf` (hoje 10MB) precisa ser ≥ o
  limite da própria aplicação (`MAX_FILE_SIZE_BYTES` em
  `lib/imports/process.ts`, hoje 5MB).
