# Checklist de deploy

Passo a passo completo em `docs/deployment.md` — esta é a versão objetiva
pra marcar item a item. Itens marcados **(1ª vez)** só se aplicam ao
primeiro deploy; os demais valem pra toda atualização.

## Antes de subir

- [ ] DNS do domínio aponta pro IP da VPS (`dig +short SEU_DOMINIO`)
      **(1ª vez)**
- [ ] Portas 80 e 443 liberadas no firewall da VPS **(1ª vez)**
- [ ] `.env.production` existe e **todas** as variáveis obrigatórias estão
      preenchidas (`POSTGRES_*`, `DOMAIN`, `CERTBOT_EMAIL`,
      `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`) — ver tabela em
      `docs/deployment.md`
- [ ] `BETTER_AUTH_SECRET` gerado com `crypto.randomBytes(32)`, não é um
      valor de exemplo/dev
- [ ] `__DOMAIN__` substituído pelo domínio real em
      `nginx/conf.d/patrium.conf` **(1ª vez)**
- [ ] `git pull` feito (deploy de atualização) / repositório clonado
      **(1ª vez)**

## Build e migração

- [ ] `docker compose -f docker-compose.prod.yml --env-file .env.production
      build app` sem erro
- [ ] `./scripts/init-letsencrypt.sh` rodado com sucesso **(1ª vez)**
- [ ] `run --rm migrate npx prisma migrate deploy` rodado sem erro
- [ ] `run --rm migrate npx prisma db seed` rodado **(1ª vez)**
- [ ] `docker compose ... up -d` (ou `up -d app` numa atualização)

## Depois de subir

- [ ] `docker compose -f docker-compose.prod.yml --env-file .env.production
      ps` — todos os serviços "healthy"/"running", nenhum reiniciando em
      loop
- [ ] `curl -I https://SEU_DOMINIO/api/health` retorna `200` e corpo com
      `"status":"ok"`
- [ ] `curl -I https://SEU_DOMINIO` mostra `Content-Encoding: gzip` e os
      headers de segurança (`Content-Security-Policy`,
      `Strict-Transport-Security`, `X-Frame-Options`) presentes
- [ ] Certificado é confiável no navegador (cadeado verde, sem aviso) —
      confirma que o certificado real (não o dummy) está ativo
- [ ] Login manual com um usuário real funciona ponta a ponta
- [ ] Dashboard carrega progressivamente sem travar (confirma que
      `proxy_buffering off` não quebrou o streaming/Suspense)
- [ ] Upload de planilha de importação funciona (confirma
      `client_max_body_size` do nginx)

## Backup e observabilidade

- [ ] `./scripts/backup.sh` rodado manualmente uma vez, arquivo
      `.sql.gz` gerado em `backups/` e com tamanho > 0
- [ ] Restore testado em ambiente que **não** é produção **(antes do 1º
      deploy real entrar em uso por usuários)**
- [ ] Cron de backup diário configurado no host (`crontab -l`)
- [ ] `METRICS_TOKEN` definido (ou acesso a `/api/metrics` restrito por
      outra via) **(1ª vez)**
- [ ] `SENTRY_DSN` configurado, ou decisão consciente de rodar só com o
      fallback de log estruturado
- [ ] `docker compose ... exec certbot certbot renew --dry-run` roda sem
      erro (confirma que a renovação automática vai funcionar antes do
      certificado vencer)
