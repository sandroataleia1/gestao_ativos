import { z } from "zod";

// `email` é normalizado (trim + lowercase) pelo chamador ANTES de chegar
// aqui (Sprint 0.6, Parte F, item 3) — este schema só valida o formato.
export const inviteCompanyMembershipSchema = z.object({
  email: z.email("Informe um email válido."),
  roleId: z.string().trim().min(1, "Informe o papel."),
});

export type InviteCompanyMembershipInput = z.infer<typeof inviteCompanyMembershipSchema>;
