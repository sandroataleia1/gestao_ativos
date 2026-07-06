import type { CustodyDocumentType, CustodyPhotoKind, Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/api-errors";
import { getStockRows, toNumber } from "@/lib/stock";
import { formatDateOnlyBR } from "@/lib/date-only";
import { generateQrToken } from "@/lib/qr-code";

// Funções puras (client-safe) ficam em ./badge — reexportadas aqui para
// quem importa o barrel `@/lib/custodies` a partir de código server (rotas
// de API). Client Components devem importar de `@/lib/custodies/badge`
// diretamente, nunca deste arquivo: ele importa `lib/prisma`/`lib/stock`
// (Prisma client + `next/headers` na cadeia), que quebra o bundle de
// browser se entrar na cadeia de imports de um Client Component.
export * from "./badge";

export { toNumber };

const WAREHOUSE_LOCATION_TYPE_NAME = "Almoxarifado";
const WAREHOUSE_LOCATION_NAME = "Almoxarifado Principal";
const EMPLOYEE_LOCATION_TYPE_NAME = "Colaborador";

export async function assertEmployeeBelongsToCompany(companyId: string, employeeId: string) {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId } });
  if (!employee) throw new ValidationError("Colaborador inválido.");
  return employee;
}

/**
 * Local "almoxarifado" usado como origem/destino implícito de consumíveis e
 * como destino da devolução de patrimoniados — os formulários de
 * entrega/devolução (requisitos 8/9) não têm campo de local. Cria sob
 * demanda porque empresas registradas via /register não ganham o seed de
 * local padrão (só a empresa demo tem isso).
 */
export async function getOrCreateWarehouseLocation(companyId: string) {
  const existing = await prisma.location.findFirst({
    where: { companyId, active: true, referenceId: null },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;

  const locationType =
    (await prisma.locationType.findFirst({
      where: { companyId, name: WAREHOUSE_LOCATION_TYPE_NAME },
    })) ??
    (await prisma.locationType.create({
      data: { companyId, name: WAREHOUSE_LOCATION_TYPE_NAME },
    }));

  return prisma.location.create({
    data: { companyId, name: WAREHOUSE_LOCATION_NAME, locationTypeId: locationType.id },
  });
}

/** Local que representa "em posse de X colaborador" — reaproveita o mesmo
 * campo polimórfico `Location.referenceId` já usado por outros tipos de
 * local (ver comentário do model no schema). Um por colaborador, criado na
 * primeira entrega. */
export async function getOrCreateEmployeeLocation(companyId: string, employeeId: string) {
  const existing = await prisma.location.findFirst({ where: { companyId, referenceId: employeeId } });
  if (existing) return existing;

  const [locationType, employee] = await Promise.all([
    prisma.locationType
      .findFirst({ where: { companyId, name: EMPLOYEE_LOCATION_TYPE_NAME } })
      .then(
        (found) =>
          found ??
          prisma.locationType.create({ data: { companyId, name: EMPLOYEE_LOCATION_TYPE_NAME } }),
      ),
    prisma.employee.findFirstOrThrow({ where: { id: employeeId, companyId } }),
  ]);

  return prisma.location.create({
    data: {
      companyId,
      name: employee.name,
      locationTypeId: locationType.id,
      referenceId: employeeId,
    },
  });
}

export const custodyListInclude = {
  employee: { select: { id: true, name: true, document: true } },
  asset: {
    select: { id: true, name: true, assetCode: true, trackingMode: true, defaultUnit: true },
  },
  assetUnit: { select: { id: true, serialNumber: true, patrimonyNumber: true } },
  holderLocation: { select: { id: true, name: true } },
  // Só a mais recente — hoje uma entrega nunca gera mais de uma (ver
  // app/api/custodies/deliver/route.ts), mas o `take: 1` blinda a listagem
  // caso um reenvio futuro crie uma segunda linha.
  signatureRequests: {
    select: { status: true, sentAt: true, signedAt: true },
    orderBy: { createdAt: "desc" as const },
    take: 1,
  },
} as const;

export function serializeCustody<T extends { quantity: unknown }>(custody: T) {
  return { ...custody, quantity: toNumber(custody.quantity) };
}

/**
 * Indicadores do requisito 12 — usados tanto pelo dashboard (requisito 13)
 * quanto pelos cards de resumo de /custodies.
 */
export async function getCustodyIndicators(companyId: string) {
  const now = new Date();

  const [deliveredCount, overdueCount, stockRows, topEmployeesRaw] = await Promise.all([
    prisma.assetCustody.count({ where: { companyId, status: "ACTIVE" } }),
    prisma.assetCustody.count({
      where: { companyId, status: "ACTIVE", expectedReturnAt: { lt: now } },
    }),
    getStockRows(companyId),
    prisma.assetCustody.groupBy({
      by: ["employeeId"],
      where: { companyId, status: "ACTIVE" },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 5,
    }),
  ]);

  const employees = await prisma.employee.findMany({
    where: { id: { in: topEmployeesRaw.map((row) => row.employeeId) } },
    select: { id: true, name: true },
  });
  const employeeNameById = new Map(employees.map((employee) => [employee.id, employee.name]));

  const topEmployees = topEmployeesRaw.map((row) => ({
    employeeId: row.employeeId,
    name: employeeNameById.get(row.employeeId) ?? "—",
    quantity: toNumber(row._sum.quantity ?? 0),
  }));

  return {
    deliveredCount,
    overdueCount,
    inStockAssetCount: new Set(stockRows.map((row) => row.assetId)).size,
    topEmployees,
  };
}

// ---------------------------------------------------------------------------
// Documentos e assinatura digital (termo de responsabilidade).
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTermDate(value: Date | null) {
  if (!value) return "—";
  return value.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

type CustodyForTerm = {
  quantity: unknown;
  deliveredAt: Date;
  expectedReturnAt: Date | null;
  returnedAt: Date | null;
  reason: string | null;
  notes: string | null;
  employee: { name: string; document: string };
  asset: { name: string; assetCode: string; defaultUnit: string | null };
  assetUnit: { serialNumber: string | null; patrimonyNumber: string | null } | null;
  holderLocation: { name: string };
};

type CompanyForTerm = { name: string; document: string | null };

const RESPONSIBILITIES_HTML = `
  <ul>
    <li>Zelar pela guarda, conservação e uso adequado do item recebido.</li>
    <li>Utilizar o item exclusivamente para as finalidades relacionadas às suas atividades na empresa.</li>
    <li>Comunicar imediatamente qualquer dano, defeito, perda ou furto ao setor responsável.</li>
    <li>Devolver o item quando solicitado, ao término do uso ou em caso de desligamento da empresa.</li>
    <li>Responder, nos termos da legislação aplicável, por danos causados por uso indevido ou negligência.</li>
  </ul>
`;

function describeCustodyItem(custody: CustodyForTerm) {
  const assetLabel = `${escapeHtml(custody.asset.name)} (${escapeHtml(custody.asset.assetCode)})`;
  if (custody.assetUnit) {
    const identifier =
      custody.assetUnit.serialNumber ?? custody.assetUnit.patrimonyNumber ?? "sem identificação";
    return `${assetLabel} — unidade ${escapeHtml(identifier)}`;
  }
  const unit = custody.asset.defaultUnit ? ` ${escapeHtml(custody.asset.defaultUnit)}` : "";
  return `${assetLabel} — quantidade: ${toNumber(custody.quantity)}${unit}`;
}

/**
 * Termo de responsabilidade (entrega) ou de devolução, em HTML. Requisito 5:
 * dados da empresa, colaborador, ativo, quantidade/unidade, data do evento e
 * responsabilidades do colaborador. Todo texto vindo do banco é escapado
 * (`escapeHtml`) porque este HTML é renderizado com `dangerouslySetInnerHTML`
 * na tela de visualização — sem isso, uma observação com `<script>` gravada
 * anteriormente viraria XSS armazenado.
 */
export function buildCustodyTermHtml(
  type: CustodyDocumentType,
  custody: CustodyForTerm,
  company: CompanyForTerm,
): string {
  const title = type === "DELIVERY_TERM" ? "Termo de Responsabilidade — Entrega" : "Termo de Devolução";
  const eventSection =
    type === "DELIVERY_TERM"
      ? `<p><strong>Data da entrega:</strong> ${formatTermDate(custody.deliveredAt)}</p>` +
        (custody.expectedReturnAt
          ? `<p><strong>Previsão de devolução:</strong> ${formatDateOnlyBR(custody.expectedReturnAt)}</p>`
          : "")
      : `<p><strong>Data da devolução:</strong> ${formatTermDate(custody.returnedAt)}</p>`;

  return `
<div class="custody-term">
  <h1>${title}</h1>
  <p><strong>Empresa:</strong> ${escapeHtml(company.name)}${company.document ? ` — ${escapeHtml(company.document)}` : ""}</p>
  <p><strong>Colaborador:</strong> ${escapeHtml(custody.employee.name)} — ${escapeHtml(custody.employee.document)}</p>
  <p><strong>Item:</strong> ${describeCustodyItem(custody)}</p>
  <p><strong>Local:</strong> ${escapeHtml(custody.holderLocation.name)}</p>
  ${eventSection}
  ${custody.reason ? `<p><strong>Motivo:</strong> ${escapeHtml(custody.reason)}</p>` : ""}
  ${custody.notes ? `<p><strong>Observações:</strong> ${escapeHtml(custody.notes)}</p>` : ""}
  <h2>Responsabilidades do colaborador</h2>
  ${RESPONSIBILITIES_HTML}
  <p>Declaro estar ciente e de acordo com os termos acima.</p>
</div>
  `.trim();
}

// ---------------------------------------------------------------------------
// Fotos e assinatura capturadas já no ato da entrega/devolução.
// ---------------------------------------------------------------------------

/**
 * Grava as fotos (já como data URL, comprimidas no client) tiradas na
 * entrega ou devolução — dentro da mesma transação que cria/atualiza a
 * custódia. Não faz nada se `photos` vier vazio/undefined (fotos são
 * opcionais nos dois eventos).
 */
export async function createCustodyPhotos(
  tx: Prisma.TransactionClient,
  companyId: string,
  custodyId: string,
  kind: CustodyPhotoKind,
  photos: string[] | undefined,
) {
  if (!photos?.length) return;
  await tx.custodyPhoto.createMany({
    data: photos.map((dataUrl) => ({ companyId, custodyId, kind, dataUrl })),
  });
}

/**
 * Gera o termo de entrega (sem assinatura ainda) — usado tanto pelo QR Code
 * presencial quanto pela solicitação remota via WhatsApp (ver
 * createSignatureRequest abaixo); a assinatura em si é sempre capturada
 * depois, pelo colaborador, na página pública app/assinar/[token].
 */
export async function createDeliveryTerm(
  tx: Prisma.TransactionClient,
  params: {
    companyId: string;
    custody: CustodyForTerm & { id: string };
    company: CompanyForTerm;
    generatedAt: Date;
  },
) {
  const { companyId, custody, company, generatedAt } = params;
  const contentHtml = buildCustodyTermHtml("DELIVERY_TERM", custody, company);
  return tx.custodyDocument.create({
    data: {
      companyId,
      custodyId: custody.id,
      type: "DELIVERY_TERM",
      contentHtml,
      generatedAt,
    },
  });
}

/**
 * Cria a solicitação de assinatura (token opaco de uso único) para o termo
 * já gerado — serve tanto para o QR Code presencial (`phone` nulo, o
 * colaborador só lê o QR na hora) quanto para o envio remoto via WhatsApp
 * (`phone` preenchido; o envio em si acontece fora da transação — é uma
 * chamada de rede, ver app/api/custodies/deliver/route.ts). Esta função só
 * grava o registro com status PENDING.
 */
export async function createSignatureRequest(
  tx: Prisma.TransactionClient,
  params: { companyId: string; custodyId: string; documentId: string; phone: string | null },
) {
  const { companyId, custodyId, documentId, phone } = params;
  const token = generateQrToken();
  await tx.custodySignatureRequest.create({
    data: { companyId, custodyId, documentId, phone, token },
  });
  return { token };
}
