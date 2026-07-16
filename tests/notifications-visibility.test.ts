import { describe, expect, it } from "vitest";

import {
  getNotificationVisibilityPolicy,
  typesForAudience,
  sstTypesVisibleToRole,
  ALL_NOTIFICATION_TYPES,
} from "@/lib/notifications-visibility";

// Sprint SST 1.4E — política central de visibilidade (pura, sem banco).

describe("getNotificationVisibilityPolicy", () => {
  it("todo NotificationType tem uma política definida, com audience/severidade válidas", () => {
    for (const type of ALL_NOTIFICATION_TYPES) {
      const policy = getNotificationVisibilityPolicy(type);
      expect(["COMPANY", "SST_PROVIDER", "PLATFORM"]).toContain(policy.audience);
      expect(["INFO", "SUCCESS", "WARNING", "CRITICAL"]).toContain(policy.severity);
    }
  });

  it("tipos COMPANY exigem permissão SST_PROVIDER_MANAGE e contexto de empresa ativa", () => {
    for (const type of typesForAudience("COMPANY")) {
      const policy = getNotificationVisibilityPolicy(type);
      expect(policy.requiresActiveCompanyContext).toBe(true);
      expect(policy.requiredCompanyPermission).toBeTruthy();
    }
  });

  it("COMPANY_SST_ACCESS_REQUESTED conta como pendente via RESOLUTION; COMPANY_SST_ACCESS_REQUEST_RESOLVED nunca aparece no sino", () => {
    expect(getNotificationVisibilityPolicy("COMPANY_SST_ACCESS_REQUESTED").pendingVia).toBe("RESOLUTION");
    const resolved = getNotificationVisibilityPolicy("COMPANY_SST_ACCESS_REQUEST_RESOLVED");
    expect(resolved.appearsInBell).toBe(false);
    expect(resolved.pendingVia).toBe("READ");
  });

  it("eventos que exigem decisão (claim requested/disputed/claim started) usam RESOLUTION; os demais usam READ", () => {
    const resolutionTypes = ["COMPANY_SST_ACCESS_REQUESTED", "SST_COMPANY_CLAIM_STARTED", "PLATFORM_COMPANY_CLAIM_REQUESTED", "PLATFORM_COMPANY_CLAIM_DISPUTED"] as const;
    for (const type of resolutionTypes) {
      expect(getNotificationVisibilityPolicy(type).pendingVia).toBe("RESOLUTION");
    }
    const readTypes = ["SST_ACCESS_APPROVED", "SST_ACCESS_REJECTED", "SST_ACCESS_SUSPENDED", "SST_ACCESS_REVOKED", "SST_ACCESS_LEVEL_CHANGED", "SST_AUTHORIZATION_CONFIRMED", "SST_AUTHORIZATION_BLOCKED"] as const;
    for (const type of readTypes) {
      expect(getNotificationVisibilityPolicy(type).pendingVia).toBe("READ");
    }
  });
});

describe("sstTypesVisibleToRole — matriz OWNER/TECHNICIAN/VIEWER (§7)", () => {
  it("OWNER recebe todos os 8 tipos SST_PROVIDER", () => {
    const ownerTypes = sstTypesVisibleToRole("OWNER");
    expect(ownerTypes.sort()).toEqual([...typesForAudience("SST_PROVIDER")].sort());
  });

  it("TECHNICIAN nunca recebe SST_ACCESS_REJECTED nem SST_COMPANY_CLAIM_STARTED", () => {
    const technicianTypes = sstTypesVisibleToRole("TECHNICIAN");
    expect(technicianTypes).not.toContain("SST_ACCESS_REJECTED");
    expect(technicianTypes).not.toContain("SST_COMPANY_CLAIM_STARTED");
    expect(technicianTypes).toContain("SST_ACCESS_APPROVED");
    expect(technicianTypes).toContain("SST_ACCESS_LEVEL_CHANGED");
  });

  it("VIEWER nunca recebe SST_ACCESS_REJECTED, SST_COMPANY_CLAIM_STARTED nem SST_ACCESS_LEVEL_CHANGED", () => {
    const viewerTypes = sstTypesVisibleToRole("VIEWER");
    expect(viewerTypes).not.toContain("SST_ACCESS_REJECTED");
    expect(viewerTypes).not.toContain("SST_COMPANY_CLAIM_STARTED");
    expect(viewerTypes).not.toContain("SST_ACCESS_LEVEL_CHANGED");
    expect(viewerTypes).toContain("SST_ACCESS_APPROVED");
    expect(viewerTypes).toContain("SST_AUTHORIZATION_CONFIRMED");
  });

  it("VIEWER é sempre um subconjunto de TECHNICIAN, que é subconjunto de OWNER", () => {
    const viewerTypes = new Set(sstTypesVisibleToRole("VIEWER"));
    const technicianTypes = new Set(sstTypesVisibleToRole("TECHNICIAN"));
    const ownerTypes = new Set(sstTypesVisibleToRole("OWNER"));
    for (const t of viewerTypes) expect(technicianTypes.has(t)).toBe(true);
    for (const t of technicianTypes) expect(ownerTypes.has(t)).toBe(true);
  });
});

describe("typesForAudience", () => {
  it("nunca mistura tipos de audiências diferentes", () => {
    for (const audience of ["COMPANY", "SST_PROVIDER", "PLATFORM"] as const) {
      for (const type of typesForAudience(audience)) {
        expect(getNotificationVisibilityPolicy(type).audience).toBe(audience);
      }
    }
  });
});
