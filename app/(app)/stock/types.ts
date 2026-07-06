import type { TrackingMode } from "@/app/generated/prisma/client";

export type LookupOption = { id: string; name: string };

export type AssetOption = {
  id: string;
  name: string;
  assetCode: string;
  trackingMode: TrackingMode;
  defaultUnit: string | null;
};

export type StockRow = {
  assetId: string;
  asset: {
    id: string;
    name: string;
    assetCode: string;
    trackingMode: TrackingMode;
    defaultUnit: string | null;
    category: LookupOption;
  };
  locationId: string;
  location: LookupOption;
  quantity: number;
};

export type StockMovementRow = {
  id: string;
  kind: "STOCK" | "ASSET_UNIT";
  asset: { id: string; name: string; assetCode: string; trackingMode: TrackingMode };
  assetUnit: { id: string; serialNumber: string | null; patrimonyNumber: string | null } | null;
  movementType: LookupOption;
  quantity: number;
  originLocation: LookupOption | null;
  destinationLocation: LookupOption | null;
  observations: string | null;
  executedAt: string;
};
