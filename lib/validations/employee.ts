import { z } from "zod";

export const EMPLOYEE_STATUS_VALUES = ["ACTIVE", "INACTIVE"] as const;

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalText = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

// Usado tanto na criação quanto na edição (PUT substitui o recurso
// inteiro, então os dois fluxos exigem os mesmos campos obrigatórios).
export const employeeInputSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(200),
  document: z.string().trim().min(3, "Informe um documento válido.").max(32),
  email: z.preprocess(
    emptyToUndefined,
    z.email("Informe um email válido.").optional(),
  ),
  phone: optionalText(32),
  registration: optionalText(64),
  departmentId: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  positionId: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  status: z.enum(EMPLOYEE_STATUS_VALUES).default("ACTIVE"),
});

export type EmployeeInput = z.infer<typeof employeeInputSchema>;
