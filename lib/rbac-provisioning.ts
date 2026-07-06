import { prisma } from "@/lib/prisma";
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  SYSTEM_ROLE_DESCRIPTIONS,
  SYSTEM_ROLES,
  type PermissionKey,
  type SystemRole,
} from "@/lib/permissions";

/**
 * Garante que o catálogo global de Permission existe (idempotente).
 * Permission não é por empresa — é fixo, definido em lib/permissions.ts.
 */
export async function ensurePermissionCatalog() {
  const catalog = new Map<PermissionKey, { id: string }>();
  for (const key of Object.values(PERMISSIONS)) {
    const permission = await prisma.permission.upsert({
      where: { key },
      update: { description: PERMISSION_DESCRIPTIONS[key] },
      create: { key, description: PERMISSION_DESCRIPTIONS[key] },
    });
    catalog.set(key, permission);
  }
  return catalog;
}

/**
 * Cria (ou atualiza) os 6 papéis padrão do sistema para uma empresa e
 * aplica o mapa padrão de permissões (`DEFAULT_ROLE_PERMISSIONS`).
 * Idempotente — seguro para rodar mais de uma vez para a mesma empresa.
 * Usado tanto pelo seed quanto pelo fluxo público de registro
 * (app/api/register/route.ts), para que toda empresa nova (seed ou
 * self-service) comece com o mesmo RBAC básico.
 */
export async function provisionDefaultRolesForCompany(companyId: string) {
  const permissions = await ensurePermissionCatalog();

  const roles = new Map<SystemRole, { id: string }>();
  for (const name of Object.values(SYSTEM_ROLES)) {
    const role = await prisma.role.upsert({
      where: { companyId_name: { companyId, name } },
      update: { description: SYSTEM_ROLE_DESCRIPTIONS[name], isSystem: true },
      create: {
        companyId,
        name,
        description: SYSTEM_ROLE_DESCRIPTIONS[name],
        isSystem: true,
      },
    });
    roles.set(name, role);
  }

  for (const [roleName, permissionKeys] of Object.entries(DEFAULT_ROLE_PERMISSIONS) as [
    SystemRole,
    PermissionKey[],
  ][]) {
    const role = roles.get(roleName)!;
    const desiredPermissionIds = permissionKeys.map((key) => permissions.get(key)!.id);

    for (const permissionId of desiredPermissionIds) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        update: {},
        create: { roleId: role.id, permissionId },
      });
    }

    // Papéis de sistema são totalmente controlados por DEFAULT_ROLE_PERMISSIONS
    // — remove qualquer permissão que tenha saído da lista (ex.: GESTOR
    // perdeu asset:manage), para que rodar o seed de novo realmente
    // sincronize o estado, não só adicione. Não mexe em papéis customizados
    // que a empresa venha a criar (isSystem: false).
    await prisma.rolePermission.deleteMany({
      where: {
        roleId: role.id,
        permissionId: { notIn: desiredPermissionIds },
      },
    });
  }

  return roles;
}
