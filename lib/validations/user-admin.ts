import { z } from "zod";

export const createUserInputSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(200),
  email: z.email("Informe um email válido."),
  password: z.string().min(8, "A senha deve ter pelo menos 8 caracteres.").max(128),
  roleId: z.string().min(1, "Selecione um papel."),
});
export type CreateUserInput = z.infer<typeof createUserInputSchema>;

export const inviteUserInputSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(200),
  email: z.email("Informe um email válido."),
  roleId: z.string().min(1, "Selecione um papel."),
});
export type InviteUserInput = z.infer<typeof inviteUserInputSchema>;

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

// PATCH parcial — cada campo é opcional independentemente (nome, papel e
// status podem ser alterados em telas/ações separadas na UI).
export const updateUserProfileInputSchema = z.object({
  name: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(200).optional()),
  roleId: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  active: z.boolean().optional(),
});
export type UpdateUserProfileInput = z.infer<typeof updateUserProfileInputSchema>;
