# Roteiro de apresentação — Portal Consultoria SST

Guia para conduzir uma demonstração comercial de 10-15 minutos do Portal
Consultoria SST (`/sst`) para um cliente em potencial (uma consultoria de
Segurança e Saúde no Trabalho). Ver também `docs/portal-consultoria.md`
(arquitetura) e `docs/homologation.md` (homologação do Portal Empresa).

## 1. Preparação

### Resetar/preparar os dados de demonstração

```bash
npm run db:reset-sst-demo
```

Isso roda dois passos em sequência (ver `prisma/seed-sst-demo.ts` e
`prisma/reset-sst-demo.ts`):

1. `tsx prisma/reset-sst-demo.ts` — apaga as 5 empresas de demonstração
   (identificadas pelo sufixo `(Demo SST)` no nome) e tudo que pertence a
   elas (departamentos, cargos, colaboradores, treinamentos, turmas,
   participantes, vínculo com a consultoria). Nunca toca em nenhuma outra
   empresa do banco (real ou de outro seed).
2. `tsx prisma/seed-sst-demo.ts` — recria as 5 empresas do zero, com
   situações de conformidade variadas (ver seção 3 abaixo).

Se preferir só garantir que os dados existem sem apagar o que já está lá
(idempotente — rodar de novo nunca duplica), use só:

```bash
npm run db:seed-sst-demo
```

### Contas de demonstração

Válidas **apenas em ambiente local/homologação** — nunca use estas
credenciais em produção.

| Papel | Nome | E-mail | Senha |
|---|---|---|---|
| OWNER (Proprietário) | Mariana Costa | `sst@demo.com` | `Demo@12345` |
| TECHNICIAN (Técnico) | Rafael Almeida | `sst-tech@demo.com` | `Demo@12345` |
| VIEWER (Consulta) | Juliana Santos | `sst-viewer@demo.com` | `Demo@12345` |

A consultoria de demonstração se chama **"Consultoria Segura SST"**. O
usuário `sst@demo.com` (Mariana Costa) também tem acesso ao Portal Empresa
(empresa "Empresa Demo", criada pelo seed principal — `npm run db:seed`) —
útil para demonstrar a separação entre os dois portais na mesma conta
(passo 11).

### Páginas que devem estar abertas

- Aba 1: `/sst/login` (ou já logado em `/sst/dashboard`) — Portal Consultoria.
- Aba 2 (opcional, só para o passo 11): `/dashboard` — Portal Empresa, com o
  mesmo usuário `sst@demo.com`.

### Verificação antes da reunião

1. `npm run dev` rodando na porta 3010, sem processo `node` órfão de uma
   rodada anterior preso na mesma porta.
2. `npm run db:reset-sst-demo` executado nos últimos minutos (estado
   limpo e previsível).
3. Login manual com `sst@demo.com` — confirmar que o dashboard carrega com
   "Empresas atendidas: 6" (as 5 de demonstração + "Empresa Demo", vinda do
   seed principal) e nenhuma mensagem de erro.
4. Testar a resolução de tela que será usada na apresentação (o layout é
   responsivo, mas confirme antes — ver checklist, item "Responsividade").

## 2. Roteiro de 10-15 minutos

Cada passo indica a página/ação e o que dizer.

1. **Login no Portal Consultoria** (`/sst/login`, `sst@demo.com`). Destaque:
   é um login separado do Portal Empresa — a consultoria nunca usa a mesma
   tela/URL da empresa cliente.
2. **Visão geral da carteira** (`/sst/dashboard`). Aponte os cards:
   empresas atendidas, colaboradores acompanhados, pendências, treinamentos
   vencidos/vencendo, turmas agendadas/em andamento, índice médio de
   conformidade. Tudo calculado a partir de dados reais cadastrados — nada
   é editado manualmente.
3. **Identificação de uma empresa com pendências** — na seção "Empresas que
   precisam de atenção" do próprio dashboard, aponte **"Comércio Épsilon
   (Demo SST)"** (Crítica) ou **"Construtora Beta (Demo SST)"** (também
   Crítica, colaboradores sem treinamento obrigatório).
4. **Abertura da empresa** — clique em "Entrar"/"Abrir empresa". Mostre a
   aba Resumo: indicadores, vínculo de acesso, ações principais visíveis no
   topo (Novo treinamento, Nova turma, Colaboradores sem treinamento).
5. **Consulta de colaboradores sem treinamento** — aba Colaboradores, botão
   "Somente sem treinamento obrigatório". Mostre o detalhe por colaborador
   (clique em uma linha) com o histórico de treinamentos.
6. **Criação/abertura de um treinamento** — aba Treinamentos. Se quiser
   criar um novo, use "Novo treinamento" (qualquer NR fictícia). Para não
   arriscar sujar a demonstração, prefira abrir um já existente (ex.: NR-18
   em Construtora Beta) e mostrar os campos.
7. **Criação de turma** — a partir do treinamento (botão "Criar turma") ou
   pela aba Turmas → "Nova turma". Preencha data/local/instrutor.
8. **Inclusão de participantes** — abra uma turma (aba Turmas → "Ver
   participantes"), use "Adicionar participantes", selecione 1-2
   colaboradores da lista.
9. **Visão de conformidade** — volte ao Resumo da empresa ou ao dashboard
   geral; mostre como o índice/pendências mudam à medida que dados são
   registrados (presença, resultado, conclusão de treinamento).
10. **Gestão da equipe da consultoria** (`/sst/settings/team` — menu
    "Equipe"). Mostre os 3 papéis (Proprietário/Técnico/Consulta), o botão
    "Adicionar usuário existente" (explique: só adiciona quem já tem conta
    — não cria conta nova nem envia convite por e-mail nesta versão) e a
    troca de papel/desativação (sem excluir o histórico).
11. **Portal Empresa e a futura reivindicação de empresa** — troque para a
    aba/URL `/dashboard` com o mesmo login. Explique: hoje a consultoria
    enxerga a empresa cliente porque uma empresa já autorizou o vínculo
    (`SstProviderCompany`); no futuro, uma empresa poderá reivindicar seu
    próprio acesso ao Portal Empresa de forma self-service, sem depender de
    cadastro manual — **funcionalidade ainda não construída, mencionar como
    direção futura, não como recurso disponível hoje.**

## 3. As 5 empresas de demonstração e seus cenários

| Empresa | Cenário | O que observar |
|---|---|---|
| Metalúrgica Alfa (Demo SST) | Boa conformidade | Índice 100%, "Em dia" |
| Construtora Beta (Demo SST) | Colaboradores sem treinamento | 3 de 5 colaboradores sem NR-18 |
| Transportadora Gama (Demo SST) | Treinamentos vencendo | 4 participações vencendo em ~12 dias |
| Indústria Delta (Demo SST) | Turma futura | 1 turma NR-35 agendada (não obrigatória, não afeta o índice) |
| Comércio Épsilon (Demo SST) | Pendências mistas | 2 vencidos + 2 sem treinamento + 1 em dia; 1 turma em andamento |

Todos os dados (nomes, CPFs, CNPJs) são fictícios — CPFs no padrão
`000.000.XXX-XX` e CNPJs no padrão `00.000.000/00XX-00`, claramente não
reais.

## 4. Mensagens comerciais

Pontos a reforçar durante a demonstração — **nunca prometer o que ainda não
existe** (ver "Fora do escopo" abaixo):

- **Centralização da carteira**: todas as empresas atendidas em um só
  lugar, sem depender de planilhas separadas por cliente.
- **Redução de controle manual em planilha**: pendências de treinamento
  calculadas automaticamente a partir dos registros, não digitadas à mão.
- **Visibilidade de pendências**: dashboard e listagem de empresas mostram
  imediatamente quem precisa de atenção, sem precisar abrir cada empresa.
- **Organização de treinamentos e turmas**: catálogo por empresa, turmas com
  status claros (Agendada/Em andamento/Concluída/Cancelada), participantes
  rastreados individualmente.
- **Acompanhamento por empresa**: visão dedicada por cliente (Resumo,
  Colaboradores, Treinamentos, Turmas).
- **Separação segura entre clientes**: uma consultoria nunca vê dados de
  uma empresa sem vínculo ativo — isolamento reforçado por testes
  automatizados (ver `tests/tenant-isolation/`).
- **Futuro acesso self-service da empresa**: mencionar como direção do
  produto (item 11 do roteiro), não como recurso pronto.

**Não prometer**: criação automática de conta para a empresa, convite por
e-mail real, edição de dados de colaboradores pela consultoria, billing/
planos, relatórios além dos já existentes na tela.

## 5. Plano de contingência

- **WhatsApp ou integração externa indisponível**: o Portal Consultoria não
  depende de nenhuma integração externa (WhatsApp é recurso do Portal
  Empresa, não usado nesta demonstração) — não há contingência necessária
  aqui, mas se a pergunta surgir, deixe claro que são produtos/portais
  diferentes.
- **Página específica não carrega ou está lenta**: tenha o dashboard
  (`/sst/dashboard`) e a listagem de empresas (`/sst/companies`) como
  páginas de fallback — cobrem a maior parte da narrativa comercial mesmo
  sem entrar no detalhe de uma turma específica.
- **Precisa restaurar o estado da demonstração**: rode
  `npm run db:reset-sst-demo` entre uma demonstração e outra (ou antes de
  começar, como parte da preparação). Leva poucos segundos e é idempotente.
- **Evitar alterar dados acidentalmente durante a demonstração**: prefira
  **abrir** registros existentes a **criar** novos sempre que possível
  (passos 6-8 do roteiro sugerem isso). Se criar uma turma ou adicionar um
  participante de teste, isso é normal — o próximo `db:reset-sst-demo`
  remove tudo. Evite cancelar turmas de demonstração ao vivo sem querer (a
  ação pede confirmação, mas tenha cuidado ao clicar em "Cancelar turma").
  Evite desativar `sst@demo.com` (o próprio usuário logado) na demonstração
  de gestão de equipe — desative `sst-viewer@demo.com` como exemplo seguro,
  e reative em seguida.

## 6. Limitações que ainda aparecerão durante a demonstração

Ver também a seção "Fora do escopo" da Sprint Demo Comercial SST 1.0.
Comunicar com transparência se o cliente perguntar:

- "Adicionar usuário existente" só funciona para quem **já tem conta** no
  sistema — não há convite por e-mail nem criação automática de conta
  nesta versão.
- A consultoria não pode pré-cadastrar uma empresa nova nem criar/editar
  colaboradores — isso continua sendo feito pela própria empresa no Portal
  Empresa.
- O filtro "somente sem treinamento obrigatório" na tela de colaboradores é
  aplicado sobre a página atualmente carregada, não sobre todos os
  colaboradores da empresa de uma vez (relevante só para empresas com
  centenas de colaboradores — nenhuma das 5 empresas de demonstração chega
  perto disso).
- Não há ainda uma página consolidada de "todos os treinamentos de todas as
  empresas" no menu principal — a navegação por treinamentos é sempre
  dentro de uma empresa aberta.
- O papel do usuário dentro da consultoria (Proprietário/Técnico/Consulta)
  é fixo por consultoria — um usuário não escolhe qual consultoria "ativar"
  se pertencer a mais de uma (usa sempre a mais antiga).
- O botão "Novo treinamento" só aparece quando o vínculo da consultoria com
  aquela empresa tem nível de acesso "Administração" — com nível "Operação"
  (o padrão das 5 empresas de demonstração), o Proprietário e o Técnico veem
  normalmente "Nova turma"/participantes, mas não criam treinamento novo
  naquela empresa especificamente. Isso é comportamento esperado do modelo
  de acesso, não uma limitação a esconder — mas vale explicar se um técnico
  perguntar por que o botão não aparece em uma das empresas fictícias.

## 7. Checklist de apresentação

Preenchido durante a validação manual desta sprint (login real como OWNER,
TECHNICIAN e VIEWER contra os dados de `npm run db:seed-sst-demo`, incluindo
viewport mobile 375px). Dois problemas reais foram encontrados e corrigidos
durante essa validação (ver detalhes nas notas de cada item) — o resultado
abaixo já reflete o estado depois da correção.

| Item | Resultado | Notas |
|---|---|---|
| Login (OWNER/TECHNICIAN/VIEWER) | APROVADO | Os 3 papéis logam normalmente; badge de papel correto no header. |
| Navegação (menu, breadcrumb, aba ativa) | APROVADO | Menu mostra só itens com conteúdo (Visão geral/Empresas/Equipe); abas da empresa destacam a aba ativa; breadcrumb consistente. |
| Dashboard | APROVADO | 10 cards com título/descrição/link, zero-state correto, "Empresas que precisam de atenção" reflete dados reais. |
| Empresas (listagem) | APROVADO | Busca, filtro de situação, filtro de pendências e paginação ("Carregar mais") funcionam; CNPJ não é exibido. |
| Colaboradores | APROVADO | Filtro "somente sem treinamento obrigatório" funciona; detalhe por colaborador abre em dialog. |
| Treinamentos | APROVADO | Botão "Novo treinamento" visível quando o vínculo permite (ver observação acima); catálogo mostra quem gerencia cada treinamento. |
| Turmas | APROVADO | Filtro de status, badges traduzidos, ação "Cancelar turma" com confirmação. **Bug real encontrado e corrigido**: o cancelamento falhava com 400 quando os campos opcionais da turma vinham `null` do banco — corrigido em `lib/validations/training-class.ts` (afeta também o Portal Empresa, também corrigido). |
| Participantes | APROVADO | Adicionar/editar presença/resultado/observação funcionam; estado vazio orienta a próxima ação. |
| Equipe | APROVADO | OWNER gerencia (adicionar/trocar papel/desativar/reativar); TECHNICIAN/VIEWER veem a lista sem e-mail e sem ações de gestão; último OWNER protegido. |
| Responsividade (mobile 375px) | APROVADO | Dashboard e listagem de empresas sem overflow horizontal; navegação principal permanece utilizável. |
| Mensagens de sucesso/erro | APROVADO | Nenhuma mensagem técnica observada (sem stack trace, `ForbiddenError`, código Prisma ou nome de enum cru na interface). |
| Estados vazios | APROVADO | Empresa sem pendência, equipe só com o OWNER, turma sem participante e empresa sem vínculo têm mensagem explicativa + próxima ação. |
| Segurança/isolamento entre consultorias | APROVADO | Coberto por 111 testes automatizados (`npm test`), incluindo isolamento cross-provider e bloqueio imediato de usuário desativado com sessão ativa. |
| Dados de demonstração | APROVADO | `npm run db:seed-sst-demo` idempotente (testado rodando 2x); `npm run db:reset-sst-demo` remove só as 5 empresas de demo. **Bug real encontrado e corrigido**: o reset falhava com violação de FK depois de qualquer ação real na demonstração (ex.: cancelar uma turma), porque não apagava os `AuditLog` da empresa antes de apagar a empresa — corrigido em `prisma/reset-sst-demo.ts`. |
| Logout | APROVADO | Redireciona para `/sst/login` (nunca para o login do Portal Empresa). |

Nenhum item ficou como REPROVADO. Nenhum item recebeu "APROVADO COM
RESSALVAS" — os dois problemas encontrados foram corrigidos antes da entrega
desta sprint, não deixados como ressalva.
