# Imagem de produção — três estágios (deps -> builder -> runner).
#
# Por que node:22-alpine: sem binário nativo do Prisma (o generator
# `prisma-client` com `@prisma/adapter-pg` usa só `pg`, JS puro — conferido
# em app/generated/prisma, nenhum arquivo .node) e `next/image` não é usado
# em lugar nenhum do app (todo lugar usa <img>), então não precisa de
# libc/openssl específico nem de `sharp` — Alpine simples resolve.
#
# O estágio `builder` é usado também, à parte (`docker build --target
# builder` ou o serviço `migrate` do docker-compose.prod.yml), para rodar
# `prisma migrate deploy`/`prisma db seed` — ele tem o node_modules
# completo (incluindo devDependencies: prisma CLI, tsx, typescript), ao
# contrário do `runner`, que só leva o output enxuto de `output: "standalone"`.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: o hook `postinstall` (`prisma generate`) precisa de
# prisma/schema.prisma, que ainda não existe neste estágio (só copiamos
# package.json/lockfile aqui de propósito, pra cachear a layer de
# dependências independente do resto do código-fonte). O `builder` roda
# `prisma generate` explicitamente logo abaixo, depois de copiar o schema.
RUN npm ci --ignore-scripts

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Placeholder — o Next só precisa conseguir *instanciar* o PrismaClient
# durante o build (nenhuma rota conecta de verdade nesse momento; todas as
# páginas que tocam banco são dinâmicas — renderizadas por requisição, não
# no build). O valor real vem do ambiente em runtime (docker-compose.prod.yml).
ARG DATABASE_URL="postgresql://user:password@localhost:5432/db?schema=public"
ENV DATABASE_URL=${DATABASE_URL}
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# `node` (uid 1000) já vem criado na imagem oficial — nunca roda como root.
RUN mkdir -p /app/.next && chown -R node:node /app
USER node

# Formato oficial de `output: "standalone"` (node_modules/next/dist/docs/...
# /output.md): server.js mínimo + só os módulos realmente usados; public/ e
# .next/static/ precisam ser copiados manualmente porque o standalone não
# assume que ninguém mais (CDN/nginx) vai servi-los.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

EXPOSE 3000

# Reaproveita GET /api/health (app/api/health/route.ts) — já checa
# `SELECT 1` no Postgres, não precisa de endpoint novo. `wget` já vem no
# Alpine base (sem precisar instalar curl à parte).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --spider --tries=1 http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
