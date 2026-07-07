// Colunas exatas de cada planilha de importação — usadas tanto pra gerar o
// modelo de download (lib/excel.ts -> buildTemplateWorkbook) quanto, depois
// de normalizadas (lib/excel.ts -> normalizeHeader), pra ler cada linha do
// upload. Um só lugar pra não desalinhar as duas pontas.

export const EMPLOYEE_COLUMNS = [
  "nome",
  "documento",
  "email",
  "telefone",
  "matrícula",
  "setor",
  "cargo",
  "status",
] as const;

export const EMPLOYEE_EXAMPLE_ROW = [
  "Ana Souza",
  "123.456.789-00",
  "ana@empresa.com",
  "(11) 91234-5678",
  "0001",
  "Operações",
  "Almoxarife",
  "ACTIVE",
];

export const ASSET_COLUMNS = [
  "categoria",
  "nome",
  "código_sku",
  "modo_controle",
  "unidade_medida",
  "fabricante",
  "fornecedor",
  "status",
  "condição",
  "estoque_minimo",
  "possui_ca",
  "numero_ca",
  "validade_ca",
  "situacao_ca",
] as const;

export const ASSET_EXAMPLE_ROW = [
  "EPI",
  "Luva de Proteção",
  "LUV-001",
  "CONSUMABLE",
  "PAR",
  "3M",
  "",
  "Disponível",
  "Novo",
  "10",
  "sim",
  "12345",
  "2027-01-01",
  "VALID",
];

export const STOCK_CONSUMABLE_COLUMNS = ["codigo_sku", "local", "quantidade", "observação"] as const;

export const STOCK_CONSUMABLE_EXAMPLE_ROW = ["LUV-001", "Almoxarifado Principal", "50", ""];

export const STOCK_INDIVIDUAL_COLUMNS = [
  "codigo_sku",
  "local",
  "numero_serie",
  "patrimonio",
  "status",
  "condição",
  "observação",
] as const;

export const STOCK_INDIVIDUAL_EXAMPLE_ROW = [
  "FRD-001",
  "Almoxarifado Principal",
  "SN-0001",
  "",
  "Disponível",
  "Novo",
  "",
];
