# Performance e escala

Este documento registra as mudanças feitas para preparar o app para empresas
com milhares de registros (ativos, colaboradores, custódias, movimentações
de estoque), a metodologia usada para medir o resultado, e as limitações
conhecidas que ficaram deliberadamente fora desta entrega.

## Metodologia

- **Dados de carga**: `npm run db:seed:bulk` (`prisma/seed-bulk.ts`), rodado
  contra a empresa demo. Gera, em lotes de 500 (`createMany`/
  `createManyAndReturn`):
  - 2.000 colaboradores, 10 departamentos, 10 cargos
  - 5.000 ativos (~70% consumível / 30% individual), 6 categorias, 4
    fabricantes, 1 fornecedor
  - Saldo de estoque para os consumíveis + unidades individuais para o
    restante, com movimentações de entrada
  - 500 certificações CA (1/3 vencidas, 1/3 vencendo em até 30 dias, 1/3
    vigentes por mais tempo)
  - 8.000 custódias (mix de ativas/devolvidas/atrasadas — ~60% devolvida,
    ~15% das ativas propositalmente atrasada), respeitando o índice único
    parcial que impede duas custódias ACTIVE para a mesma unidade
- **Ambiente**: build de produção (`npm run build && npm run start`) na
  mesma VPS/máquina de desenvolvimento — não é um ambiente isolado/dedicado
  de benchmark, então os números são indicativos de melhoria relativa
  (antes x depois da mesma stack), não uma cota de SLA.
- **Medição**: `scripts/profile.mjs` — autentica como admin da empresa
  demo, mede tempo de parede (`fetch`) e nº de queries Prisma por página
  (via `PRISMA_LOG_QUERIES=true` + `app/api/debug/query-stats`, só
  disponível com essa env var). Cada página é aquecida uma vez (compilação/
  cache de rota) antes da medição real.
- Rodar de novo a qualquer momento:
  ```bash
  PRISMA_LOG_QUERIES=true npm run build && PRISMA_LOG_QUERIES=true npm run start
  node scripts/profile.mjs
  ```

## Resultado — tempo de resposta e nº de queries (produção, dados em massa)

| Página | Tempo (ms) | Queries Prisma | Tempo total no banco |
|---|---:|---:|---:|
| `/dashboard` | 392 | 64 | 2.478ms* |
| `/assets` | 320 | 29 | 1.111ms* |
| `/employees` | 137 | 14 | 179ms |
| `/stock` | 628 | 44 | 1.984ms* |
| `/custodies?tab=active` | 402 | 44 | 1.172ms* |
| `/custodies?tab=history` | 417 | 48 | 1.181ms* |
| `/custodies?tab=overdue` | 365 | 42 | 1.070ms* |
| `/cadastros/categorias` | 65 | 10 | 58ms |
| `/reports?tab=assets` | 483 | 31 | 620ms |
| `/reports?tab=stock` | 1.533 | 25 | 1.389ms |
| `/reports?tab=custodies` | 687 | 31 | 1.574ms |
| `/reports?tab=ca` | 296 | 19 | 304ms |
| `/alerts` | 285 | 18 | 507ms |

\* Tempo no banco maior que o tempo de parede da página é esperado: várias
consultas rodam em paralelo (`Promise.all`), então a soma das durações
individuais passa da duração total da requisição.

Todas as páginas de listagem (Ativos, Colaboradores, Estoque, Custódias,
Cadastros) carregam em **menos de ~650ms** com milhares de linhas no banco,
porque nenhuma delas mais busca a tabela inteira — cada uma pagina 50 linhas
por página no servidor (ver seção "Paginação" abaixo). `/reports?tab=stock`
é a exceção conhecida (1,5s) — ver "Limitações conhecidas".

**Cache**: a segunda visita ao Dashboard dentro da janela de 60s
(`unstable_cache`) foi consistentemente mais rápida que a primeira nos testes
manuais (ex.: 3,7s → 1,2s em modo dev, onde o ganho relativo aparece mais
por causa do overhead de desenvolvimento) — a parte de alertas (CA vencendo,
custódia atrasada, estoque baixo) não recalcula em toda navegação.

## Importação de Excel — correção do N+1

**Antes**: `processAssetRow`/`processStockRow` chamavam `assetStatus.findMany`
+ `assetCondition.findMany` a cada linha processada — 2 consultas extras por
linha, buscando exatamente os mesmos dados estáticos da empresa toda vez.
Para uma planilha de N linhas, isso é **2×N consultas repetidas** só para
resolver status/condição.

**Depois** (`lib/imports/process.ts`, função `buildImportRunContext`): essas
duas consultas rodam **uma vez por importação inteira**, antes do loop, e o
resultado é passado para cada linha. Mesma lógica para o tipo de movimentação
(`getMovementType`) na importação de estoque, e para os `findOrCreate*` de
categoria/fabricante/fornecedor/local/setor/cargo, que agora passam por um
cache em memória (`Map`) por nome dentro da mesma importação — uma planilha
de 1.000 linhas com 5 categorias distintas faz só 5 buscas de categoria, não
até 1.000.

Isso é uma redução **determinística e verificável no próprio diff**: o
número de consultas repetidas por linha caiu de 2 para 0 (as 2 chamadas
continuam existindo, só que fora do loop). Não depende de medição ao vivo
para ser válida — é consequência direta de mover a chamada pra fora do
`for`.

Medição real da importação (200 linhas de ativos, planilha gerada, todas
novas/válidas, ambiente de produção): **2,35s de ponta a ponta** (parse do
`.xlsx` + 200 transações individuais + auditoria), ~11,8ms por linha. O
modelo de 1 transação por linha (isolamento de erro — uma linha ruim nunca
desfaz as anteriores) foi mantido sem alteração, conforme decidido no
planejamento.

## O que foi implementado

1. **Índices** (`prisma/schema.prisma`, migration `add_scale_indices`):
   - `Asset`: `(companyId, active)`, `(companyId, trackingMode)`
   - `AssetCertification`: `(companyId, certificationType, status, expirationDate)`
   - `Location`: `(locationTypeId)`, `(companyId, active)`
   - `AssetUnit`: `(currentLocationId)`, `(statusId)`, `(conditionId)`
   - `AssetCustody`: `(companyId, status, expectedReturnAt)` (atraso),
     `(companyId, deliveredAt)` (filtro de período nos relatórios)

2. **Paginação/busca/ordenação server-side** em todas as listagens (Ativos,
   Colaboradores, Estoque — saldo e movimentações, Custódias — 3 abas,
   Cadastros — categorias/fabricantes/fornecedores): parâmetros na URL
   (`page`, `q`, `sort`, `dir`, prefixados quando há mais de uma tabela na
   mesma página — ver `lib/pagination.ts`, `components/ui/pagination-bar.tsx`,
   `components/ui/debounced-search-input.tsx`,
   `components/ui/data-table-column-header.tsx#ServerSortableHeader`).

3. **N+1 da importação** corrigido (ver acima).

4. **Dashboard/Relatórios/Alertas**: substituição de contagem/soma em
   JavaScript sobre arrays carregados inteiros por `count`/`aggregate`/
   `groupBy` no Postgres (`lib/reports.ts`, `lib/dashboard.ts`,
   `lib/alerts.ts`); `getLowStockAlerts` não carrega mais `getStockRows`
   inteiro (todas as unidades da empresa) só para somar por ativo — usa
   `stockBalance.groupBy` direto; filtro redundante em
   `getCustodyOverdueAlerts` removido (o `where` já garantia o critério).

5. **Cache** (`lib/cache.ts`, `unstable_cache` + `revalidateTag` — o modelo
   vigente nesta versão do Next quando `cacheComponents` não está habilitado,
   que não é o caso aqui): resumo de alertas do Dashboard, totais agregados
   de estoque, listas de apoio de Relatórios (categoria/status/condição/
   local). Revalidação: 60s automático + `invalidateCompanyData()` chamado
   nos pontos de mutação mais relevantes (entrega/devolução de custódia,
   entrada de estoque, CRUD de categoria).

6. **Lazy loading / streaming**:
   - Dashboard: cards rápidos (contagem/aggregate) renderizam de imediato;
     a seção que depende dos 3 tipos de alerta (mais cara) fica atrás de
     `<Suspense>` (`app/(app)/dashboard/page.tsx`), com esqueleto de
     carregamento. Corrigido de quebra um bug pré-existente (`onClick` num
     `<span>` renderizado direto por um Server Component — precisa ser
     Client Component; ver `app/(app)/dashboard/hint-icon.tsx`).
   - Painel de importação (`app/(app)/imports/import-panel.tsx`): só as
     linhas com erro entram na tabela de detalhe (até 200) — antes
     renderizava uma `<TableRow>` por linha processada, inclusive as
     milhares de linhas válidas sem nada de acionável. Botão "Baixar
     relatório completo (CSV)" exporta todas as linhas.

## Limitações conhecidas (decisões deliberadas, não pendências esquecidas)

- **`/reports?tab=stock` continua o ponto mais lento (~1,5s)**: o saldo de
  estoque une duas fontes (`StockBalance` para consumíveis + `AssetUnit`
  agrupado para individuais) que o Prisma não consegue paginar/agregar como
  uma única query — a função (`getStockRows`) precisa montar o array
  completo em memória antes de paginar/ordenar. Os **totais dos cards de
  resumo** já não dependem mais disso (usam `aggregate`/`count`/`groupBy`
  separados, via `getStockSummary`), mas a tabela de linhas em si ainda lê
  tudo que bate com o filtro. Resolver isso de verdade exigiria SQL bruto
  (`UNION` das duas fontes) — fica registrado como próximo passo se o
  volume de estoque crescer muito mais.
- **Dropdowns de "Colaborador"/"Ativo" nos filtros de Relatórios não
  paginam nem cacheiam**: com 2.000 colaboradores ou 5.000 ativos, um
  `<select>` simples deixa de ser boa UX. Não faz parte desta entrega
  (exigiria um combobox com busca, uma mudança de UI maior); os dois únicos
  campos que ficaram de fora do cache de `lib/cache.ts` foram justamente
  esses dois, deliberadamente.
- **Relatórios não têm streaming/Suspense**: a filtragem+tabela vivem no
  mesmo Client Component (`reports-view.tsx`) por causa da exportação CSV
  interativa; separar "filtros instantâneos" de "tabela em streaming"
  exigiria dividir esse componente. As queries já foram otimizadas
  (`groupBy`/`aggregate`, teto de 1.000 linhas por exportação/tela via
  `REPORT_ROW_LIMIT`), que é o ganho de maior impacto; o streaming em si
  ficou de fora desta rodada.
- **Cache é em memória do processo Node** (`unstable_cache` sem
  `cacheHandler` customizado) — não é compartilhado entre múltiplas
  instâncias/processos PM2 se a aplicação escalar horizontalmente depois.
  Suficiente para o deploy atual (processo único).
- **Migrar para `"use cache"`/Cache Components** (o modelo mais novo do
  Next 16) ficou fora de escopo — exigiria `cacheComponents: true` no
  `next.config.ts` e envolver toda API dinâmica (cookies/headers/
  searchParams) em `<Suspense>` no app inteiro, uma mudança de arquitetura
  bem maior do que cabe numa entrega de otimização.
