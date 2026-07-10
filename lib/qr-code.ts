import { randomBytes } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/api-errors";
import { getCurrentUser, hasPermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { toNumber } from "@/lib/stock";

// Todo endpoint deste módulo nunca expõe o `id` (cuid) interno como
// identificador público — o token é um valor opaco e imprevisível separado
// (ver comentário nos models Asset/AssetUnit/AssetCustody), gerado aqui.
export function generateQrToken(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * "Gerar QR Code" é idempotente: se o recurso já tem um token, devolve o
 * mesmo (nunca troca) — uma etiqueta física já impressa/colada no ativo
 * continua apontando para o mesmo lugar depois de cliques repetidos no
 * botão "Gerar QR Code".
 */
export async function getOrCreateAssetQrToken(companyId: string, assetId: string) {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, companyId },
    select: { id: true, qrCodeToken: true },
  });
  if (!asset) throw new NotFoundError("Ativo não encontrado.");
  if (asset.qrCodeToken) return asset.qrCodeToken;

  const token = generateQrToken();
  await prisma.asset.update({ where: { id: asset.id }, data: { qrCodeToken: token } });
  return token;
}

export async function getOrCreateAssetUnitQrToken(companyId: string, assetUnitId: string) {
  const unit = await prisma.assetUnit.findFirst({
    where: { id: assetUnitId, companyId },
    select: { id: true, qrCodeToken: true },
  });
  if (!unit) throw new NotFoundError("Unidade não encontrada.");
  if (unit.qrCodeToken) return unit.qrCodeToken;

  const token = generateQrToken();
  await prisma.assetUnit.update({ where: { id: unit.id }, data: { qrCodeToken: token } });
  return token;
}

export async function getOrCreateCustodyQrToken(companyId: string, custodyId: string) {
  const custody = await prisma.assetCustody.findFirst({
    where: { id: custodyId, companyId },
    select: { id: true, qrCodeToken: true },
  });
  if (!custody) throw new NotFoundError("Custódia não encontrada.");
  if (custody.qrCodeToken) return custody.qrCodeToken;

  const token = generateQrToken();
  await prisma.assetCustody.update({ where: { id: custody.id }, data: { qrCodeToken: token } });
  return token;
}

export type QrResourceType = "ASSET" | "ASSET_UNIT" | "CUSTODY";

export type QrLookup =
  | {
      type: "ASSET";
      companyId: string;
      companyName: string;
      companyLogoDataUrl: string | null;
      status: string;
      resource: {
        id: string;
        name: string;
        assetCode: string;
        categoryName: string;
        statusName: string;
        conditionName: string;
        trackingMode: string;
        active: boolean;
      };
    }
  | {
      type: "ASSET_UNIT";
      companyId: string;
      companyName: string;
      companyLogoDataUrl: string | null;
      status: string;
      resource: {
        id: string;
        assetId: string;
        assetName: string;
        assetCode: string;
        serialNumber: string | null;
        patrimonyNumber: string | null;
        statusName: string;
        conditionName: string;
        currentLocationName: string | null;
        active: boolean;
      };
    }
  | {
      type: "CUSTODY";
      companyId: string;
      companyName: string;
      companyLogoDataUrl: string | null;
      status: string;
      resource: {
        id: string;
        assetId: string;
        assetName: string;
        assetCode: string;
        assetUnitId: string | null;
        employeeName: string;
        quantity: number;
        defaultUnit: string | null;
        unitLabel: string | null;
        deliveredAt: string;
        expectedReturnAt: string | null;
        returnedAt: string | null;
        documents: { id: string; type: string; generatedAt: string; signed: boolean }[];
      };
    };

/**
 * Único ponto de entrada para "achar o que esse QR Code representa" — tenta
 * as três tabelas que podem ter gerado o token (Asset, AssetUnit,
 * AssetCustody). Nunca filtra por companyId aqui: quem escaneia o QR pode
 * não estar logado em empresa nenhuma — a redução de acesso por tenant é
 * decidida depois, em `computeQrPermissions`, a partir da sessão atual.
 */
export async function resolveQrToken(token: string): Promise<QrLookup | null> {
  const asset = await prisma.asset.findUnique({
    where: { qrCodeToken: token },
    include: { company: { select: { name: true, logoDataUrl: true } }, category: true, status: true, condition: true },
  });
  if (asset) {
    return {
      type: "ASSET",
      companyId: asset.companyId,
      companyName: asset.company.name,
      companyLogoDataUrl: asset.company.logoDataUrl,
      status: asset.active ? asset.status.name : "Inativo",
      resource: {
        id: asset.id,
        name: asset.name,
        assetCode: asset.assetCode,
        categoryName: asset.category.name,
        statusName: asset.status.name,
        conditionName: asset.condition.name,
        trackingMode: asset.trackingMode,
        active: asset.active,
      },
    };
  }

  const unit = await prisma.assetUnit.findUnique({
    where: { qrCodeToken: token },
    include: {
      company: { select: { name: true, logoDataUrl: true } },
      asset: { select: { id: true, name: true, assetCode: true } },
      status: true,
      condition: true,
      currentLocation: { select: { name: true } },
    },
  });
  if (unit) {
    return {
      type: "ASSET_UNIT",
      companyId: unit.companyId,
      companyName: unit.company.name,
      companyLogoDataUrl: unit.company.logoDataUrl,
      status: unit.active ? unit.status.name : "Inativo",
      resource: {
        id: unit.id,
        assetId: unit.asset.id,
        assetName: unit.asset.name,
        assetCode: unit.asset.assetCode,
        serialNumber: unit.serialNumber,
        patrimonyNumber: unit.patrimonyNumber,
        statusName: unit.status.name,
        conditionName: unit.condition.name,
        currentLocationName: unit.currentLocation?.name ?? null,
        active: unit.active,
      },
    };
  }

  const custody = await prisma.assetCustody.findUnique({
    where: { qrCodeToken: token },
    include: {
      company: { select: { name: true, logoDataUrl: true } },
      employee: { select: { name: true } },
      asset: { select: { id: true, name: true, assetCode: true, defaultUnit: true } },
      assetUnit: { select: { serialNumber: true, patrimonyNumber: true } },
      documents: {
        include: { signatures: { select: { id: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (custody) {
    return {
      type: "CUSTODY",
      companyId: custody.companyId,
      companyName: custody.company.name,
      companyLogoDataUrl: custody.company.logoDataUrl,
      status: custody.status === "ACTIVE" ? "Em posse do colaborador" : "Devolvida",
      resource: {
        id: custody.id,
        assetId: custody.assetId,
        assetName: custody.asset.name,
        assetCode: custody.asset.assetCode,
        assetUnitId: custody.assetUnitId,
        employeeName: custody.employee.name,
        quantity: toNumber(custody.quantity),
        defaultUnit: custody.asset.defaultUnit,
        unitLabel: custody.assetUnit
          ? (custody.assetUnit.serialNumber ?? custody.assetUnit.patrimonyNumber)
          : null,
        deliveredAt: custody.deliveredAt.toISOString(),
        expectedReturnAt: custody.expectedReturnAt ? custody.expectedReturnAt.toISOString() : null,
        returnedAt: custody.returnedAt ? custody.returnedAt.toISOString() : null,
        documents: custody.documents.map((document) => ({
          id: document.id,
          type: document.type,
          generatedAt: document.generatedAt.toISOString(),
          signed: document.signatures.length > 0,
        })),
      },
    };
  }

  return null;
}

export type QrPermissions = {
  authenticated: boolean;
  sameCompany: boolean;
  canView: boolean;
  canManage: boolean;
};

const VIEW_PERMISSION_BY_TYPE: Record<QrResourceType, string> = {
  ASSET: PERMISSIONS.ASSET_VIEW,
  ASSET_UNIT: PERMISSIONS.ASSET_UNIT_VIEW,
  CUSTODY: PERMISSIONS.CUSTODY_VIEW,
};

const MANAGE_PERMISSION_BY_TYPE: Record<QrResourceType, string> = {
  ASSET: PERMISSIONS.ASSET_MANAGE,
  ASSET_UNIT: PERMISSIONS.ASSET_UNIT_MANAGE,
  CUSTODY: PERMISSIONS.CUSTODY_MANAGE,
};

/**
 * O QR em si nunca autentica ninguém — só aponta para `/q/[token]`. As
 * permissões "aplicáveis" (requisito 4) dependem inteiramente da sessão de
 * quem está olhando agora: sem sessão, ou sessão de outra empresa, tudo cai
 * para `false` (mesmos dados básicos e públicos de qualquer visitante,
 * nunca dados de outra empresa por engano).
 */
export async function computeQrPermissions(lookup: QrLookup): Promise<QrPermissions> {
  const user = await getCurrentUser();
  if (!user || user.companyId !== lookup.companyId) {
    return { authenticated: Boolean(user), sameCompany: false, canView: false, canManage: false };
  }

  const [canView, canManage] = await Promise.all([
    hasPermission(VIEW_PERMISSION_BY_TYPE[lookup.type]),
    hasPermission(MANAGE_PERMISSION_BY_TYPE[lookup.type]),
  ]);

  return { authenticated: true, sameCompany: true, canView, canManage };
}
