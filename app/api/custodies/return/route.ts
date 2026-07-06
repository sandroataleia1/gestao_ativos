import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError, NotFoundError, ValidationError } from "@/lib/api-errors";
import { custodyReturnInputSchema } from "@/lib/validations/custody";
import { getMovementType } from "@/lib/stock";
import {
  createCustodyPhotos,
  custodyListInclude,
  getOrCreateWarehouseLocation,
  serializeCustody,
} from "@/lib/custodies";

const ALREADY_RETURNED_MESSAGE = "Esta custódia já foi devolvida.";

function mergeNotes(previous: string | null, addition: string | undefined) {
  if (!addition) return previous;
  return previous ? `${previous}\n\nDevolução: ${addition}` : addition;
}

// Ciclo Custódia -> Devolução -> Estoque (requisitos 5 e 6).
export async function POST(request: Request) {
  try {
    const { companyId, user } = await requirePermission(PERMISSIONS.CUSTODY_MANAGE);

    const body = await request.json();
    const input = custodyReturnInputSchema.parse(body);

    const custody = await prisma.assetCustody.findFirst({
      where: { id: input.custodyId, companyId },
      include: { asset: true, assetUnit: true },
    });
    if (!custody) throw new NotFoundError("Custódia não encontrada.");
    // Checagem rápida fora da transação — só um atalho para o caso comum
    // (sem concorrência); a garantia de verdade contra devolução duplicada
    // é o `updateMany` condicional dentro de cada transação abaixo.
    if (custody.status !== "ACTIVE") {
      throw new ValidationError(ALREADY_RETURNED_MESSAGE);
    }
    if (input.conditionId) {
      const condition = await prisma.assetCondition.findFirst({
        where: { id: input.conditionId, companyId },
        select: { id: true },
      });
      if (!condition) throw new ValidationError("Condição inválida.");
    }

    const returnedAt = input.returnedAt ?? new Date();
    const notes = mergeNotes(custody.notes, input.notes);
    const warehouse = await getOrCreateWarehouseLocation(companyId);

    if (!custody.assetUnitId) {
      // Consumível: opcionalmente retorna ao estoque.
      const updated = await prisma.$transaction(async (tx) => {
        // Atômico: só quem conseguir de fato virar ACTIVE -> RETURNED aqui
        // (count === 1) segue para creditar estoque. Uma segunda devolução
        // concorrente da mesma custódia recebe count === 0 e é rejeitada
        // antes de tocar em StockBalance — nunca credita em dobro.
        const statusFlip = await tx.assetCustody.updateMany({
          where: { id: custody.id, companyId, status: "ACTIVE" },
          data: { status: "RETURNED", returnedAt, notes },
        });
        if (statusFlip.count === 0) {
          throw new ValidationError(ALREADY_RETURNED_MESSAGE);
        }

        if (input.destination === "STOCK") {
          const movementType = await getMovementType(companyId, "ENTRY");

          await tx.stockBalance.upsert({
            where: { assetId_locationId: { assetId: custody.assetId, locationId: warehouse.id } },
            update: { quantity: { increment: custody.quantity } },
            create: {
              companyId,
              assetId: custody.assetId,
              locationId: warehouse.id,
              quantity: custody.quantity,
            },
          });

          await tx.stockMovement.create({
            data: {
              companyId,
              assetId: custody.assetId,
              movementTypeId: movementType.id,
              quantity: custody.quantity,
              originLocationId: custody.holderLocationId,
              destinationLocationId: warehouse.id,
              executedBy: user.id,
              executedAt: returnedAt,
              observations: input.notes,
            },
          });
        }

        await createCustodyPhotos(tx, companyId, custody.id, "RETURN", input.photos);

        return tx.assetCustody.findUniqueOrThrow({
          where: { id: custody.id },
          include: custodyListInclude,
        });
      });

      return NextResponse.json({ custody: serializeCustody(updated) });
    }

    // Patrimoniado: encerra a custódia e move a AssetUnit para o almoxarifado.
    const movementType = await getMovementType(companyId, "RETURN");

    const updated = await prisma.$transaction(async (tx) => {
      const statusFlip = await tx.assetCustody.updateMany({
        where: { id: custody.id, companyId, status: "ACTIVE" },
        data: { status: "RETURNED", returnedAt, notes },
      });
      if (statusFlip.count === 0) {
        throw new ValidationError(ALREADY_RETURNED_MESSAGE);
      }

      await tx.assetUnit.update({
        where: { id: custody.assetUnitId! },
        data: {
          currentCustodyId: null,
          currentLocationId: input.destination === "STOCK" ? warehouse.id : null,
          ...(input.conditionId ? { conditionId: input.conditionId } : {}),
          ...(input.destination === "DISCARD" ? { active: false, deletedAt: new Date() } : {}),
        },
      });

      await tx.assetMovement.create({
        data: {
          companyId,
          assetId: custody.assetId,
          assetUnitId: custody.assetUnitId!,
          movementTypeId: movementType.id,
          quantity: 1,
          originLocationId: custody.holderLocationId,
          destinationLocationId: input.destination === "STOCK" ? warehouse.id : null,
          custodyId: custody.id,
          executedBy: user.id,
          executedAt: returnedAt,
          observations: input.notes,
        },
      });

      await createCustodyPhotos(tx, companyId, custody.id, "RETURN", input.photos);

      return tx.assetCustody.findUniqueOrThrow({
        where: { id: custody.id },
        include: custodyListInclude,
      });
    });

    return NextResponse.json({ custody: serializeCustody(updated) });
  } catch (error) {
    return handleApiError(error);
  }
}
