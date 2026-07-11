import { describe, expect, it } from "vitest";

import { trainingClassInputSchema } from "@/lib/validations/training-class";

// Regressão encontrada na validação manual da Sprint Demo Comercial SST
// 1.0: o fluxo de "Cancelar turma" (SST e Portal Empresa) reenvia os campos
// opcionais exatamente como o Prisma os devolve — `string | null`, nunca
// `undefined` — mas o schema só tratava string vazia como "vazio",
// rejeitando `null` com 400 ("Invalid input: expected string, received
// null") e fazendo o cancelamento falhar silenciosamente (toast de erro
// genérico, nenhuma mudança de status). Ver lib/validations/training-class.ts.
describe("trainingClassInputSchema — campos opcionais nulos (bug de cancelamento)", () => {
  const baseInput = {
    companyTrainingId: "training-1",
    title: "Turma de teste",
    startsAt: new Date().toISOString(),
    status: "CANCELLED" as const,
  };

  it("aceita null nos campos opcionais de texto (location/instrutores/notes), como o Prisma devolve para colunas vazias", () => {
    const result = trainingClassInputSchema.safeParse({
      ...baseInput,
      endsAt: null,
      location: null,
      internalInstructor: null,
      externalInstructor: null,
      maximumParticipants: null,
      notes: null,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.location).toBeUndefined();
      expect(result.data.internalInstructor).toBeUndefined();
      expect(result.data.externalInstructor).toBeUndefined();
      expect(result.data.notes).toBeUndefined();
      expect(result.data.maximumParticipants).toBeUndefined();
      expect(result.data.status).toBe("CANCELLED");
    }
  });

  it("continua aceitando string vazia como vazio (comportamento anterior preservado)", () => {
    const result = trainingClassInputSchema.safeParse({ ...baseInput, location: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.location).toBeUndefined();
  });

  it("continua aceitando valores reais normalmente", () => {
    const result = trainingClassInputSchema.safeParse({ ...baseInput, location: "Sala 3", maximumParticipants: 20 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.location).toBe("Sala 3");
      expect(result.data.maximumParticipants).toBe(20);
    }
  });
});
