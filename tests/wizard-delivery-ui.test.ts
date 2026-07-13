import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { custodyDeliverInputSchema } from "@/lib/validations/custody";

// Sprint Demo Comercial — Wizard de Nova Entrega, Parte 19 — casos de
// fotos (21/24) via o schema Zod real (mesmo usado pela API, nunca
// duplicado) e casos de acessibilidade (Parte 17) via checagem de fonte,
// no mesmo espírito de tests/dashboard-nav-reorganization.test.ts.

describe("Sprint Demo Comercial — Wizard: caso 21 — limite máximo de fotos é respeitado pelo schema real", () => {
  const basePayload = { employeeId: "emp-1", assetId: "asset-1", quantity: 1 };

  it("aceita até 5 fotos", () => {
    const result = custodyDeliverInputSchema.safeParse({ ...basePayload, photos: Array(5).fill("data:image/jpeg;base64,abc") });
    expect(result.success).toBe(true);
  });

  it("rejeita a 6ª foto", () => {
    const result = custodyDeliverInputSchema.safeParse({ ...basePayload, photos: Array(6).fill("data:image/jpeg;base64,abc") });
    expect(result.success).toBe(false);
  });
});

describe("Sprint Demo Comercial — Wizard: caso 17 — acessibilidade do stepper e das etapas", () => {
  it("Stepper usa aria-current=\"step\" na etapa atual, nunca só cor", () => {
    const source = readFileSync("components/ui/stepper.tsx", "utf8");
    expect(source).toContain('aria-current={step.status === "current" ? "step" : undefined}');
    // Cada etapa também tem um rótulo textual de status (Concluída/Etapa
    // atual/Bloqueada/Pendente), não só a cor do círculo.
    expect(source).toContain('"Concluída"');
    expect(source).toContain('"Etapa atual"');
  });

  it("etapas bloqueadas ficam com aria-disabled quando não são clicáveis", () => {
    const source = readFileSync("components/ui/stepper.tsx", "utf8");
    expect(source).toContain('aria-disabled={step.status === "blocked" || undefined}');
  });

  it("o wizard move o foco para o título ao trocar de etapa", () => {
    const source = readFileSync("app/(app)/custodies/new/delivery-wizard.tsx", "utf8");
    expect(source).toContain("stepHeadingRef.current?.focus()");
  });

  it("o campo de quantidade recebe foco quando a etapa 2 é inválida ao tentar continuar", () => {
    const source = readFileSync("app/(app)/custodies/new/delivery-wizard.tsx", "utf8");
    expect(source).toContain("quantityFieldRef.current?.focus()");
  });

  it("mensagens de erro de campo usam aria-describedby, ligando o campo ao texto de erro", () => {
    const source = readFileSync("app/(app)/custodies/new/step-item.tsx", "utf8");
    expect(source).toContain("aria-describedby");
    expect(source).toContain("wizard-quantity-error");
  });
});

describe("Sprint Demo Comercial — Wizard: caso 26/27 — método de assinatura chega corretamente e WhatsApp indisponível não quebra", () => {
  it("o payload sempre inclui signatureDelivery com o modo selecionado", () => {
    const result = custodyDeliverInputSchema.safeParse({
      employeeId: "emp-1",
      assetId: "asset-1",
      quantity: 1,
      signatureDelivery: "WHATSAPP",
    });
    expect(result.success).toBe(true);
  });

  it("StepConfirm desabilita a opção indisponível com uma explicação, em vez de deixar escolher e falhar só depois", () => {
    const source = readFileSync("app/(app)/custodies/new/step-confirm.tsx", "utf8");
    expect(source).toContain("disabled={!available || isSubmitting}");
    expect(source).toContain("Integração de WhatsApp não configurada");
    expect(source).toContain("Colaborador não tem WhatsApp cadastrado.");
  });
});
