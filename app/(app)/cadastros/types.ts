export type LookupFieldConfig = {
  key: string;
  label: string;
  type: "text" | "textarea";
  isColor?: boolean;
  placeholder?: string;
  // Aplica lib/masks.ts progressivamente no onChange (ex.: CNPJ, telefone).
  mask?: "cnpj" | "cpf" | "cep" | "phone" | "uf";
};

export type LookupRow = Record<string, unknown> & { id: string };

export type LookupEntityConfig = {
  key: string;
  tabLabel: string;
  title: string;
  description: string;
  apiBasePath: string;
  nameField: string;
  fields: LookupFieldConfig[];
  hasActiveToggle: boolean;
  columns: { key: string; label: string; isColor?: boolean }[];
};
