import { describe, expect, it } from "vitest";

import { resolveNotificationAction } from "@/lib/notification-action";

// Sprint SST 1.4E, §23 — resolver de navegação (puro, sem banco). Nunca
// gera URL para um actionKey desconhecido ou fora do portal do contexto.

describe("resolveNotificationAction", () => {
  it("actionKey null nunca gera rota", () => {
    expect(resolveNotificationAction({ actionKey: null, entityType: null, entityId: null, metadata: null }, { portal: "COMPANY" })).toBeNull();
  });

  it("actionKey desconhecido nunca gera rota (nunca inventa URL)", () => {
    expect(
      resolveNotificationAction({ actionKey: "SOMETHING_MADE_UP", entityType: null, entityId: null, metadata: null }, { portal: "COMPANY" }),
    ).toBeNull();
  });

  it("COMPANY_REVIEW_SST_ACCESS resolve para a tela de prestadores, só no portal COMPANY", () => {
    const notification = { actionKey: "COMPANY_REVIEW_SST_ACCESS", entityType: "SstProviderCompany", entityId: "rel-1", metadata: null };
    expect(resolveNotificationAction(notification, { portal: "COMPANY" })).toBe("/configuracoes/sst-providers");
    expect(resolveNotificationAction(notification, { portal: "SST_PROVIDER" })).toBeNull();
    expect(resolveNotificationAction(notification, { portal: "PLATFORM" })).toBeNull();
  });

  it("SST_OPEN_COMPANY usa companyId da metadata; sem companyId cai para a listagem", () => {
    const withCompany = {
      actionKey: "SST_OPEN_COMPANY",
      entityType: "SstProviderCompany",
      entityId: "rel-1",
      metadata: { companyId: "company-123" },
    };
    expect(resolveNotificationAction(withCompany, { portal: "SST_PROVIDER" })).toBe("/sst/companies/company-123");

    const withoutCompany = { actionKey: "SST_OPEN_COMPANY", entityType: null, entityId: null, metadata: {} };
    expect(resolveNotificationAction(withoutCompany, { portal: "SST_PROVIDER" })).toBe("/sst/companies");

    expect(resolveNotificationAction(withCompany, { portal: "COMPANY" })).toBeNull();
  });

  it("SST_VIEW_RELATIONSHIP sempre resolve para a listagem, só no portal SST_PROVIDER", () => {
    const notification = { actionKey: "SST_VIEW_RELATIONSHIP", entityType: "SstProviderCompany", entityId: "rel-1", metadata: null };
    expect(resolveNotificationAction(notification, { portal: "SST_PROVIDER" })).toBe("/sst/companies");
    expect(resolveNotificationAction(notification, { portal: "PLATFORM" })).toBeNull();
  });

  it("PLATFORM_REVIEW_CLAIM usa entityId da CompanyClaimRequest quando disponível; senão cai para a listagem", () => {
    const withEntity = { actionKey: "PLATFORM_REVIEW_CLAIM", entityType: "CompanyClaimRequest", entityId: "claim-1", metadata: null };
    expect(resolveNotificationAction(withEntity, { portal: "PLATFORM" })).toBe("/platform-admin/company-claims/claim-1");

    const withoutEntity = { actionKey: "PLATFORM_REVIEW_CLAIM", entityType: null, entityId: null, metadata: null };
    expect(resolveNotificationAction(withoutEntity, { portal: "PLATFORM" })).toBe("/platform-admin/company-claims");

    expect(resolveNotificationAction(withEntity, { portal: "COMPANY" })).toBeNull();
  });

  it("PLATFORM_REVIEW_DISPUTE sempre resolve para a listagem (disputas aparecem primeiro na ordenação já existente)", () => {
    const notification = { actionKey: "PLATFORM_REVIEW_DISPUTE", entityType: "Company", entityId: "company-1", metadata: null };
    expect(resolveNotificationAction(notification, { portal: "PLATFORM" })).toBe("/platform-admin/company-claims");
    expect(resolveNotificationAction(notification, { portal: "SST_PROVIDER" })).toBeNull();
  });
});
