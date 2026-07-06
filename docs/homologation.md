# Homologação manual

Como deixar o ambiente pronto para uma rodada de testes manuais, e como
resetar os dados demo entre rodadas.

## Resetar os dados demo

```bash
npm run db:reset-demo
```

Isso roda dois passos em sequência:

1. `tsx prisma/reset-demo.ts` — apaga os dados de **negócio** acumulados
   pela empresa "Empresa Demo" durante o uso/testes anteriores
   (colaboradores, ativos, certificações, custódias, documentos,
   assinaturas, estoque, localizações, tipos de movimentação/status/
   condição/categoria, fabricantes, fornecedores).
2. `prisma db seed` — idempotente, recria a empresa demo (se não existir),
   o usuário admin (`admin@demo.com` / `Demo@12345`), os 6 papéis do
   sistema com as permissões atuais, e os dados demo padrão (colaboradores,
   ativos, local/tipos de movimentação, uma entrada de estoque).

### O que o reset **não** apaga

- Estrutura do banco (tabelas) e histórico de migrations — nunca roda
  `migrate reset` nem qualquer DDL.
- A própria `Company` "Empresa Demo", o `User` admin, `Role`/`Permission`/
  `RolePermission`/`UserRole` — o RBAC já provisionado continua intacto
  (o seed só sincroniza/atualiza, nunca precisa recriar do zero).
- Qualquer **outra** empresa que exista no banco (ex.: criada via `/register`
  durante um teste anterior) — o reset é escopado por `companyId` da
  "Empresa Demo" especificamente, nunca afeta outro tenant.

### Quando rodar

Antes de iniciar uma rodada de homologação (para começar de um estado
conhecido) e sempre que os dados de teste acumulados atrapalharem a leitura
dos resultados (ex.: várias custódias de teste do mesmo colaborador,
ativos como `EPI-ALERT-*`/`CAP-REL-*` criados só para testar alertas).

## Checklist rápido antes de uma rodada de testes

1. `npm run db:reset-demo`
2. Confirmar que o servidor está rodando na porta configurada
   (`npm run dev`, porta 3010) e que não há processo `node` órfão de uma
   rodada anterior preso na mesma porta.
3. Login com `admin@demo.com` / `Demo@12345`.
4. Passar pelos fluxos críticos na ordem: Ativos (com CA) → Estoque (entrada)
   → Entregas (custódia) → Termo/Assinatura → QR Code → Devolução →
   Relatórios → Alertas → Configurações.

## Variáveis de ambiente necessárias

- `DATABASE_URL` — string de conexão do Postgres.
- `BETTER_AUTH_SECRET` — obrigatório; além de assinar sessões, também é
  usado como o segredo interno que autoriza `/api/register` e o seed a
  criar contas (ver `docs/auth-rbac.md`, seção "Cadastro público"). Sem essa
  variável configurada, tanto o cadastro público quanto o seed falham.
