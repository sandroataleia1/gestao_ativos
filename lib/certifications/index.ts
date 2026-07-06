import type { Prisma } from "@/app/generated/prisma/client";
import { ValidationError } from "@/lib/api-errors";
import type { CertificationInput } from "@/lib/validations/certification";

// Funções puras (client-safe) ficam em ./badge — reexportadas aqui para
// quem importa o barrel `@/lib/certifications` a partir de código server
// (rotas de API). Client Components devem importar de
// `@/lib/certifications/badge` diretamente, nunca deste arquivo: ele importa
// `ValidationError` (lib/api-errors -> lib/auth-server -> next/headers +
// Prisma/pg), que quebra o bundle de browser se entrar na cadeia de imports
// de um Client Component.
export * from "./badge";

/** Remove chaves `undefined` (campos de metadata deixados em branco no
 * formulário); devolve `undefined` se não sobrar nada para gravar. */
function cleanMetadata(
  metadata: Record<string, unknown> | undefined,
): Prisma.InputJsonValue | undefined {
  if (!metadata) return undefined;
  const entries = Object.entries(metadata).filter(([, value]) => value !== undefined);
  return entries.length > 0 ? (Object.fromEntries(entries) as Prisma.InputJsonValue) : undefined;
}

/**
 * Cria ou atualiza (quando `certification.id` vem preenchido) a certificação
 * de um ativo, dentro da mesma transação que cria/edita o Asset. Reaproveitado
 * por POST/PUT em app/api/assets — ver requisito 8 da demanda de CA.
 *
 * Server-only: chame apenas a partir de Route Handlers/Server Components.
 */
export async function upsertAssetCertification(
  tx: Prisma.TransactionClient,
  companyId: string,
  assetId: string,
  certification: CertificationInput,
) {
  const data = {
    companyId,
    assetId,
    certificationType: certification.certificationType,
    certificationNumber: certification.certificationNumber,
    issueDate: certification.issueDate,
    expirationDate: certification.expirationDate,
    status: certification.status,
    issuer: certification.issuer,
    documentUrl: certification.documentUrl,
    externalId: certification.externalId,
    metadata: cleanMetadata(certification.metadata),
  };

  if (certification.id) {
    const existing = await tx.assetCertification.findFirst({
      where: { id: certification.id, companyId, assetId },
      select: { id: true },
    });
    if (!existing) throw new ValidationError("Certificação inválida.");
    return tx.assetCertification.update({ where: { id: certification.id }, data });
  }

  return tx.assetCertification.create({ data });
}
