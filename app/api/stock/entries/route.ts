import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError, ValidationError } from "@/lib/api-errors";
import { stockEntryInputSchema } from "@/lib/validations/stock";
import {
  assertAssetBelongsToCompany,
  assertLocationBelongsToCompany,
  assertStatusAndConditionBelongToCompany,
  getMovementType,
  toNumber,
} from "@/lib/stock";
import { getDefaultWarehouseLocationId } from "@/lib/stock-setup-provisioning";
import { invalidateCompanyData } from "@/lib/cache";

// Entrada de estoque. O `trackingMode` real do Asset (nunca o que o client
// diz que é) decide o caminho:
//   - CONSUMABLE: incrementa StockBalance + registra StockMovement (a
//     tabela StockMovement é "usada apenas para trackingMode = CONSUMABLE",
//     conforme o próprio comentário do model no schema).
//   - INDIVIDUAL: cria um AssetUnit por número de série/patrimônio e
//     registra AssetMovement para cada um (StockMovement não se aplica a
//     ativos rastreados individualmente).
export async function POST(request: Request) {
  try {
    const { companyId, user } = await requirePermission(PERMISSIONS.STOCK_MANAGE);

    const body = await request.json();
    const input = stockEntryInputSchema.parse(body);

    const asset = await assertAssetBelongsToCompany(companyId, input.assetId);

    // A UI não deixa mais escolher local (entrada sempre vai pro
    // almoxarifado principal da empresa) — locationId só chega no payload
    // se algum caller explícito informar, e nesse caso ainda validamos que
    // pertence à empresa.
    let locationId: string;
    if (input.locationId) {
      await assertLocationBelongsToCompany(companyId, input.locationId);
      locationId = input.locationId;
    } else {
      locationId = await getDefaultWarehouseLocationId(companyId);
    }

    const executedAt = input.executedAt ?? new Date();
    const movementType = await getMovementType(companyId, "ENTRY");

    if (asset.trackingMode === "CONSUMABLE") {
      if (!input.quantity) {
        throw new ValidationError("Informe a quantidade.");
      }

      const result = await prisma.$transaction(async (tx) => {
        const balance = await tx.stockBalance.upsert({
          where: { assetId_locationId: { assetId: asset.id, locationId } },
          update: { quantity: { increment: input.quantity! } },
          create: {
            companyId,
            assetId: asset.id,
            locationId,
            quantity: input.quantity!,
          },
        });

        const movement = await tx.stockMovement.create({
          data: {
            companyId,
            assetId: asset.id,
            movementTypeId: movementType.id,
            quantity: input.quantity!,
            destinationLocationId: locationId,
            executedBy: user.id,
            executedAt,
            observations: input.observations,
          },
        });

        return { balance, movement };
      });

      invalidateCompanyData(companyId, ["dashboard", "stock"]);
      return NextResponse.json(
        {
          balance: { ...result.balance, quantity: toNumber(result.balance.quantity) },
          movement: { ...result.movement, quantity: toNumber(result.movement.quantity) },
        },
        { status: 201 },
      );
    }

    // INDIVIDUAL — cada linha da lista vira um AssetUnit.
    const rawSerialNumbers = (input.serialNumbers ?? []).map((s) => s.trim()).filter(Boolean);
    const serialNumbers = [...new Set(rawSerialNumbers)];
    if (serialNumbers.length === 0) {
      throw new ValidationError("Informe ao menos um número de série/patrimônio.");
    }
    if (serialNumbers.length !== rawSerialNumbers.length) {
      throw new ValidationError("Há números de série/patrimônio repetidos na lista.");
    }
    if (!input.statusId || !input.conditionId) {
      throw new ValidationError("Selecione status e condição para as novas unidades.");
    }
    await assertStatusAndConditionBelongToCompany(companyId, input.statusId, input.conditionId);

    const existingUnits = await prisma.assetUnit.findMany({
      where: { companyId, serialNumber: { in: serialNumbers } },
      select: { serialNumber: true },
    });
    if (existingUnits.length > 0) {
      throw new ValidationError(
        `Número(s) de série já cadastrado(s) nesta empresa: ${existingUnits
          .map((u) => u.serialNumber)
          .join(", ")}`,
      );
    }

    const units = await prisma.$transaction(async (tx) => {
      const created = [];
      for (const serialNumber of serialNumbers) {
        const unit = await tx.assetUnit.create({
          data: {
            companyId,
            assetId: asset.id,
            serialNumber,
            statusId: input.statusId!,
            conditionId: input.conditionId!,
            currentLocationId: locationId,
          },
        });
        await tx.assetMovement.create({
          data: {
            companyId,
            assetId: asset.id,
            assetUnitId: unit.id,
            movementTypeId: movementType.id,
            quantity: 1,
            destinationLocationId: locationId,
            executedBy: user.id,
            executedAt,
            observations: input.observations,
          },
        });
        created.push(unit);
      }
      return created;
    });

    invalidateCompanyData(companyId, ["dashboard", "stock"]);
    return NextResponse.json({ units }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
