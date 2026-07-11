import { z } from "zod";

export const SST_TEAM_ROLE_VALUES = ["OWNER", "TECHNICIAN", "VIEWER"] as const;

// `email` é normalizado (trim + lowercase) pelo chamador ANTES de chegar
// aqui — este schema só valida o formato.
export const addTeamMemberSchema = z.object({
  email: z.email("Informe um email válido."),
  role: z.enum(SST_TEAM_ROLE_VALUES),
});

export type AddTeamMemberInput = z.infer<typeof addTeamMemberSchema>;

export const changeTeamMemberRoleSchema = z.object({
  role: z.enum(SST_TEAM_ROLE_VALUES),
});

export type ChangeTeamMemberRoleInput = z.infer<typeof changeTeamMemberRoleSchema>;
