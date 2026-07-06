import type { Prisma } from "@/app/generated/prisma/client";

// Este arquivo é importado por Client Components (ex.: assets-table.tsx)
// para calcular o badge de CA no browser — por isso não pode ter NENHUM
// import em runtime de código server-only (Prisma client, lib/auth-server,
// lib/api-errors etc.), só `import type`. A parte server-only
// (upsertAssetCertification) fica em lib/certifications/index.ts.

export type CaBadge = "VALID" | "EXPIRED" | "NONE";

type CertificationForBadge = {
  certificationType: string;
  status: string;
  expirationDate: Date | null;
};

/**
 * Deriva o badge de CA de um ativo a partir das certificações carregadas
 * (`assetListInclude` já inclui `certifications`). Um ativo pode ter várias
 * certificações do tipo CA ao longo do tempo (renovações) — "válido" exige
 * ao menos uma com status VALID e sem vencimento (ou vencimento futuro).
 */
export function computeCaBadge(certifications: CertificationForBadge[]): CaBadge {
  const caCertifications = certifications.filter((c) => c.certificationType === "CA");
  if (caCertifications.length === 0) return "NONE";

  const now = new Date();
  const hasValid = caCertifications.some(
    (c) => c.status === "VALID" && (!c.expirationDate || c.expirationDate >= now),
  );
  return hasValid ? "VALID" : "EXPIRED";
}

export const CA_STATUS_VALUES = ["valid", "expired", "none"] as const;
export type CaStatusFilter = (typeof CA_STATUS_VALUES)[number];

/**
 * Monta a cláusula `where` do Prisma para os filtros "ativos com CA
 * vencido/sem CA/com CA válido" em GET /api/assets. Só constrói objetos
 * literais tipados — não chama nada do Prisma em runtime, então continua
 * seguro para o bundle de client.
 */
export function buildCaStatusWhere(caStatus: CaStatusFilter): Prisma.AssetWhereInput {
  const now = new Date();

  if (caStatus === "none") {
    return { certifications: { none: { certificationType: "CA" } } };
  }

  const validCondition: Prisma.AssetCertificationWhereInput = {
    certificationType: "CA",
    status: "VALID",
    OR: [{ expirationDate: null }, { expirationDate: { gte: now } }],
  };

  if (caStatus === "valid") {
    return { certifications: { some: validCondition } };
  }

  // "expired": tem ao menos uma certificação CA, mas nenhuma válida no momento.
  return {
    AND: [
      { certifications: { some: { certificationType: "CA" } } },
      { certifications: { none: validCondition } },
    ],
  };
}
