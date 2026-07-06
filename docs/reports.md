# Relatórios e exportação

Visão gerencial e evidências exportáveis (CSV) sobre dados que já existem —
este módulo não introduz nenhum model novo: é uma camada de agregação de
leitura sobre `Asset`, `AssetUnit`/`StockBalance`, `AssetCustody` e
`AssetCertification`.

## 1. Permissão

`report:view` é a única permissão nova. Matriz:

| Papel | `report:view` |
|---|---|
| ADMIN | Sim (via `ALL_PERMISSIONS`) |
| GESTOR | Sim |
| RH | Sim |
| ALMOXARIFADO | Sim |
| TECNICO_SST | Sim |
| CONSULTA | **Sim** |

### Por que CONSULTA também tem `report:view`

`CONSULTA` já é descrito como "acesso somente leitura a todo o domínio de
ativos" (`SYSTEM_ROLE_DESCRIPTIONS`) e já tem `*_view` de ativos, unidades,
localizações, movimentações, custódia e estoque. Um relatório aqui é
estritamente uma agregação de leitura dos mesmos dados que esse papel já
enxerga registro a registro — negar `report:view` só forçaria quem tem esse
papel a reconstruir manualmente, tabela por tabela, uma visão que o próprio
sistema já sabe montar. Não haveria ganho de segurança (nenhum dado novo é
exposto) e a inconsistência com o propósito declarado do papel seria maior
que o risco.

## 2. APIs

Todas exigem `report:view` e derivam `companyId` da sessão — nenhuma delas
escreve nada.

- `GET /api/reports/assets` — filtros: `categoryId`, `statusId`,
  `conditionId`, `assetId`, `dateFrom`/`dateTo` (por `createdAt`).
- `GET /api/reports/stock` — filtros: `assetId`, `categoryId`, `locationId`
  (mesmos filtros de `getStockRows`, reaproveitado de `lib/stock.ts`).
- `GET /api/reports/custodies` — filtros: `employeeId`, `assetId`,
  `locationId` (holder), `status` (`ACTIVE`/`RETURNED`),
  `dateFrom`/`dateTo` (por `deliveredAt`).
- `GET /api/reports/expiring-ca` — filtros: `assetId`, `categoryId`,
  `withinDays` (janela de "próximo do vencimento", padrão 30).

Cada uma devolve `{ rows, summary }`; `lib/reports.ts` centraliza a lógica e
é usado tanto pelas rotas quanto diretamente pela página `/reports` (Server
Component), evitando um round-trip HTTP desnecessário no primeiro
carregamento.

## 3. Os 4 relatórios (requisito 4)

- **Ativos por categoria/status/condição** — lista de ativos + três
  quebras (`byCategory`/`byStatus`/`byCondition`), cada uma com contagem.
- **Saldo de estoque por ativo/local** — reaproveita `getStockRows` (o
  mesmo saldo unificado consumível+individual já usado em `/stock`).
- **Itens em posse por colaborador** e **custódias atrasadas** — as duas
  bullets do requisito vivem na mesma rota/relatório (`custodies`), porque
  as duas são leituras diferentes do mesmo `AssetCustody`: "atrasada" é o
  mesmo critério derivado já usado em `lib/custodies/badge.ts`
  (`isCustodyOverdue`, nunca persistido), e "por colaborador" é só um
  agrupamento das custódias ativas.
- **CAs vencidos ou próximos do vencimento** — consulta
  `AssetCertification` (`certificationType = CA`, `status` em
  `VALID`/`EXPIRED`, `expirationDate <= hoje + withinDays`) e classifica
  cada certificado em `EXPIRED` ou `EXPIRING_SOON` comparando com a data
  atual (mesmo espírito do badge de CA em `lib/certifications/badge.ts`,
  mas por certificado individual em vez de por ativo — o relatório precisa
  listar exatamente qual CA está vencendo, não só um badge agregado).

## 4. Filtros (requisito 5)

Nem todo filtro se aplica a todo relatório — cada aba da UI só mostra os
campos relevantes:

| Filtro | Ativos | Estoque | Custódias | CAs a vencer |
|---|---|---|---|---|
| Categoria | Sim | Sim | — | Sim |
| Status/Condição | Sim | — | — | — |
| Ativo | Sim | Sim | Sim | Sim |
| Local | — | Sim | Sim | — |
| Colaborador | — | — | Sim | — |
| Período | Sim (cadastro) | — | Sim (entrega) | — |
| Janela de vencimento | — | — | — | Sim (`withinDays`) |

## 5. UI (`/reports`)

Página com abas (Ativos/Estoque/Custódias/CAs a vencer) — a aba ativa e
todos os filtros vivem na **query string** (`?tab=custodies&employeeId=...`),
não em estado local: a página é um Server Component que lê `searchParams`
e busca os dados já filtrados no servidor. Trocar de filtro ou de aba
navega para uma nova URL (via `router.push`), o que:

- Torna o link da página compartilhável já filtrado.
- Evita duplicar a lógica de filtro em dois lugares (servidor para o
  primeiro load, client para os seguintes) — só existe um caminho de dados.

Cada aba mostra cards de resumo, um ou mais cartões de "quebra"
(categoria/status/colaborador etc.) e uma tabela com as linhas. O botão
"Exportar CSV" (`lib/csv.ts`) serializa as linhas **já filtradas e já
carregadas na tela** — não existe uma rota de exportação server-side
separada; é um `Blob` gerado no browser com BOM UTF-8 (evita acentos
corrompidos ao abrir no Excel).

## 6. Fora de escopo (por ora)

Exportação em PDF não foi implementada — a estrutura fica preparada no
sentido de que cada relatório já devolve `{ rows, summary }` bem definidos
(o mesmo par que uma geração de PDF usaria como fonte de dados), mas não há
nenhuma rota, botão ou dependência de renderização de PDF ainda. Adicionar
isso no futuro é: (1) uma rota que recebe os mesmos filtros e chama as
mesmas funções de `lib/reports.ts`, (2) um renderizador de PDF (ex.:
`@react-pdf/renderer` ou geração de HTML + impressão) por cima do mesmo
`{ rows, summary }` — sem tocar em `lib/reports.ts`.
