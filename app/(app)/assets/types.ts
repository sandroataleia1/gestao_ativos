import type {
  Asset,
  AssetCategory,
  AssetCertification,
  AssetCondition,
  AssetStatus,
  Manufacturer,
  Supplier,
} from "@/app/generated/prisma/client";

export type LookupOption = { id: string; name: string };

export type AssetCertificationRow = AssetCertification;

export type AssetRow = Omit<
  Asset,
  "minimumStock" | "maximumStock" | "reorderPoint" | "purchasePrice" | "replacementCost"
> & {
  minimumStock: number | null;
  maximumStock: number | null;
  reorderPoint: number | null;
  purchasePrice: number | null;
  replacementCost: number | null;
  category: Pick<AssetCategory, "id" | "name">;
  manufacturer: Pick<Manufacturer, "id" | "name"> | null;
  supplier: Pick<Supplier, "id" | "corporateName"> | null;
  status: Pick<AssetStatus, "id" | "name" | "color">;
  condition: Pick<AssetCondition, "id" | "name">;
  certifications: AssetCertificationRow[];
};
