import { z } from "zod";

// `companyId` é um cuid (ver @default(cuid()) em prisma/schema.prisma) —
// validamos só o formato aqui; a autorização de verdade (o usuário tem
// mesmo uma CompanyMembership ACTIVE para este id) é sempre feita pelo
// resolver central (lib/company-context.ts), nunca por este schema.
export const companyContextSelectSchema = z.object({
  companyId: z.string().trim().min(1, "Informe a empresa."),
});

export type CompanyContextSelectInput = z.infer<typeof companyContextSelectSchema>;
