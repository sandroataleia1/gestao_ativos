import { describe, expect, it } from "vitest";

import { pluralize } from "@/lib/plural";

describe("Sprint Demo Comercial SST 1.3 — pluralize", () => {
  it("usa a forma plural para zero", () => {
    expect(pluralize(0, "colaborador ativo", "colaboradores ativos")).toBe("0 colaboradores ativos");
  });

  it("usa a forma singular para exatamente 1", () => {
    expect(pluralize(1, "colaborador ativo", "colaboradores ativos")).toBe("1 colaborador ativo");
  });

  it("usa a forma plural para mais de 1", () => {
    expect(pluralize(4, "colaborador ativo", "colaboradores ativos")).toBe("4 colaboradores ativos");
  });

  it("funciona para treinamento singular e plural", () => {
    expect(pluralize(1, "treinamento", "treinamentos")).toBe("1 treinamento");
    expect(pluralize(2, "treinamento", "treinamentos")).toBe("2 treinamentos");
  });

  it("funciona para turma agendada singular e plural", () => {
    expect(pluralize(1, "turma agendada", "turmas agendadas")).toBe("1 turma agendada");
    expect(pluralize(3, "turma agendada", "turmas agendadas")).toBe("3 turmas agendadas");
  });

  it("funciona para empresa encontrada singular e plural", () => {
    expect(pluralize(1, "empresa encontrada", "empresas encontradas")).toBe("1 empresa encontrada");
    expect(pluralize(6, "empresa encontrada", "empresas encontradas")).toBe("6 empresas encontradas");
  });
});
