import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/api-errors";
import { logAudit } from "@/lib/audit";
import { formatCnpj, isValidCnpj, maskCnpjForLog, normalizeCnpj } from "@/lib/cnpj";

// Sprint Comercial SST 1.4 — pré-cadastro de empresa e solicitação de
// autorização pelo Portal Consultoria, a partir do CNPJ. Regra central
// (§3, permanente): a empresa é sempre dona dos seus dados;
// `createdByProviderId` é só proveniência; acesso da consultoria é sempre
// via SstProviderCompany; conhecer o CNPJ nunca concede acesso sozinho.
//
// Nunca usa `providerId` vindo do client em nenhuma função aqui — sempre
// recebido já resolvido da sessão (`requireSstAuth()`/`requireSstRole`) na
// camada de rota.

export type CnpjCheckResult =
  | { status: "AVAILABLE" }
  | { status: "ALREADY_AUTHORIZED"; companyId: string; companyName: string }
  | { status: "AUTHORIZATION_REQUIRED" }
  | { status: "AUTHORIZATION_PENDING" }
  | { status: "RELATIONSHIP_REVIEW_REQUIRED" }
  | { status: "COMPANY_UNAVAILABLE" };

/** Verificação SOMENTE LEITURA de CNPJ (§10 fase 1 / §18) — nunca cria nada.
 * Resposta reduzida ao mínimo necessário (§18): só revela nome/id da
 * empresa quando o vínculo desta consultoria já está ACTIVE (nesse caso ela
 * já tem acesso de qualquer forma, então não há nada a proteger). */
export async function checkCnpjForProvider(providerId: string, cnpjInput: string): Promise<CnpjCheckResult> {
  if (!isValidCnpj(cnpjInput)) {
    throw new ValidationError("Informe um CNPJ válido.");
  }
  const documentNormalized = normalizeCnpj(cnpjInput);

  const company = await prisma.company.findFirst({
    where: { documentType: "CNPJ", documentNormalized },
    select: { id: true, name: true, operationalStatus: true },
  });

  if (!company) return { status: "AVAILABLE" };

  const link = await prisma.sstProviderCompany.findUnique({
    where: { providerId_companyId: { providerId, companyId: company.id } },
  });

  if (link) {
    if (link.status === "ACTIVE") {
      return { status: "ALREADY_AUTHORIZED", companyId: company.id, companyName: company.name };
    }
    if (link.status === "PENDING") return { status: "AUTHORIZATION_PENDING" };
    // SUSPENDED | REVOKED | REJECTED — nunca reativa automaticamente (§12/§15).
    return { status: "RELATIONSHIP_REVIEW_REQUIRED" };
  }

  // Sem vínculo ainda — só bloqueia CRIAR um novo pedido se a empresa em si
  // estiver indisponível (nunca afeta um vínculo ACTIVE já existente, que é
  // tratado acima antes desta checagem).
  if (company.operationalStatus === "SUSPENDED" || company.operationalStatus === "CLOSED") {
    return { status: "COMPANY_UNAVAILABLE" };
  }

  return { status: "AUTHORIZATION_REQUIRED" };
}

type ExistingCompanyRef = { id: string; operationalStatus: "ACTIVE" | "SUSPENDED" | "CLOSED" };
type Actor = { id: string; name: string };

export type RequestAccessResult =
  | { status: "ALREADY_AUTHORIZED"; link: { id: string } }
  | { status: "AUTHORIZATION_PENDING"; link: { id: string } }
  | { status: "AUTHORIZATION_REQUESTED"; link: { id: string } };

/** Núcleo compartilhado por `requestAccessToCompany` e pela recuperação de
 * corrida de `preRegisterCompany` (§11/§12/§20 — concorrência) — sempre
 * parte de uma Company JÁ RESOLVIDA (nunca aceita um `companyId` vindo do
 * client). Nunca reativa SUSPENDED/REVOKED/REJECTED automaticamente. */
async function continueWithExistingCompany(
  company: ExistingCompanyRef,
  providerId: string,
  actor: Actor,
): Promise<RequestAccessResult> {
  const existingLink = await prisma.sstProviderCompany.findUnique({
    where: { providerId_companyId: { providerId, companyId: company.id } },
  });

  if (existingLink) {
    if (existingLink.status === "ACTIVE") return { status: "ALREADY_AUTHORIZED", link: existingLink };
    if (existingLink.status === "PENDING") return { status: "AUTHORIZATION_PENDING", link: existingLink };
    throw new ConflictError(
      "Este vínculo foi encerrado anteriormente e não pode ser reativado automaticamente. É necessária uma nova solicitação revisada pela empresa.",
    );
  }

  if (company.operationalStatus === "SUSPENDED" || company.operationalStatus === "CLOSED") {
    // Mensagem genérica — nunca revela o motivo operacional exato (§12).
    throw new ValidationError("Não é possível solicitar autorização para esta empresa no momento.");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const link = await tx.sstProviderCompany.create({
        data: { providerId, companyId: company.id, status: "PENDING", accessLevel: "OPERATION" },
      });
      await logAudit(tx, {
        companyId: company.id,
        actorUserId: actor.id,
        actorName: actor.name,
        actorType: "SST_PROVIDER_USER",
        providerId,
        action: "sst_company.request_access",
        targetType: "SstProviderCompany",
        targetId: link.id,
      });
      return { status: "AUTHORIZATION_REQUESTED", link };
    });
  } catch (error) {
    // Corrida: duas requisições da mesma consultoria pedindo acesso à mesma
    // empresa ao mesmo tempo — a constraint única (providerId, companyId) é
    // a fonte final de verdade; o perdedor só relê o vínculo já criado.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await prisma.sstProviderCompany.findUniqueOrThrow({
        where: { providerId_companyId: { providerId, companyId: company.id } },
      });
      if (raced.status === "ACTIVE") return { status: "ALREADY_AUTHORIZED", link: raced };
      if (raced.status === "PENDING") return { status: "AUTHORIZATION_PENDING", link: raced };
      throw new ConflictError(
        "Este vínculo foi encerrado anteriormente e não pode ser reativado automaticamente. É necessária uma nova solicitação revisada pela empresa.",
      );
    }
    throw error;
  }
}

/** Solicita autorização para uma empresa JÁ EXISTENTE (§12) — nunca cria uma
 * segunda Company, nunca concede acesso imediato (nasce sempre PENDING). */
export async function requestAccessToCompany(providerId: string, actor: Actor, cnpjInput: string): Promise<RequestAccessResult> {
  if (!isValidCnpj(cnpjInput)) {
    throw new ValidationError("Informe um CNPJ válido.");
  }
  const documentNormalized = normalizeCnpj(cnpjInput);

  const company = await prisma.company.findFirst({
    where: { documentType: "CNPJ", documentNormalized },
    select: { id: true, operationalStatus: true },
  });
  if (!company) {
    throw new NotFoundError("Nenhuma empresa encontrada com este CNPJ. Use o pré-cadastro para criar uma nova.");
  }

  return continueWithExistingCompany(company, providerId, actor);
}

export type PreRegisterResult =
  | { created: true; company: { id: string; name: string }; link: { id: string } }
  | { created: false; reason: "ALREADY_AUTHORIZED" | "AUTHORIZATION_PENDING" | "AUTHORIZATION_REQUESTED" };

/** Pré-cadastra uma empresa NOVA (§11) — cria `Company` (UNCLAIMED,
 * origin=SST_PROVIDER) + `SstProviderCompany` (ACTIVE, ADMINISTRATION) na
 * MESMA transação. Nunca faz uma checagem de existência ANTES de tentar
 * criar (isso abriria uma janela de corrida onde duas requisições
 * concorrentes passariam as duas pela checagem) — a constraint única do
 * banco (`documentType`, `documentNormalized`) é sempre a fonte final de
 * verdade; se outra requisição já criou a empresa (mesmo CNPJ, mesma
 * consultoria ou outra, sequencial ou concorrente), o INSERT falha com
 * P2002 e o chamador cai no fluxo seguro de empresa existente
 * (`continueWithExistingCompany`) — nunca cria uma segunda Company, e nunca
 * herda ADMINISTRATION de graça por ter perdido a corrida. */
export async function preRegisterCompany(
  providerId: string,
  actor: Actor,
  input: { cnpj: string; name: string },
): Promise<PreRegisterResult> {
  if (!isValidCnpj(input.cnpj)) {
    throw new ValidationError("Informe um CNPJ válido.");
  }
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new ValidationError("Informe o nome da empresa.");
  }
  const documentNormalized = normalizeCnpj(input.cnpj);
  const documentOriginal = formatCnpj(input.cnpj);

  try {
    return await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          name: trimmedName,
          document: documentOriginal,
          documentType: "CNPJ",
          documentOriginal,
          documentNormalized,
          operationalStatus: "ACTIVE",
          controlStatus: "UNCLAIMED",
          origin: "SST_PROVIDER",
          createdByProviderId: providerId,
        },
      });
      const link = await tx.sstProviderCompany.create({
        data: {
          providerId,
          companyId: company.id,
          status: "ACTIVE",
          accessLevel: "ADMINISTRATION",
          approvedAt: new Date(),
        },
      });
      await logAudit(tx, {
        companyId: company.id,
        actorUserId: actor.id,
        actorName: actor.name,
        actorType: "SST_PROVIDER_USER",
        providerId,
        action: "sst_company.pre_register",
        targetType: "Company",
        targetId: company.id,
        targetLabel: trimmedName,
        metadata: { cnpjMasked: maskCnpjForLog(documentNormalized) },
      });
      return { created: true, company: { id: company.id, name: company.name }, link: { id: link.id } };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await prisma.company.findFirst({
        where: { documentType: "CNPJ", documentNormalized },
        select: { id: true, name: true, operationalStatus: true },
      });
      if (!raced) throw error; // não deveria acontecer — a violação de unicidade implica que a linha existe.

      await logAudit(prisma, {
        companyId: raced.id,
        actorUserId: actor.id,
        actorName: actor.name,
        actorType: "SST_PROVIDER_USER",
        providerId,
        action: "sst_company.pre_register_race_recovered",
        targetType: "Company",
        targetId: raced.id,
        metadata: { cnpjMasked: maskCnpjForLog(documentNormalized) },
      });

      const result = await continueWithExistingCompany(raced, providerId, actor);
      return { created: false, reason: result.status };
    }
    throw error;
  }
}
