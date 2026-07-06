import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { hasPermission, requireCompany } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";

const MIN_QUERY_LENGTH = 2;
const RESULTS_PER_GROUP = 5;

// Estrutura preparatória da busca global (ver documento de UX) — cobre
// ativos, colaboradores, patrimônio/série e certificados (CA). Ainda sem
// interface (Ctrl+K); só o endpoint, para não introduzir uma dependência de
// command palette nesta etapa. Cada grupo é filtrado pela permissão de
// visualização equivalente — usuário sem uma permissão simplesmente não
// recebe aquele grupo, em vez de a busca inteira falhar com 403.
export async function GET(request: NextRequest) {
  try {
    const { companyId } = await requireCompany();

    const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
    if (query.length < MIN_QUERY_LENGTH) {
      return NextResponse.json({ query, groups: [] });
    }

    const [canViewAssets, canViewEmployees, canViewUnits] = await Promise.all([
      hasPermission(PERMISSIONS.ASSET_VIEW),
      hasPermission(PERMISSIONS.EMPLOYEE_VIEW),
      hasPermission(PERMISSIONS.ASSET_UNIT_VIEW),
    ]);

    const [assets, employees, units, certifications] = await Promise.all([
      canViewAssets
        ? prisma.asset.findMany({
            where: {
              companyId,
              active: true,
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                { assetCode: { contains: query, mode: "insensitive" } },
              ],
            },
            select: { id: true, name: true, assetCode: true },
            take: RESULTS_PER_GROUP,
            orderBy: { name: "asc" },
          })
        : [],
      canViewEmployees
        ? prisma.employee.findMany({
            where: {
              companyId,
              status: "ACTIVE",
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                { document: { contains: query, mode: "insensitive" } },
              ],
            },
            select: { id: true, name: true, document: true },
            take: RESULTS_PER_GROUP,
            orderBy: { name: "asc" },
          })
        : [],
      canViewUnits
        ? prisma.assetUnit.findMany({
            where: {
              companyId,
              active: true,
              OR: [
                { serialNumber: { contains: query, mode: "insensitive" } },
                { patrimonyNumber: { contains: query, mode: "insensitive" } },
              ],
            },
            select: {
              id: true,
              serialNumber: true,
              patrimonyNumber: true,
              assetId: true,
              asset: { select: { name: true } },
            },
            take: RESULTS_PER_GROUP,
          })
        : [],
      canViewAssets
        ? prisma.assetCertification.findMany({
            where: {
              companyId,
              certificationType: "CA",
              certificationNumber: { contains: query, mode: "insensitive" },
            },
            select: {
              id: true,
              certificationNumber: true,
              assetId: true,
              asset: { select: { name: true } },
            },
            take: RESULTS_PER_GROUP,
          })
        : [],
    ]);

    const groups = [
      {
        type: "assets",
        label: "Ativos",
        items: assets.map((asset) => ({
          id: asset.id,
          title: asset.name,
          subtitle: asset.assetCode,
          href: `/assets/${asset.id}/edit`,
        })),
      },
      {
        type: "employees",
        label: "Colaboradores",
        items: employees.map((employee) => ({
          id: employee.id,
          title: employee.name,
          subtitle: employee.document,
          href: "/employees",
        })),
      },
      {
        type: "units",
        label: "Patrimônio / Série",
        items: units.map((unit) => ({
          id: unit.id,
          title: unit.serialNumber ?? unit.patrimonyNumber ?? "—",
          subtitle: unit.asset.name,
          href: `/assets/${unit.assetId}/edit`,
        })),
      },
      {
        type: "certifications",
        label: "Certificados (CA)",
        items: certifications.map((certification) => ({
          id: certification.id,
          title: `CA ${certification.certificationNumber}`,
          subtitle: certification.asset.name,
          href: `/assets/${certification.assetId}/edit`,
        })),
      },
    ];

    return NextResponse.json({ query, groups });
  } catch (error) {
    return handleApiError(error);
  }
}
