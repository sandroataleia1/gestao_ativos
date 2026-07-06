# Central de alertas

Alertas de CA (Certificado de Aprovação) vencido/próximo do vencimento,
devolução de custódia atrasada e estoque abaixo do mínimo — calculados **sob
demanda**, sem fila e sem envio de e-mail (MVP explícito, ver seção 5).

## 1. Por que não existe tabela `Alert`

Nenhum alerta é persistido. `lib/alerts.ts` recalcula tudo a cada chamada, a
partir de dados que já existem e já têm sua própria fonte de verdade
(`AssetCertification`, `AssetCustody`, `StockBalance`/`AssetUnit`). Guardar
"alertas" como linhas de banco criaria um segundo lugar para a mesma
informação divergir do estado real — o mesmo raciocínio já usado para
"atrasado" em custódia (`lib/custodies/badge.ts`) e para o badge de CA
(`lib/certifications/badge.ts`): condições derivadas ficam calculadas, nunca
armazenadas.

## 2. Permissão

`alert:view`, concedida a ADMIN, GESTOR, RH, ALMOXARIFADO, TECNICO_SST e
CONSULTA — mesma matriz e mesma justificativa de `report:view` (ver
`docs/reports.md`): alertas são uma leitura derivada dos mesmos dados que
esses papéis já enxergam, então negar o acesso não protegeria nada de novo.

## 3. Regras (requisito 4)

| Regra | Severidade | Fonte |
|---|---|---|
| CA vencido | `CRITICAL` | `getExpiringCaReport` (`lib/reports.ts`), bucket `EXPIRED` |
| CA vence em até 30 dias | `WARNING` | mesma fonte, bucket `EXPIRING_SOON` |
| Devolução atrasada até 7 dias | `WARNING` | `AssetCustody` ativa com `expectedReturnAt` no passado |
| Devolução atrasada há mais de 7 dias | `CRITICAL` | mesma consulta, `diasAtraso > 7` |
| Estoque abaixo do mínimo (saldo > 0) | `WARNING` | `Asset.minimumStock` vs. saldo total (`getStockRows`) |
| Estoque zerado | `CRITICAL` | mesma regra, saldo total `<= 0` |

### Estoque baixo depende de `Asset.minimumStock`

O campo já existia no schema desde a modelagem inicial
(`Asset.minimumStock Decimal?`), mas nenhuma tela ainda o expunha para
edição — só a API (`lib/validations/asset.ts`) já aceitava o campo. Esta
entrega adicionou o input "Estoque mínimo" ao formulário de ativo
(`app/(app)/assets/asset-form-dialog.tsx`), visível apenas para
`trackingMode = CONSUMABLE`. Assets sem `minimumStock` configurado (o padrão
para todo ativo já cadastrado antes desta entrega) **nunca geram alerta de
estoque baixo** — não existe um "mínimo padrão" inventado; é uma limitação
deliberada, não um bug: cada empresa decide quais consumíveis quer
monitorar, configurando o mínimo manualmente.

O saldo comparado é o **total do ativo somado em todas as localizações**
(mesma agregação de `getStockRows`), não por local — `minimumStock` é um
campo do cadastro mestre do ativo, não por localização.

## 4. API

`GET /api/alerts` — exige `alert:view`, deriva `companyId` da sessão.
Filtros opcionais via query string: `severity` (`INFO`/`WARNING`/`CRITICAL`)
e `type` (`CA_EXPIRED`/`CA_EXPIRING_SOON`/`CUSTODY_OVERDUE`/`LOW_STOCK`) —
valores fora dessa lista são ignorados silenciosamente (mesmo padrão de
sanitização usado nos filtros de `/api/reports/*`).

Resposta:

```json
{
  "alerts": [
    {
      "id": "ca-<id>",
      "type": "CA_EXPIRED",
      "severity": "CRITICAL",
      "title": "CA vencido: ...",
      "description": "...",
      "resourceType": "ASSET",
      "resourceId": "...",
      "detectedAt": "2026-07-03T12:00:00.000Z"
    }
  ],
  "summary": { "total": 3, "critical": 1, "warning": 2, "info": 0 }
}
```

`summary` sempre reflete o total real (antes de `severity`/`type`
filtrarem `alerts`) — os cards de resumo não mudam conforme o filtro
aplicado na tabela, só as linhas mudam.

`id` é um identificador sintético (`"ca-<id-da-certificação>"`,
`"custody-<id-da-custódia>"`, `"stock-<id-do-ativo>"`) — não existe uma
linha de banco correspondente; serve só para `key` no React e não deve ser
usado para nenhuma outra consulta.

## 5. Fora de escopo (deliberado, MVP)

- **Sem fila** (BullMQ/Redis ou equivalente): cada acesso a `/alerts`,
  `/api/alerts` ou ao dashboard recalcula tudo na hora. Para o volume de
  dados de uma PME isso é rápido o bastante; se o catálogo crescer muito, o
  próximo passo é cachear `getAlerts` por um TTL curto, não persistir os
  alertas em si.
- **Sem envio de e-mail/notificação** — os alertas só existem dentro do
  sistema (`/alerts` e o card do dashboard). Adicionar isso depois é uma
  camada por cima de `getAlerts`, sem mudar a função em si.

## 6. UI

- **`/alerts`**: cards de resumo (total/críticos/atenção) + filtros de
  severidade e tipo (client-side, sobre a lista já carregada — mesmo padrão
  de Assets/Estoque/Custódias) + tabela com link "Ver recurso" (para
  `/assets` ou `/custodies`, conforme `resourceType`; não há uma página de
  detalhe por id hoje, então o link leva à lista do módulo correspondente).
- **Dashboard**: o card "Alertas" (antes mostrava só `custódias atrasadas`)
  agora mostra `summary.total` de verdade — CA, custódia e estoque juntos.
  Um novo card "Últimos alertas críticos" lista até 5 alertas `CRITICAL`
  com link para `/alerts`. Ambos ficam ocultos/neutros (`"—"`) para quem não
  tem `alert:view`, sem quebrar a página.
