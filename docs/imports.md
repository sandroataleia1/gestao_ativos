# Importação em lote via Excel

Acelera o onboarding de empresas piloto: traz Colaboradores, Ativos e
Estoque inicial de uma planilha `.xlsx` em vez de cadastro manual, um por
um. Fica **fora** desta entrega: entregas antigas, assinaturas antigas,
documentos antigos e histórico completo de movimentações — só o estado
inicial dos três tipos acima.

## 1. Permissões

Duas permissões novas, sem granularidade por tipo (uma empresa que tem
`import:manage` pode usar as 3 abas — Colaboradores/Ativos/Estoque —
mesmo que o papel tenha nome ligado a só um tipo):

| Papel | `import:view` | `import:manage` |
|---|---|---|
| ADMIN | Sim (via `ALL_PERMISSIONS`) | Sim |
| GESTOR | Sim | — |
| RH | Sim | Sim |
| ALMOXARIFADO | Sim | Sim |
| TECNICO_SST | Sim | Sim |
| CONSULTA | — | — |

`import:view` já basta para baixar os modelos (`GET
/api/imports/templates/:type`) — só ler o formato esperado não deveria
exigir permissão de escrita. `import:manage` é exigido para pré-visualizar
e confirmar (`POST /api/imports/preview` e `/confirm`).

## 2. Formatos aceitos

Só `.xlsx` (extensão + MIME `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
com `application/octet-stream` aceito como alternativa — alguns navegadores
não reconhecem o MIME correto), limite de **5MB** por arquivo. A primeira
linha da planilha é sempre o cabeçalho; nomes de coluna são comparados sem
diferenciar maiúsculas/minúsculas nem acentos ("Código_SKU" == "codigo_sku").
Fórmulas nunca são executadas — só o último valor calculado (cache) que o
próprio Excel já gravou é lido.

`companyId` nunca é lido da planilha: toda importação usa sempre o
`companyId` da sessão de quem está logado.

## 3. Colunas por tipo

### Colaboradores

`nome, documento, email, telefone, matrícula, setor, cargo, status`

Exemplo: `Ana Souza, 123.456.789-00, ana@empresa.com, (11) 91234-5678, 0001, Operações, Almoxarife, ACTIVE`

- `setor`/`cargo`: se o nome não existir na empresa, é **criado
  automaticamente**.
- `status`: aceita variações de texto (ativo/inativo, active/inactive);
  não reconhecido → assume `ACTIVE` e avisa na linha.

### Ativos

`categoria, nome, código_sku, modo_controle, unidade_medida, fabricante, fornecedor, status, condição, estoque_minimo, possui_ca, numero_ca, validade_ca, situacao_ca`

Exemplo: `EPI, Luva de Proteção, LUV-001, CONSUMABLE, PAR, 3M, (vazio), Disponível, Novo, 10, sim, 12345, 2027-01-01, VALID`

- `categoria`/`fabricante`/`fornecedor`: criados automaticamente se o nome
  não existir.
- `modo_controle`: aceita "individual"/"consumível"/"consumivel" além dos
  valores técnicos; não reconhecido → assume `INDIVIDUAL`.
- `status`/`condição`: **nunca criados a partir da planilha** — tenta
  achar por nome (evita que um erro de digitação vire um registro
  permanente); se não achar, usa um padrão seguro ("Disponível"/"Novo" ou
  o primeiro cadastrado).
- Bloco de CA (`numero_ca`/`validade_ca`/`situacao_ca`) só é usado quando
  `possui_ca` é verdadeiro ("sim"/"yes"/"true"/"1"/"x").

### Estoque inicial

Duas variações de coluna na mesma aba — o sistema decide qual delas
aplicar consultando o `modo_controle` real do ativo já cadastrado (nunca
o que a planilha diz):

- **Consumíveis**: `codigo_sku, local, quantidade, observação`
  (`quantidade` deve ser > 0).
- **Individuais**: `codigo_sku, local, numero_serie, patrimonio, status, condição, observação`
  (pelo menos um entre `numero_serie`/`patrimonio` é obrigatório).

`local`: criado automaticamente (como local do tipo "Almoxarifado") se o
nome não existir. **O ativo referenciado por `codigo_sku` precisa já
existir** — importe Ativos antes de importar Estoque inicial.

## 4. Regras de duplicidade

| Situação | Estratégia | Justificativa |
|---|---|---|
| `documento` de colaborador já existe na empresa | **Atualiza** o registro | Reimportar uma planilha corrigida (telefone novo, setor mudou) é o fluxo natural do onboarding piloto — forçar apagar e recriar seria pior UX. `documento` já é a chave natural de dedup (`@@unique([companyId, document])`). |
| `código_sku` de ativo já existe na empresa | **Atualiza** o registro | Mesmo raciocínio: reimportar a lista de ativos para corrigir preço/CA não deve duplicar. `assetCode` já é `@@unique([companyId, assetCode])`. |
| `numero_serie` ou `patrimonio` já existe na empresa | **Sempre erro** | Ao contrário de CPF/SKU, colidir um número de série/patrimônio normalmente sinaliza erro de digitação ou tentativa de duplicar uma unidade física real — não existe uma interpretação segura de "atualizar" aqui. |

## 5. Fluxo

1. Baixar modelo (botão na tela, ou `GET /api/imports/templates/:type`).
2. Preencher a planilha.
3. Upload do `.xlsx`.
4. **Pré-visualizar** (`POST /api/imports/preview`) — roda a mesma
   validação da confirmação, mas nunca grava nada no banco; mostra, por
   linha, status (válida/erro), erros, avisos (ex.: "categoria X será
   criada") e uma prévia dos dados.
5. Conferir o resumo (total/válidas/com erro) e a tabela de preview.
6. **Confirmar importação** (`POST /api/imports/confirm`) — reenvia o
   mesmo arquivo; cada linha grava dentro da sua própria transação, então
   uma falha isolada numa linha nunca desfaz as linhas já importadas com
   sucesso. Linhas inválidas nunca são gravadas — por isso "Confirmar
   importação" e "Importar apenas linhas válidas" (quando existem as duas
   situações ao mesmo tempo) chamam a mesma rota e têm o mesmo resultado;
   a diferença é só o rótulo do botão.
7. Ver o resultado: quantas linhas foram criadas, atualizadas ou
   ignoradas.

## 6. Limitações

- Não importa entregas, assinaturas, documentos nem histórico de
  movimentações antigos — só o estado inicial.
- Estoque inicial depende de os Ativos já estarem cadastrados (via
  importação ou manualmente).
- Reimportar a mesma planilha de **estoque consumível** soma quantidade
  de novo a cada execução (mesmo comportamento do lançamento manual de
  entrada de estoque) — não há deduplicação de entradas de estoque.
