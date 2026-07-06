import type { CertificationStatus, CertificationType } from "@/app/generated/prisma/client";

/**
 * Formato normalizado que qualquer provedor de certificação (manual ou
 * futuramente uma integração externa) deve devolver. Independente de tipo —
 * dados específicos de um tipo (ex.: CA) vão em `metadata`, no mesmo formato
 * usado por `AssetCertification.metadata` (ver lib/validations/certification.ts).
 */
export type CertificationData = {
  certificationNumber: string;
  issueDate?: Date;
  expirationDate?: Date;
  status: CertificationStatus;
  issuer?: string;
  documentUrl?: string;
  externalId?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Contrato que qualquer provedor de consulta de certificação precisa
 * implementar. Hoje só existe `ManualCertificationProvider` (não consulta
 * nada, é o fallback para cadastro manual). Uma futura integração real
 * (ex.: API pública de consulta de CA) implementaria esta mesma interface,
 * e o restante do app (rotas, formulário) não precisaria mudar — só trocar
 * qual provider é instanciado. Ver docs/certifications.md.
 */
export interface CertificationProvider {
  getByNumber(type: CertificationType, number: string): Promise<CertificationData | null>;
}
