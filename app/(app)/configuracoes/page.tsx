import type { Metadata } from "next";
import Link from "next/link";
import {
  BriefcaseIcon,
  BuildingIcon,
  MessageCircleIcon,
  ShieldCheckIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";

import { prisma } from "@/lib/prisma";
import { getCurrentCompany, hasPermission, requireAuthOrDeny } from "@/lib/auth-server";
import { PERMISSIONS, PERMISSION_DESCRIPTIONS, type PermissionKey } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WhatsappConnectPanel } from "./whatsapp-connect-panel";

export const metadata: Metadata = {
  title: "Configurações — Gestão de Ativos",
};

function formatDateTime(value: Date) {
  return value.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Tela somente leitura: dados da própria empresa/conta e as permissões
// efetivas do usuário logado (união dos papéis atribuídos a ele nesta
// empresa). Gestão de usuários (USER_MANAGE) tem tela própria em
// /configuracoes/usuarios; papéis customizados (ROLE_MANAGE) e cadastros de
// apoio (CATEGORY_MANAGE etc.) continuam sem UI própria.
export default async function SettingsPage() {
  const user = await requireAuthOrDeny();
  const company = await getCurrentCompany();
  const canManageUsers = await hasPermission(PERMISSIONS.USER_MANAGE);
  const canManageCompany = await hasPermission(PERMISSIONS.COMPANY_MANAGE);
  const canViewSstProviders = await hasPermission(PERMISSIONS.SST_PROVIDER_VIEW);
  const canManageSstProviders = await hasPermission(PERMISSIONS.SST_PROVIDER_MANAGE);

  const userRoles = await prisma.userRole.findMany({
    where: { userId: user.id, companyId: user.companyId },
    include: {
      role: {
        include: { permissions: { include: { permission: true } } },
      },
    },
  });

  const roleNames = userRoles.map((userRole) => userRole.role.name);

  const permissionKeys = new Set<string>();
  for (const userRole of userRoles) {
    for (const rolePermission of userRole.role.permissions) {
      permissionKeys.add(rolePermission.permission.key);
    }
  }
  const sortedPermissions = Array.from(permissionKeys).sort();

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Configurações</h1>
        <p className="text-sm text-muted-foreground">
          Dados da empresa, da sua conta e das permissões que você tem hoje.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BuildingIcon className="size-4 text-primary" />
              <CardTitle className="text-sm font-medium text-muted-foreground">Empresa</CardTitle>
            </div>
            {canManageCompany ? (
              <Button variant="outline" size="sm" render={<Link href="/configuracoes/empresa" />}>
                Gerenciar
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="grid gap-1.5 text-sm">
            <p>
              <span className="text-muted-foreground">Nome:</span> {company?.tradeName || company?.name || "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Documento:</span> {company?.document ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Celular:</span> {company?.phone ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Cliente desde:</span>{" "}
              {company ? formatDateTime(company.createdAt) : "—"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <UserIcon className="size-4 text-primary" />
            <CardTitle className="text-sm font-medium text-muted-foreground">Sua conta</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1.5 text-sm">
            <p>
              <span className="text-muted-foreground">Nome:</span> {user.name}
            </p>
            <p>
              <span className="text-muted-foreground">E-mail:</span> {user.email}
            </p>
            <p>
              <span className="text-muted-foreground">Papéis nesta empresa:</span>{" "}
              {roleNames.length ? roleNames.join(", ") : "Nenhum"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <ShieldCheckIcon className="size-4 text-primary" />
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Suas permissões nesta empresa
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sortedPermissions.length ? (
            <div className="flex flex-wrap gap-2">
              {sortedPermissions.map((key) => (
                <Badge key={key} variant="outline">
                  {PERMISSION_DESCRIPTIONS[key as PermissionKey] ?? key}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhuma permissão atribuída — fale com um administrador da sua empresa.
            </p>
          )}
        </CardContent>
      </Card>

      {canManageUsers ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <UsersIcon className="size-4 text-primary" />
              <CardTitle className="text-sm font-medium text-muted-foreground">Usuários</CardTitle>
            </div>
            <Button variant="outline" size="sm" render={<Link href="/configuracoes/usuarios" />}>
              Gerenciar
            </Button>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Liste, crie, convide, bloqueie/desbloqueie, redefina senha ou exclua usuários desta empresa.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {canManageUsers ? (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <MessageCircleIcon className="size-4 text-primary" />
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Integração WhatsApp (Evolution API)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <WhatsappConnectPanel initialHasInstance={Boolean(company?.whatsappInstanceName)} />
          </CardContent>
        </Card>
      ) : null}

      {canViewSstProviders ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BriefcaseIcon className="size-4 text-primary" />
              <CardTitle className="text-sm font-medium text-muted-foreground">Prestadores SST</CardTitle>
            </div>
            <Button variant="outline" size="sm" render={<Link href="/configuracoes/sst-providers" />}>
              {canManageSstProviders ? "Gerenciar" : "Ver"}
            </Button>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Consultorias/prestadores de SST autorizados a gerenciar treinamentos desta empresa.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
