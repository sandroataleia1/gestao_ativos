import { NextResponse } from "next/server";

import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError, ValidationError } from "@/lib/api-errors";
import { logAudit } from "@/lib/audit";
import { invalidateCompanyData } from "@/lib/cache";
import { custodyDeliverInputSchema } from "@/lib/validations/custody";
import { assertAssetBelongsToCompany, getMovementType } from "@/lib/stock";
import { normalizeWhatsAppPhone, sendWhatsAppMessage } from "@/lib/evolution-api";
import {
  assertEmployeeBelongsToCompany,
  createCustodyPhotos,
  createDeliveryTerm,
  createSignatureRequest,
  custodyListInclude,
  getOrCreateEmployeeLocation,
  getOrCreateWarehouseLocation,
  serializeCustody,
} from "@/lib/custodies";

const DOUBLE_CUSTODY_MESSAGE = "Esta unidade já está em custódia de outro colaborador.";

type CompanyForWhatsApp = {
  name: string;
  whatsappApiUrl: string | null;
  whatsappApiKey: string | null;
  whatsappInstanceName: string | null;
} | null;

function buildSignUrl(token: string) {
  return `${process.env.BETTER_AUTH_URL}/assinar/${token}`;
}

/**
 * Envia o link de assinatura por WhatsApp fora da transação (é uma chamada
 * de rede) depois que a entrega já foi criada com sucesso — uma falha aqui
 * nunca desfaz a entrega, só devolve um aviso pro client mostrar. Não faz
 * nada quando o modo escolhido foi "QR" (presencial): nesse caso o token já
 * volta pronto na resposta para o client montar o QR Code, sem envio nenhum
 * daqui.
 */
async function deliverSignatureRequestByWhatsApp(params: {
  token: string | null;
  phone: string | null;
  company: CompanyForWhatsApp;
  employeeName: string;
  assetName: string;
}): Promise<string | undefined> {
  const { token, phone, company, employeeName, assetName } = params;
  if (!token || !phone || !company?.whatsappApiUrl || !company.whatsappApiKey || !company.whatsappInstanceName) {
    return undefined;
  }

  const signUrl = buildSignUrl(token);
  const message =
    `Olá, ${employeeName}! Você recebeu o ativo "${assetName}" via ${company.name}. ` +
    `Assine o termo de responsabilidade pelo link: ${signUrl}`;

  const result = await sendWhatsAppMessage(
    {
      baseUrl: company.whatsappApiUrl,
      apiKey: company.whatsappApiKey,
      instanceName: company.whatsappInstanceName,
    },
    phone,
    message,
  );

  if (result.ok) {
    await prisma.custodySignatureRequest.update({
      where: { token },
      data: { status: "SENT", sentAt: new Date() },
    });
    return undefined;
  }

  return `Entrega registrada, mas o envio por WhatsApp falhou (${result.error}). Você pode reenviar pelos Documentos da custódia depois.`;
}

// Ciclo Estoque -> Entrega -> Custódia (requisitos 4 e 6). O `trackingMode`
// real do Asset (nunca o que o client diz) decide o caminho:
//   - CONSUMABLE: reduz StockBalance do almoxarifado + StockMovement EXIT.
//   - INDIVIDUAL: muda a localização da AssetUnit escolhida para o
//     colaborador + AssetMovement DELIVERY.
// Em ambos os casos, cria um AssetCustody novo (nunca reaproveita um
// existente) e nunca aceita companyId do client.
export async function POST(request: Request) {
  try {
    const { companyId, user } = await requirePermission(PERMISSIONS.CUSTODY_MANAGE);

    const body = await request.json();
    const input = custodyDeliverInputSchema.parse(body);

    const employee = await assertEmployeeBelongsToCompany(companyId, input.employeeId);
    const asset = await assertAssetBelongsToCompany(companyId, input.assetId);
    const deliveredAt = input.deliveredAt ?? new Date();
    const employeeLocation = await getOrCreateEmployeeLocation(companyId, employee.id);

    // Só busca a empresa se realmente for gerar o termo (QR presencial ou
    // WhatsApp) — nas entregas sem `signatureDelivery`, evita a consulta à
    // toa.
    const company = input.signatureDelivery
      ? await prisma.company.findUniqueOrThrow({
          where: { id: companyId },
          select: {
            name: true,
            document: true,
            tradeName: true,
            address: true,
            city: true,
            state: true,
            zipCode: true,
            phone: true,
            email: true,
            responsibleName: true,
            logoDataUrl: true,
            whatsappApiUrl: true,
            whatsappApiKey: true,
            whatsappInstanceName: true,
          },
        })
      : null;

    let whatsappPhone: string | null = null;
    if (input.signatureDelivery === "WHATSAPP") {
      whatsappPhone = employee.phone ? normalizeWhatsAppPhone(employee.phone) : null;
      if (!whatsappPhone) {
        throw new ValidationError("Colaborador não tem WhatsApp cadastrado.");
      }
      if (!company?.whatsappApiUrl || !company.whatsappApiKey || !company.whatsappInstanceName) {
        throw new ValidationError("Configure a integração de WhatsApp em Configurações antes de enviar.");
      }
    }

    if (asset.trackingMode === "CONSUMABLE") {
      if (!input.quantity) {
        throw new ValidationError("Informe a quantidade.");
      }

      const warehouse = await getOrCreateWarehouseLocation(companyId);
      const movementType = await getMovementType(companyId, "EXIT");

      const { custody, signatureRequestToken } = await prisma.$transaction(async (tx) => {
        // Decremento condicional e atômico: a condição `quantity >= X` faz
        // parte do próprio UPDATE, então o Postgres serializa duas
        // entregas concorrentes do mesmo consumível (a segunda só enxerga o
        // saldo já decrementado pela primeira ao reavaliar o WHERE) — nunca
        // permite saldo negativo, sem precisar de SELECT FOR UPDATE
        // explícito.
        const decremented = await tx.stockBalance.updateMany({
          where: {
            assetId: asset.id,
            locationId: warehouse.id,
            quantity: { gte: input.quantity! },
          },
          data: { quantity: { decrement: input.quantity! } },
        });
        if (decremented.count === 0) {
          throw new ValidationError("Estoque insuficiente para esta entrega.");
        }

        await tx.stockMovement.create({
          data: {
            companyId,
            assetId: asset.id,
            movementTypeId: movementType.id,
            quantity: input.quantity!,
            originLocationId: warehouse.id,
            destinationLocationId: employeeLocation.id,
            executedBy: user.id,
            executedAt: deliveredAt,
            observations: input.notes,
          },
        });

        const created = await tx.assetCustody.create({
          data: {
            companyId,
            employeeId: employee.id,
            assetId: asset.id,
            holderLocationId: employeeLocation.id,
            quantity: input.quantity!,
            deliveredAt,
            expectedReturnAt: input.expectedReturnAt,
            reason: input.reason,
            notes: input.notes,
            createdBy: user.id,
          },
          include: custodyListInclude,
        });

        await createCustodyPhotos(tx, companyId, created.id, "DELIVERY", input.photos);
        let signatureRequestToken: string | null = null;
        if (input.signatureDelivery) {
          const document = await createDeliveryTerm(tx, {
            companyId,
            custody: created,
            company: company!,
            generatedAt: deliveredAt,
          });
          const signatureRequest = await createSignatureRequest(tx, {
            companyId,
            custodyId: created.id,
            documentId: document.id,
            phone: whatsappPhone,
          });
          signatureRequestToken = signatureRequest.token;
        }

        await logAudit(tx, {
          companyId,
          actorUserId: user.id,
          actorName: user.name,
          action: "custody.deliver",
          targetType: "AssetCustody",
          targetId: created.id,
          metadata: { employeeId: employee.id, assetId: asset.id, quantity: input.quantity },
        });

        return { custody: created, signatureRequestToken };
      });

      const whatsappWarning = await deliverSignatureRequestByWhatsApp({
        token: signatureRequestToken,
        phone: whatsappPhone,
        company,
        employeeName: employee.name,
        assetName: asset.name,
      });

      invalidateCompanyData(companyId, ["dashboard", "stock"]);

      return NextResponse.json(
        {
          custody: serializeCustody(custody),
          whatsappWarning,
          signUrl: signatureRequestToken ? buildSignUrl(signatureRequestToken) : undefined,
        },
        { status: 201 },
      );
    }

    // INDIVIDUAL — entrega uma AssetUnit específica.
    if (!input.assetUnitId) {
      throw new ValidationError("Selecione uma unidade para entregar.");
    }

    const unit = await prisma.assetUnit.findFirst({
      where: { id: input.assetUnitId, companyId, assetId: asset.id },
    });
    if (!unit || !unit.active) {
      throw new ValidationError("Unidade inválida.");
    }
    if (unit.currentCustodyId) {
      throw new ValidationError(DOUBLE_CUSTODY_MESSAGE);
    }

    const movementType = await getMovementType(companyId, "DELIVERY");

    const { custody, signatureRequestToken } = await prisma.$transaction(async (tx) => {
      const activeCustody = await tx.assetCustody.findFirst({
        where: { companyId, assetUnitId: unit.id, status: "ACTIVE" },
        select: { id: true },
      });
      if (activeCustody) {
        throw new ValidationError(DOUBLE_CUSTODY_MESSAGE);
      }

      const created = await tx.assetCustody.create({
        data: {
          companyId,
          employeeId: employee.id,
          assetId: asset.id,
          assetUnitId: unit.id,
          holderLocationId: employeeLocation.id,
          quantity: 1,
          deliveredAt,
          expectedReturnAt: input.expectedReturnAt,
          reason: input.reason,
          notes: input.notes,
          createdBy: user.id,
        },
        include: custodyListInclude,
      });

      await tx.assetUnit.update({
        where: { id: unit.id },
        data: { currentLocationId: employeeLocation.id, currentCustodyId: created.id },
      });

      await tx.assetMovement.create({
        data: {
          companyId,
          assetId: asset.id,
          assetUnitId: unit.id,
          movementTypeId: movementType.id,
          quantity: 1,
          originLocationId: unit.currentLocationId,
          destinationLocationId: employeeLocation.id,
          custodyId: created.id,
          executedBy: user.id,
          executedAt: deliveredAt,
          observations: input.notes,
        },
      });

      await createCustodyPhotos(tx, companyId, created.id, "DELIVERY", input.photos);
      let signatureRequestToken: string | null = null;
      if (input.signatureDelivery) {
        const document = await createDeliveryTerm(tx, {
          companyId,
          custody: created,
          company: company!,
          generatedAt: deliveredAt,
        });
        const signatureRequest = await createSignatureRequest(tx, {
          companyId,
          custodyId: created.id,
          documentId: document.id,
          phone: whatsappPhone,
        });
        signatureRequestToken = signatureRequest.token;
      }

      await logAudit(tx, {
        companyId,
        actorUserId: user.id,
        actorName: user.name,
        action: "custody.deliver",
        targetType: "AssetCustody",
        targetId: created.id,
        metadata: { employeeId: employee.id, assetId: asset.id, assetUnitId: unit.id },
      });

      return { custody: created, signatureRequestToken };
    });

    const whatsappWarning = await deliverSignatureRequestByWhatsApp({
      token: signatureRequestToken,
      phone: whatsappPhone,
      company,
      employeeName: employee.name,
      assetName: asset.name,
    });

    invalidateCompanyData(companyId, ["dashboard", "stock"]);

    return NextResponse.json(
      {
        custody: serializeCustody(custody),
        whatsappWarning,
        signUrl: signatureRequestToken ? buildSignUrl(signatureRequestToken) : undefined,
      },
      { status: 201 },
    );
  } catch (error) {
    // Cinturão de segurança: se duas entregas concorrentes passarem pelas
    // checagens de aplicação acima, o índice único parcial
    // `AssetCustody_active_assetUnit_unique` (migration
    // 20260703191056_custody_active_unit_unique) rejeita a segunda a nível
    // de banco — convertido aqui na mesma mensagem amigável, em vez do 409
    // genérico de `handleApiError`.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return handleApiError(new ValidationError(DOUBLE_CUSTODY_MESSAGE));
    }
    return handleApiError(error);
  }
}
