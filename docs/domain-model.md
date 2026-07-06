# Domínio: Gestão de Ativos

Especificação de domínio fornecida para o projeto, usada como referência para
o schema Prisma em `prisma/schema.prisma`. Decisões de implementação que
divergem ou complementam o texto original estão marcadas como **Nota de
implementação**.

---

# AssetCategory

Representa a classificação de um ativo.

Seu objetivo é organizar os ativos e definir regras de negócio específicas.

Exemplos

- EPI
- Uniforme
- Ferramenta
- Equipamento
- Eletrônico
- Veículo
- Mobiliário
- Documento
- Consumível
- Outro

Campos

- id
- companyId
- name
- description
- color
- icon
- active
- createdAt
- updatedAt
- deletedAt

Relacionamentos

Um AssetCategory possui diversos Assets.

---

# Manufacturer

Representa o fabricante do ativo.

Campos

- id
- companyId
- name
- document
- website
- email
- phone
- createdAt
- updatedAt
- deletedAt

Relacionamentos

Um fabricante pode possuir diversos Assets.

---

# Supplier

Representa fornecedores.

Pode ser utilizado para:

- compra
- manutenção
- assistência técnica
- garantia
- locação

Campos

- id
- companyId
- corporateName
- tradeName
- document
- stateRegistration
- municipalRegistration
- email
- phone
- contactName
- address
- city
- state
- zipCode
- notes
- active

Relacionamentos

Fornecedor pode:

- vender ativos
- receber ativos para manutenção
- receber devoluções
- fornecer peças

---

# Asset

Representa o cadastro mestre.

Nunca representa uma unidade física.

Todo ativo da empresa deve possuir exatamente um cadastro.

Exemplos

Notebook Dell Latitude 7440

Capacete Classe B CA 45678

Luva Nitrílica CA 99887

Furadeira Bosch GSB550

Campos

- id
- companyId
- assetCode
- name
- description
- categoryId
- manufacturerId
- supplierId
- trackingMode
- barcode
- defaultUnit
- photo
- minimumStock
- maximumStock
- reorderPoint
- purchasePrice
- replacementCost
- expectedLifetime
- warrantyMonths
- active
- createdAt
- updatedAt
- deletedAt

Relacionamentos

Um Asset pertence a:

- Category
- Manufacturer
- Supplier

Um Asset possui:

- AssetUnits
- StockMovements
- Attachments

**Nota de implementação:** `Attachment` é citada como relacionamento mas
nunca teve campos definidos na especificação original — não foi modelada
ainda.

---

# TrackingMode

Define como o ativo será controlado.

Valores

INDIVIDUAL

CONSUMABLE

---

## INDIVIDUAL

Cada unidade física possui identidade própria.

Exemplos

Notebook

Celular

Veículo

Furadeira

Máquina

Cada unidade será cadastrada em AssetUnit.

---

## CONSUMABLE

Controle apenas por quantidade.

Exemplos

Luvas

Máscaras

Uniformes simples

Parafusos

Não existe AssetUnit.

---

# AssetUnit

Representa uma unidade física individual.

Somente existe quando:

trackingMode = INDIVIDUAL

Cada unidade possui seu próprio ciclo de vida.

Campos

- id
- companyId
- assetId
- patrimonyNumber
- serialNumber
- qrCode
- barcode
- manufactureDate
- purchaseDate
- purchaseValue
- currentValue
- warrantyExpiration
- status
- condition
- currentLocationId
- currentCustodyId
- notes
- active
- createdAt
- updatedAt
- deletedAt

Relacionamentos

Pertence a:

Asset

Possui:

Movements

Maintenances

Inspections

Custodies

Attachments

**Nota de implementação:** `Maintenance`, `Inspection` e `Attachment` são
citadas como relacionamentos mas nunca tiveram campos definidos na
especificação original — não foram modeladas ainda.

---

# AssetStatus

Representa o estado operacional.

Valores sugeridos

AVAILABLE

ASSIGNED

RESERVED

UNDER_MAINTENANCE

LOST

STOLEN

DAMAGED

DISCARDED

SCRAPPED

INACTIVE

Não utilizar Enum fixa.

Os status deverão ser parametrizados pela empresa.

**Nota de implementação:** modelado como tabela `AssetStatus` com
`companyId`, não como Prisma enum.

---

# AssetCondition

Representa a condição física.

Exemplos

Novo

Excelente

Bom

Regular

Ruim

Danificado

Irrecuperável

Também deverá ser parametrizado.

**Nota de implementação:** modelado como tabela `AssetCondition` com
`companyId`, não como Prisma enum.

---

# Location

Representa qualquer local onde um ativo pode permanecer.

Não limitar apenas ao estoque.

Tipos possíveis

WAREHOUSE

EMPLOYEE

BRANCH

VEHICLE

SUPPLIER

CUSTOMER

CONSTRUCTION_SITE

SERVICE_CENTER

SCRAP

Campos

- id
- companyId
- locationType
- referenceId
- name
- active

Exemplos

Almoxarifado Central

João da Silva

Veículo ABC1234

Fornecedor Bosch

Obra Hospital Regional

Filial Campinas

**Nota de implementação:** `locationType` modelado como tabela
`LocationType` parametrizável por empresa (mesma lógica de AssetStatus/
AssetCondition), e não como enum fixo. `referenceId` é uma referência
polimórfica sem FK de banco (o alvo varia conforme o tipo).

---

# AssetCustody

Representa quem é o responsável legal ou operacional pelo ativo.

Não representa localização.

Representa responsabilidade.

Campos

- id
- companyId
- assetUnitId
- holderLocationId
- startDate
- endDate
- reason
- observations
- createdBy
- createdAt

Sempre existirá apenas uma custódia ativa por AssetUnit.

Toda troca gera novo registro.

Nunca atualizar o histórico.

**Nota de implementação:** a custódia ativa é referenciada por
`AssetUnit.currentCustodyId`; o invariante "no máximo uma custódia ativa
(endDate null) por AssetUnit" é garantido pela aplicação, não por
constraint de banco.

---

# AssetMovement

Tabela mais importante do sistema.

Representa qualquer movimentação realizada.

Toda movimentação é imutável.

Nunca editar.

Nunca excluir.

Campos

- id
- companyId
- assetUnitId
- assetId
- movementType
- quantity
- originLocationId
- destinationLocationId
- custodyId
- executedBy
- executedAt
- referenceType
- referenceId
- observations
- createdAt

Relacionamentos

Origem

Destino

Usuário

Custódia

Asset

AssetUnit

---

# MovementType

Tipos oficiais

ENTRY

EXIT

ASSIGNMENT

RETURN

TRANSFER

RESERVATION

INVENTORY

ADJUSTMENT

LOSS

THEFT

DISPOSAL

MAINTENANCE_OUT

MAINTENANCE_IN

CALIBRATION

INSPECTION

Cada movimentação possui exatamente um tipo.

Novos tipos poderão ser adicionados futuramente.

**Nota de implementação:** modelado como tabela `MovementType` parametrizável
por empresa (para permitir adicionar tipos sem alterar código),
compartilhada entre `AssetMovement` e `StockMovement`.

---

# StockBalance

Representa o saldo atual de um Asset consumível em uma determinada localização.

Importante

Esta tabela NÃO é a fonte da verdade.

Ela existe apenas para otimizar consultas.

O saldo poderá ser reconstruído integralmente através das movimentações.

Campos

- id
- companyId
- assetId
- locationId
- quantity
- updatedAt

Nunca editar manualmente.

Sempre atualizar através das movimentações.

---

# StockMovement

Utilizado apenas para Assets com:

trackingMode = CONSUMABLE

Campos

- id
- companyId
- assetId
- movementType
- quantity
- originLocationId
- destinationLocationId
- executedBy
- executedAt
- observations

Toda alteração de saldo gera um StockMovement.

Nunca alterar movimentações anteriores.

---

# Company

**Nota de implementação:** entidade adicionada além da especificação
original — todo `companyId` referenciado pelas demais entidades aponta para
este model, como raiz do multi-tenancy.

Campos

- id
- name
- document
- active
- createdAt
- updatedAt
