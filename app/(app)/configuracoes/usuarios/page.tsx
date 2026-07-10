import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import { requirePermissionOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { UsersPanel } from "./users-panel";

export const metadata: Metadata = {
  title: "Usuários — Gestão de Ativos",
};

export default async function UsersPage() {
  const { companyId } = await requirePermissionOrDeny(PERMISSIONS.USER_MANAGE);

  const [users, roles] = await Promise.all([
    prisma.user.findMany({
      where: { companyId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        active: true,
        createdAt: true,
        userRoles: {
          where: { companyId },
          select: { role: { select: { id: true, name: true } } },
        },
      },
    }),
    prisma.role.findMany({
      where: { companyId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const initialUsers = users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    active: user.active,
    createdAt: user.createdAt.toISOString(),
    role: user.userRoles[0]?.role ?? null,
  }));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Usuários</h1>
        <p className="text-sm text-muted-foreground">
          Gerencie quem tem acesso ao sistema nesta empresa e qual papel cada pessoa tem.
        </p>
      </div>

      <UsersPanel initialUsers={initialUsers} roles={roles} />
    </div>
  );
}
