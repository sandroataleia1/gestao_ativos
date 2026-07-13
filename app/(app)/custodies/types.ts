import type { TrackingMode } from "@/app/generated/prisma/client";

export type LookupOption = { id: string; name: string };

export type EmployeeOption = {
  id: string;
  name: string;
  document: string;
  phone: string | null;
  position: string | null;
  department: string | null;
};

export type AssetOption = {
  id: string;
  name: string;
  assetCode: string;
  trackingMode: TrackingMode;
  defaultUnit: string | null;
};

export type AssetUnitOption = {
  id: string;
  assetId: string;
  serialNumber: string | null;
  patrimonyNumber: string | null;
  condition: string | null;
};

/** Saldo disponível por ativo consumível no almoxarifado — Sprint Demo
 * Comercial (Wizard de Nova Entrega), Parte 4. Mesma origem de dado que a
 * própria rota de entrega usa para decrementar o estoque (StockBalance no
 * local de almoxarifado), então o saldo mostrado nunca diverge da regra
 * real de bloqueio. */
export type AssetBalanceMap = Record<string, number>;

export type CustodyRow = {
  id: string;
  employeeId: string;
  employee: { id: string; name: string; document: string };
  assetId: string;
  asset: {
    id: string;
    name: string;
    assetCode: string;
    trackingMode: TrackingMode;
    defaultUnit: string | null;
  };
  assetUnitId: string | null;
  assetUnit: { id: string; serialNumber: string | null; patrimonyNumber: string | null } | null;
  holderLocationId: string;
  holderLocation: { id: string; name: string };
  quantity: number;
  status: "ACTIVE" | "RETURNED";
  deliveredAt: string;
  expectedReturnAt: string | null;
  returnedAt: string | null;
  reason: string | null;
  notes: string | null;
  signatureRequest: SignatureRequestRow | null;
};

export type SignatureRequestStatus = "PENDING" | "SENT" | "SIGNED";

export type SignatureRequestRow = {
  status: SignatureRequestStatus;
  sentAt: string | null;
  signedAt: string | null;
};

export type CustodyIndicators = {
  deliveredCount: number;
  overdueCount: number;
  inStockAssetCount: number;
  topEmployees: { employeeId: string; name: string; quantity: number }[];
};

export type CustodyDocumentType = "DELIVERY_TERM" | "RETURN_TERM";

export type CustodySignatureRow = {
  id: string;
  signerName: string;
  signerDocument: string;
  signatureImageUrl: string | null;
  signatureData: string | null;
  signedAt: string;
};

export type CustodyDocumentRow = {
  id: string;
  type: CustodyDocumentType;
  contentHtml: string;
  pdfUrl: string | null;
  generatedAt: string;
  createdAt: string;
  signatures: CustodySignatureRow[];
};

export type CustodyPhotoKind = "DELIVERY" | "RETURN";

export type CustodyPhotoRow = {
  id: string;
  kind: CustodyPhotoKind;
  dataUrl: string;
  createdAt: string;
};
