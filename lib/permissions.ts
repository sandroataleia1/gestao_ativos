// Catálogo de permissões do sistema. Cada chave vira uma linha na tabela
// Permission (global, compartilhada entre empresas). Papéis (Role) são
// parametrizáveis por empresa e ganham um subconjunto dessas permissões via
// RolePermission — ver prisma/seed.ts e docs/auth-rbac.md.

export const PERMISSIONS = {
  ASSET_VIEW: "asset:view",
  ASSET_MANAGE: "asset:manage",
  ASSET_UNIT_VIEW: "asset_unit:view",
  ASSET_UNIT_MANAGE: "asset_unit:manage",
  LOCATION_VIEW: "location:view",
  LOCATION_MANAGE: "location:manage",
  CATEGORY_MANAGE: "category:manage",
  MANUFACTURER_MANAGE: "manufacturer:manage",
  SUPPLIER_MANAGE: "supplier:manage",
  MOVEMENT_VIEW: "movement:view",
  MOVEMENT_CREATE: "movement:create",
  CUSTODY_VIEW: "custody:view",
  CUSTODY_MANAGE: "custody:manage",
  STOCK_VIEW: "stock:view",
  STOCK_MANAGE: "stock:manage",
  USER_MANAGE: "user:manage",
  ROLE_MANAGE: "role:manage",
  EMPLOYEE_VIEW: "employee:view",
  EMPLOYEE_MANAGE: "employee:manage",
  REPORT_VIEW: "report:view",
  ALERT_VIEW: "alert:view",
  IMPORT_VIEW: "import:view",
  IMPORT_MANAGE: "import:manage",
  COMPANY_MANAGE: "company:manage",
  TRAINING_VIEW: "training:view",
  TRAINING_MANAGE: "training:manage",
  SST_PROVIDER_VIEW: "sst_provider:view",
  SST_PROVIDER_MANAGE: "sst_provider:manage",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_DESCRIPTIONS: Record<PermissionKey, string> = {
  [PERMISSIONS.ASSET_VIEW]: "Visualizar cadastro de ativos",
  [PERMISSIONS.ASSET_MANAGE]: "Criar/editar/inativar cadastro de ativos",
  [PERMISSIONS.ASSET_UNIT_VIEW]: "Visualizar unidades físicas de ativos",
  [PERMISSIONS.ASSET_UNIT_MANAGE]: "Criar/editar unidades físicas de ativos",
  [PERMISSIONS.LOCATION_VIEW]: "Visualizar localizações",
  [PERMISSIONS.LOCATION_MANAGE]: "Criar/editar localizações",
  [PERMISSIONS.CATEGORY_MANAGE]: "Gerenciar categorias de ativos",
  [PERMISSIONS.MANUFACTURER_MANAGE]: "Gerenciar fabricantes",
  [PERMISSIONS.SUPPLIER_MANAGE]: "Gerenciar fornecedores",
  [PERMISSIONS.MOVEMENT_VIEW]: "Visualizar movimentações",
  [PERMISSIONS.MOVEMENT_CREATE]: "Registrar movimentações de ativos",
  [PERMISSIONS.CUSTODY_VIEW]: "Visualizar custódias",
  [PERMISSIONS.CUSTODY_MANAGE]: "Atribuir/encerrar custódias",
  [PERMISSIONS.STOCK_VIEW]: "Visualizar saldo de estoque",
  [PERMISSIONS.STOCK_MANAGE]: "Registrar movimentações de estoque de consumíveis",
  [PERMISSIONS.USER_MANAGE]: "Gerenciar usuários e papéis",
  [PERMISSIONS.ROLE_MANAGE]: "Gerenciar papéis e permissões",
  [PERMISSIONS.EMPLOYEE_VIEW]: "Visualizar colaboradores",
  [PERMISSIONS.EMPLOYEE_MANAGE]: "Criar/editar/inativar colaboradores",
  [PERMISSIONS.REPORT_VIEW]: "Visualizar relatórios gerenciais e exportar dados",
  [PERMISSIONS.ALERT_VIEW]: "Visualizar central de alertas (CA, custódia, estoque)",
  [PERMISSIONS.IMPORT_VIEW]: "Visualizar tela de importação em lote",
  [PERMISSIONS.IMPORT_MANAGE]: "Importar colaboradores, ativos e estoque em lote via Excel",
  [PERMISSIONS.COMPANY_MANAGE]: "Editar dados e logo da empresa",
  [PERMISSIONS.TRAINING_VIEW]: "Visualizar catálogo de treinamentos",
  [PERMISSIONS.TRAINING_MANAGE]: "Criar/editar/inativar treinamentos da empresa",
  [PERMISSIONS.SST_PROVIDER_VIEW]: "Visualizar prestadores SST vinculados à empresa",
  [PERMISSIONS.SST_PROVIDER_MANAGE]: "Criar prestadores SST e autorizar/suspender/revogar vínculos",
};

export const SYSTEM_ROLES = {
  ADMIN: "ADMIN",
  RH: "RH",
  ALMOXARIFADO: "ALMOXARIFADO",
  TECNICO_SST: "TECNICO_SST",
  GESTOR: "GESTOR",
  CONSULTA: "CONSULTA",
} as const;

export type SystemRole = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

export const SYSTEM_ROLE_DESCRIPTIONS: Record<SystemRole, string> = {
  ADMIN: "Acesso total à empresa, incluindo gestão de usuários e papéis",
  RH: "Gestão de custódia e movimentação de ativos ligados a colaboradores",
  ALMOXARIFADO: "Gestão de estoque, unidades de ativos e localizações",
  TECNICO_SST: "Controle de EPIs e ativos ligados à segurança do trabalho",
  GESTOR: "Gestão operacional de ativos, sem administração de usuários",
  CONSULTA: "Acesso somente leitura a todo o domínio de ativos",
};

const ALL_PERMISSIONS = Object.values(PERMISSIONS);

export const DEFAULT_ROLE_PERMISSIONS: Record<SystemRole, PermissionKey[]> = {
  ADMIN: ALL_PERMISSIONS,
  GESTOR: [
    PERMISSIONS.ASSET_VIEW,
    PERMISSIONS.ASSET_UNIT_VIEW,
    PERMISSIONS.ASSET_UNIT_MANAGE,
    PERMISSIONS.LOCATION_VIEW,
    PERMISSIONS.LOCATION_MANAGE,
    PERMISSIONS.CATEGORY_MANAGE,
    PERMISSIONS.MANUFACTURER_MANAGE,
    PERMISSIONS.SUPPLIER_MANAGE,
    PERMISSIONS.MOVEMENT_VIEW,
    PERMISSIONS.MOVEMENT_CREATE,
    PERMISSIONS.CUSTODY_VIEW,
    PERMISSIONS.STOCK_VIEW,
    PERMISSIONS.EMPLOYEE_VIEW,
    PERMISSIONS.REPORT_VIEW,
    PERMISSIONS.ALERT_VIEW,
    PERMISSIONS.IMPORT_VIEW,
    PERMISSIONS.TRAINING_VIEW,
    PERMISSIONS.SST_PROVIDER_VIEW,
  ],
  // RH/ALMOXARIFADO/TECNICO_SST ganham import:view + import:manage "cheio"
  // (não há permissão por tipo de importação — ver docs/imports.md). As
  // anotações da matriz de import (RH ~ colaboradores; TECNICO_SST ~ ativos
  // e estoque) descrevem o uso esperado de cada papel, não uma trava
  // técnica: checar isso exigiria olhar o nome do papel, o que quebraria a
  // abstração de RBAC deste sistema (papéis são dados por empresa, não
  // hardcoded).
  RH: [
    PERMISSIONS.ASSET_VIEW,
    PERMISSIONS.ASSET_UNIT_VIEW,
    PERMISSIONS.CUSTODY_VIEW,
    PERMISSIONS.MOVEMENT_VIEW,
    PERMISSIONS.MOVEMENT_CREATE,
    PERMISSIONS.EMPLOYEE_VIEW,
    PERMISSIONS.EMPLOYEE_MANAGE,
    PERMISSIONS.REPORT_VIEW,
    PERMISSIONS.ALERT_VIEW,
    PERMISSIONS.IMPORT_VIEW,
    PERMISSIONS.IMPORT_MANAGE,
    PERMISSIONS.TRAINING_VIEW,
    PERMISSIONS.TRAINING_MANAGE,
    PERMISSIONS.SST_PROVIDER_VIEW,
  ],
  ALMOXARIFADO: [
    PERMISSIONS.ASSET_VIEW,
    PERMISSIONS.ASSET_MANAGE,
    PERMISSIONS.ASSET_UNIT_VIEW,
    PERMISSIONS.ASSET_UNIT_MANAGE,
    PERMISSIONS.LOCATION_VIEW,
    PERMISSIONS.MOVEMENT_VIEW,
    PERMISSIONS.MOVEMENT_CREATE,
    PERMISSIONS.CUSTODY_VIEW,
    PERMISSIONS.CUSTODY_MANAGE,
    PERMISSIONS.STOCK_VIEW,
    PERMISSIONS.STOCK_MANAGE,
    PERMISSIONS.EMPLOYEE_VIEW,
    PERMISSIONS.REPORT_VIEW,
    PERMISSIONS.ALERT_VIEW,
    PERMISSIONS.IMPORT_VIEW,
    PERMISSIONS.IMPORT_MANAGE,
    PERMISSIONS.TRAINING_VIEW,
  ],
  TECNICO_SST: [
    PERMISSIONS.ASSET_VIEW,
    PERMISSIONS.ASSET_MANAGE,
    PERMISSIONS.ASSET_UNIT_VIEW,
    PERMISSIONS.MOVEMENT_VIEW,
    PERMISSIONS.MOVEMENT_CREATE,
    PERMISSIONS.CUSTODY_VIEW,
    PERMISSIONS.CUSTODY_MANAGE,
    PERMISSIONS.STOCK_VIEW,
    PERMISSIONS.EMPLOYEE_VIEW,
    PERMISSIONS.REPORT_VIEW,
    PERMISSIONS.ALERT_VIEW,
    PERMISSIONS.IMPORT_VIEW,
    PERMISSIONS.IMPORT_MANAGE,
    PERMISSIONS.TRAINING_VIEW,
    PERMISSIONS.TRAINING_MANAGE,
    PERMISSIONS.SST_PROVIDER_VIEW,
    PERMISSIONS.SST_PROVIDER_MANAGE,
  ],
  // CONSULTA já tem *_VIEW de todo o domínio ("acesso somente leitura a todo
  // o domínio de ativos") — relatórios e alertas são apenas agregações de
  // leitura dos mesmos dados que esse papel já enxerga um a um, então negar
  // report:view/alert:view seria inconsistente com o propósito do papel.
  // Ver docs/reports.md e docs/alerts.md.
  CONSULTA: [
    PERMISSIONS.ASSET_VIEW,
    PERMISSIONS.ASSET_UNIT_VIEW,
    PERMISSIONS.LOCATION_VIEW,
    PERMISSIONS.MOVEMENT_VIEW,
    PERMISSIONS.CUSTODY_VIEW,
    PERMISSIONS.STOCK_VIEW,
    PERMISSIONS.EMPLOYEE_VIEW,
    PERMISSIONS.REPORT_VIEW,
    PERMISSIONS.ALERT_VIEW,
    PERMISSIONS.TRAINING_VIEW,
  ],
};
