import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { AssetOption, AssetUnitOption, EmployeeOption } from "@/app/(app)/custodies/types";
import {
  buildDeliverPayload,
  buildDeliverySummary,
  getItemStepErrors,
  isEmployeeStepValid,
  isItemStepValid,
  isSignatureModeAvailable,
  shouldShowExpectedReturn,
  initialWizardValues,
} from "@/app/(app)/custodies/new/wizard-logic";

// Sprint Demo Comercial — Wizard de Nova Entrega, Parte 19. Lógica pura
// (sem React) do wizard, mesmo espírito de tests/dashboard-nav-reorganization.test.ts
// e tests/sst-companies-list.test.ts desta sessão: comportamento exportado,
// não texto renderizado frágil.

const employee: EmployeeOption = {
  id: "emp-1",
  name: "Ana Souza",
  document: "111",
  phone: "5511999999999",
  position: "Auxiliar de produção",
  department: "Montagem",
};

const employeeNoPhone: EmployeeOption = { ...employee, id: "emp-2", phone: null };

const consumableAsset: AssetOption = {
  id: "asset-1",
  name: "Luva Nitrílica",
  assetCode: "LUV-001",
  trackingMode: "CONSUMABLE",
  defaultUnit: "par",
};

const individualAsset: AssetOption = {
  id: "asset-2",
  name: "Furadeira",
  assetCode: "FRD-001",
  trackingMode: "INDIVIDUAL",
  defaultUnit: null,
};

const unit: AssetUnitOption = {
  id: "unit-1",
  assetId: "asset-2",
  serialNumber: "SN-123",
  patrimonyNumber: null,
  condition: "Boa",
};

describe("Sprint Demo Comercial — Wizard: caso 6/7 — validade da etapa 1 (colaborador)", () => {
  it("nenhum colaborador selecionado é inválido", () => {
    expect(isEmployeeStepValid(null)).toBe(false);
  });

  it("colaborador selecionado é válido", () => {
    expect(isEmployeeStepValid(employee)).toBe(true);
  });
});

describe("Sprint Demo Comercial — Wizard: caso 11/12/13/14/20 — etapa 2 (consumível e serializado)", () => {
  it("consumível: quantidade zero ou negativa é rejeitada", () => {
    const values = { ...initialWizardValues(), assetId: consumableAsset.id, quantity: "0" };
    const errors = getItemStepErrors(values, consumableAsset, { [consumableAsset.id]: 10 }, []);
    expect(errors.quantity).toBeTruthy();
    expect(isItemStepValid(values, consumableAsset, { [consumableAsset.id]: 10 }, [])).toBe(false);
  });

  it("consumível: quantidade maior que o saldo é rejeitada", () => {
    const values = { ...initialWizardValues(), assetId: consumableAsset.id, quantity: "20" };
    const errors = getItemStepErrors(values, consumableAsset, { [consumableAsset.id]: 10 }, []);
    expect(errors.quantity).toMatch(/[Ss]aldo/);
  });

  it("consumível: quantidade dentro do saldo é aceita", () => {
    const values = { ...initialWizardValues(), assetId: consumableAsset.id, quantity: "5" };
    expect(isItemStepValid(values, consumableAsset, { [consumableAsset.id]: 10 }, [])).toBe(true);
  });

  it("consumível: previsão de devolução é ocultada (não faz sentido)", () => {
    expect(shouldShowExpectedReturn(consumableAsset)).toBe(false);
  });

  it("serializado: previsão de devolução é mostrada", () => {
    expect(shouldShowExpectedReturn(individualAsset)).toBe(true);
  });

  it("serializado: unidade não selecionada é rejeitada", () => {
    const values = { ...initialWizardValues(), assetId: individualAsset.id };
    const errors = getItemStepErrors(values, individualAsset, {}, [unit]);
    expect(errors.assetUnitId).toBeTruthy();
  });

  it("serializado: unidade que não está mais disponível (ex.: ficou em custódia) é rejeitada mesmo se ainda selecionada no estado", () => {
    const values = { ...initialWizardValues(), assetId: individualAsset.id, assetUnitId: unit.id };
    // unitsForAsset vazio simula a unidade ter saído da lista de disponíveis
    // entre a seleção e a revalidação (ex.: outra aba entregou primeiro).
    const errors = getItemStepErrors(values, individualAsset, {}, []);
    expect(errors.assetUnitId).toBeTruthy();
  });

  it("serializado: unidade disponível selecionada é aceita", () => {
    const values = { ...initialWizardValues(), assetId: individualAsset.id, assetUnitId: unit.id };
    expect(isItemStepValid(values, individualAsset, {}, [unit])).toBe(true);
  });

  it("nenhum ativo selecionado é sempre inválido", () => {
    const values = initialWizardValues();
    expect(isItemStepValid(values, null, {}, [])).toBe(false);
  });
});

describe("Sprint Demo Comercial — Wizard: caso 25/27 — disponibilidade dos métodos de assinatura", () => {
  it("QR Code presencial está sempre disponível", () => {
    expect(isSignatureModeAvailable("QR", employee, false)).toBe(true);
    expect(isSignatureModeAvailable("QR", null, false)).toBe(true);
  });

  it("WhatsApp indisponível quando a empresa não configurou a integração", () => {
    expect(isSignatureModeAvailable("WHATSAPP", employee, false)).toBe(false);
  });

  it("WhatsApp indisponível quando o colaborador não tem telefone, mesmo com integração configurada", () => {
    expect(isSignatureModeAvailable("WHATSAPP", employeeNoPhone, true)).toBe(false);
  });

  it("WhatsApp disponível só quando integração configurada E colaborador tem telefone", () => {
    expect(isSignatureModeAvailable("WHATSAPP", employee, true)).toBe(true);
  });
});

describe("Sprint Demo Comercial — Wizard: caso 29/34 — payload e resumo nunca divergem", () => {
  it("payload de consumível usa quantity, nunca assetUnitId", () => {
    const values = { ...initialWizardValues(), assetId: consumableAsset.id, quantity: "3" };
    const payload = buildDeliverPayload(values, employee, consumableAsset);
    expect(payload.quantity).toBe(3);
    expect(payload.assetUnitId).toBeUndefined();
    expect(payload.employeeId).toBe(employee.id);
  });

  it("payload de serializado usa assetUnitId, nunca quantity", () => {
    const values = { ...initialWizardValues(), assetId: individualAsset.id, assetUnitId: unit.id };
    const payload = buildDeliverPayload(values, employee, individualAsset);
    expect(payload.assetUnitId).toBe(unit.id);
    expect(payload.quantity).toBeUndefined();
  });

  it("resumo mostra exatamente os mesmos dados que vão no payload (quantidade)", () => {
    const values = { ...initialWizardValues(), assetId: consumableAsset.id, quantity: "3" };
    const payload = buildDeliverPayload(values, employee, consumableAsset);
    const summary = buildDeliverySummary(values, employee, consumableAsset, []);
    expect(summary?.quantityOrSerial).toContain(String(payload.quantity));
  });

  it("resumo mostra a série exata da unidade selecionada, refletindo o assetUnitId do payload", () => {
    const values = { ...initialWizardValues(), assetId: individualAsset.id, assetUnitId: unit.id };
    const payload = buildDeliverPayload(values, employee, individualAsset);
    const summary = buildDeliverySummary(values, employee, individualAsset, [unit]);
    expect(payload.assetUnitId).toBe(unit.id);
    expect(summary?.quantityOrSerial).toContain(unit.serialNumber!);
  });

  it("sem colaborador selecionado, o resumo é null (nunca mostra dado de uma seleção anterior)", () => {
    const values = initialWizardValues();
    expect(buildDeliverySummary(values, null, null, [])).toBeNull();
  });
});

describe("Sprint Demo Comercial — Wizard: caso 39 — Portal Consultoria não foi afetado", () => {
  it("nenhum arquivo do Portal Consultoria importa os módulos novos do wizard de entrega", () => {
    const newModules = ["wizard-logic", "delivery-wizard", "step-employee", "step-item", "step-confirm"];
    const filesToCheck = ["app/sst/(portal)/dashboard/page.tsx", "app/sst/(portal)/layout.tsx"];
    for (const file of filesToCheck) {
      const source = readFileSync(file, "utf8");
      for (const moduleName of newModules) {
        expect(source).not.toContain(moduleName);
      }
    }
  });
});
