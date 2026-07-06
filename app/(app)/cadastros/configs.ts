import type { LookupEntityConfig } from "./types";

export const CATEGORY_CONFIG: LookupEntityConfig = {
  key: "categories",
  tabLabel: "Categorias",
  title: "Categoria",
  description: "Categorias usadas para classificar os ativos.",
  apiBasePath: "/api/asset-categories",
  nameField: "name",
  hasActiveToggle: true,
  fields: [
    { key: "name", label: "Nome", type: "text" },
    { key: "description", label: "Descrição", type: "textarea" },
    { key: "color", label: "Cor (hex)", type: "text", isColor: true, placeholder: "#2563eb" },
  ],
  columns: [
    { key: "name", label: "Nome" },
    { key: "description", label: "Descrição" },
    { key: "color", label: "Cor", isColor: true },
  ],
};

export const MANUFACTURER_CONFIG: LookupEntityConfig = {
  key: "manufacturers",
  tabLabel: "Fabricantes",
  title: "Fabricante",
  description: "Fabricantes vinculados ao cadastro de ativos.",
  apiBasePath: "/api/manufacturers",
  nameField: "name",
  hasActiveToggle: false,
  fields: [
    { key: "name", label: "Nome", type: "text" },
    { key: "document", label: "CNPJ/Documento", type: "text", mask: "cnpj", placeholder: "00.000.000/0000-00" },
    { key: "website", label: "Site", type: "text", placeholder: "https://..." },
    { key: "email", label: "E-mail", type: "text" },
    { key: "phone", label: "Telefone", type: "text", mask: "phone", placeholder: "(00) 00000-0000" },
  ],
  columns: [
    { key: "name", label: "Nome" },
    { key: "document", label: "Documento" },
    { key: "phone", label: "Telefone" },
    { key: "email", label: "E-mail" },
  ],
};

export const SUPPLIER_CONFIG: LookupEntityConfig = {
  key: "suppliers",
  tabLabel: "Fornecedores",
  title: "Fornecedor",
  description: "Fornecedores vinculados ao cadastro de ativos.",
  apiBasePath: "/api/suppliers",
  nameField: "corporateName",
  hasActiveToggle: true,
  fields: [
    { key: "corporateName", label: "Razão social", type: "text" },
    { key: "tradeName", label: "Nome fantasia", type: "text" },
    { key: "document", label: "CNPJ", type: "text", mask: "cnpj", placeholder: "00.000.000/0000-00" },
    { key: "stateRegistration", label: "Inscrição estadual", type: "text" },
    { key: "municipalRegistration", label: "Inscrição municipal", type: "text" },
    { key: "contactName", label: "Contato", type: "text" },
    { key: "email", label: "E-mail", type: "text" },
    { key: "phone", label: "Telefone", type: "text", mask: "phone", placeholder: "(00) 00000-0000" },
    { key: "address", label: "Endereço", type: "text" },
    { key: "city", label: "Cidade", type: "text" },
    { key: "state", label: "UF", type: "text", mask: "uf", placeholder: "SP" },
    { key: "zipCode", label: "CEP", type: "text", mask: "cep", placeholder: "00000-000" },
    { key: "notes", label: "Observações", type: "textarea" },
  ],
  columns: [
    { key: "corporateName", label: "Razão social" },
    { key: "tradeName", label: "Nome fantasia" },
    { key: "document", label: "CNPJ" },
    { key: "phone", label: "Telefone" },
  ],
};

// Status e Condição de ativo NÃO têm mais tela de cadastro/edição — são
// fixos, definidos só pelo seed (ver prisma/seed.ts). Isso evita uma tela de
// manutenção para uma lista pequena e estável de valores, e garante um
// vocabulário consistente entre ativos/relatórios. Os selects do formulário
// de ativo continuam mostrando os valores seedados normalmente.
