import { z } from "zod";

// Criação rápida de Departamento/Cargo a partir do cadastro de colaborador
// (botão "+" — ver app/(app)/employees/employee-form.tsx). Só o nome, sem
// tela de gestão própria ainda (edição/inativação ficam para uma etapa
// futura, se necessário).

export const departmentInputSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(100),
});
export type DepartmentInput = z.infer<typeof departmentInputSchema>;

export const positionInputSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(100),
});
export type PositionInput = z.infer<typeof positionInputSchema>;
