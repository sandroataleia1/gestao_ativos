import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { provisionDefaultRolesForCompany } from "@/lib/rbac-provisioning";
import type {
  CompanyMembershipStatus,
  SstProviderCompanyStatus,
  SstProviderUserRole,
} from "@/app/generated/prisma/client";

// Marcador único para tudo que os testes criam. Torna as fixtures
// identificáveis e permite uma limpeza defensiva de execuções anteriores que
// tenham falhado no meio. NUNCA truncamos tabelas — só removemos linhas que
// nós mesmos criamos, escopadas por companyId/providerId.
export const TEST_PREFIX = "__tenant_test__";

function uid(): string {
  return randomUUID().slice(0, 8);
}

// --- Fábricas ---------------------------------------------------------------

export async function createTestCompany(label = "co") {
  return prisma.company.create({
    data: { name: `${TEST_PREFIX}${label}-${uid()}` },
  });
}

/** Cria a empresa e provisiona os 6 papéis de sistema + catálogo de permissões. */
export async function createTestCompanyWithRoles(label = "co") {
  const company = await createTestCompany(label);
  await provisionDefaultRolesForCompany(company.id);
  return company;
}

/** Cria o `User` sozinho, SEM `CompanyMembership` — use quando o teste
 * precisa exatamente desse estado (ex.: provar que UserRole sozinho não é
 * membership). Para um usuário "normal" que precisa passar por
 * `requireCompany()`/`requirePermission()`, use `createTestUserWithMembership`. */
export async function createTestUser(companyId: string, label = "user") {
  return prisma.user.create({
    data: {
      companyId,
      name: `${TEST_PREFIX}${label}`,
      email: `${TEST_PREFIX}${label}-${uid()}@example.test`,
      active: true,
    },
  });
}

/**
 * Cria o `User` E uma `CompanyMembership` ACTIVE correspondente — o estado
 * "normal" de todo usuário real desde a M2B (backfill). Use este helper (não
 * `createTestUser` sozinho) sempre que o teste for exercitar
 * `requireCompany()`/`requirePermission()` esperando sucesso (Sprint 0.5:
 * `CompanyMembership` é a fonte real de autorização — um `User` sem
 * membership é corretamente bloqueado).
 */
export async function createTestUserWithMembership(companyId: string, label = "user") {
  const user = await createTestUser(companyId, label);
  await createTestMembership({ userId: user.id, companyId, status: "ACTIVE" });
  return user;
}

/** Atribui um papel de sistema (ex.: "ADMIN") a um usuário dentro de uma empresa. */
export async function assignSystemRole(userId: string, companyId: string, roleName: string) {
  const role = await prisma.role.findFirstOrThrow({
    where: { companyId, name: roleName },
  });
  return prisma.userRole.create({ data: { userId, companyId, roleId: role.id } });
}

export async function createTestEmployee(companyId: string, label = "emp") {
  return prisma.employee.create({
    data: {
      companyId,
      name: `${TEST_PREFIX}${label}`,
      document: uid() + uid(), // documento fictício único
    },
  });
}

export async function createTestProvider(label = "prov") {
  return prisma.sstProvider.create({
    data: { name: `${TEST_PREFIX}${label}-${uid()}`, active: true },
  });
}

export async function linkProviderToCompany(params: {
  providerId: string;
  companyId: string;
  status: SstProviderCompanyStatus;
  accessLevel?: "VIEW" | "OPERATION" | "ADMINISTRATION";
}) {
  return prisma.sstProviderCompany.create({
    data: {
      providerId: params.providerId,
      companyId: params.companyId,
      status: params.status,
      accessLevel: params.accessLevel ?? "OPERATION",
    },
  });
}

export async function createProviderUser(params: {
  providerId: string;
  userId: string;
  role?: SstProviderUserRole;
}) {
  return prisma.sstProviderUser.create({
    data: {
      providerId: params.providerId,
      userId: params.userId,
      role: params.role ?? "TECHNICIAN",
      active: true,
    },
  });
}

/** Cria uma CompanyMembership — status opcional (default do schema: INVITED). */
export async function createTestMembership(params: {
  userId: string;
  companyId: string;
  status?: CompanyMembershipStatus;
  invitedByUserId?: string | null;
}) {
  return prisma.companyMembership.create({
    data: {
      userId: params.userId,
      companyId: params.companyId,
      ...(params.status ? { status: params.status } : {}),
      invitedByUserId: params.invitedByUserId ?? null,
    },
  });
}

// --- Sessão de teste (shape do objeto que Better Auth devolveria) -----------

export type TestSessionUser = {
  id: string;
  name: string;
  email: string;
  companyId: string;
  active: boolean;
};

export function toSessionUser(user: {
  id: string;
  name: string;
  email: string;
  companyId: string;
}): TestSessionUser {
  return { ...user, active: true };
}

// --- Limpeza ----------------------------------------------------------------

/**
 * Remove todas as fixtures criadas pelos testes, escopadas pelos ids
 * fornecidos. Ordem respeita as FKs. Providers primeiro (removem
 * SstProviderUser que referenciam Users), depois as empresas.
 */
export async function cleanupFixtures(params: {
  companyIds?: string[];
  providerIds?: string[];
}) {
  const companyIds = params.companyIds ?? [];
  const providerIds = params.providerIds ?? [];

  if (providerIds.length > 0) {
    // Company.createdByProviderId usa onDelete: Restrict (Sprint Comercial
    // SST 1.4 — pré-cadastro de empresa pela consultoria, ver
    // lib/sst-company-provisioning.ts:preRegisterCompany) — precisa ser
    // desvinculado antes de excluir o SstProvider, senão o DELETE falha com
    // violação de FK. Nunca apaga a Company aqui, só remove a referência
    // (a Company em si é limpa mais abaixo, escopada por companyIds).
    await prisma.company.updateMany({
      where: { createdByProviderId: { in: providerIds } },
      data: { createdByProviderId: null },
    });
    await prisma.sstProviderUser.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.sstProviderCompany.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.sstProvider.deleteMany({ where: { id: { in: providerIds } } });
  }

  if (companyIds.length > 0) {
    // CompanyMembership.companyId usa onDelete: Restrict — precisa ser
    // removida antes de qualquer tentativa de excluir a Company, senão o
    // DELETE da empresa falha com violação de FK.
    await prisma.companyMembership.deleteMany({ where: { companyId: { in: companyIds } } });
    // Vínculos de provider que apontem para estas empresas (por segurança,
    // caso algum tenha sido criado por um provider não rastreado).
    await prisma.sstProviderCompany.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.auditLog.deleteMany({ where: { companyId: { in: companyIds } } });
    // Cadeia de ativos/estoque (Sprint Demo Comercial SST 1.2 — primeiro
    // teste a criar Asset/StockBalance via este helper, ver
    // tests/tenant-isolation/dashboard-alerts-scope.test.ts): filhos antes
    // dos lookups que eles referenciam.
    await prisma.stockBalance.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.stockMovement.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.assetMovement.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.assetUnit.updateMany({ where: { companyId: { in: companyIds } }, data: { currentCustodyId: null } });
    // Termo/assinatura/foto de custódia (Sprint Demo Comercial — Wizard de
    // Nova Entrega, primeiro teste a exercitar o fluxo de assinatura via
    // este helper): todos referenciam AssetCustody (e CustodySignature/
    // CustodySignatureRequest também referenciam CustodyDocument), então
    // saem antes dela.
    await prisma.custodySignature.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.custodySignatureRequest.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.custodyDocument.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.custodyPhoto.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.assetCustody.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.assetUnit.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.asset.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.assetCategory.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.assetStatus.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.assetCondition.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.location.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.locationType.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.movementType.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.employee.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.userRole.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.user.deleteMany({ where: { companyId: { in: companyIds } } });
    // Deletar Role cascateia RolePermission (onDelete: Cascade no schema).
    await prisma.role.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
  }
}

export { prisma };
