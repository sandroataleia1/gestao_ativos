import type { CertificationType } from "@/app/generated/prisma/client";
import type { CertificationData, CertificationProvider } from "./provider";

/**
 * Provider placeholder: nenhuma integração externa foi implementada ainda.
 * Os dados de certificação hoje só entram via cadastro manual no formulário
 * de ativo (ver app/api/assets/route.ts e [id]/route.ts) — `getByNumber`
 * sempre retorna `null` porque não há nenhuma fonte externa para consultar.
 *
 * Quando uma integração real existir, ela implementa a mesma interface
 * `CertificationProvider` e passa a ser usada no lugar deste (ou em
 * conjunto, com fallback) — ver docs/certifications.md.
 */
export class ManualCertificationProvider implements CertificationProvider {
  async getByNumber(
    _type: CertificationType,
    _number: string,
  ): Promise<CertificationData | null> {
    return null;
  }
}
