import { NextResponse } from "next/server";
import { ZodError, flattenError } from "zod";

import { AuthError, CompanyClaimPendingError, CompanySelectionRequiredError, ForbiddenError } from "@/lib/auth-server";
import { Prisma } from "@/app/generated/prisma/client";
import { captureException } from "@/lib/monitoring";
import { logError } from "@/lib/logger";

export class NotFoundError extends Error {
  constructor(message = "Registro não encontrado.") {
    super(message);
    this.name = "NotFoundError";
  }
}

/** Erros de regra de negócio (ex.: referência a outro registro que não
 * existe ou não pertence à empresa atual) — distinto de ZodError, que é só
 * validação de formato do payload. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class ConflictError extends Error {
  constructor(message = "Conflito de dados.") {
    super(message);
    this.name = "ConflictError";
  }
}

/**
 * Handler padronizado de erros para Route Handlers de API. Mapeia os erros
 * conhecidos (auth/RBAC, validação, not found, conflito, unique constraint
 * do Prisma) para status HTTP e um corpo `{ error, fieldErrors? }`
 * consistente; qualquer coisa não mapeada vira 500 genérico.
 */
export function handleApiError(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  // Código estável (Sprint 0.6, Parte D) — distinto de ForbiddenError: o
  // usuário está autenticado e tem memberships válidas, só precisa
  // selecionar qual. Clientes (fetch do app) podem tratar este código
  // especificamente (ex.: redirecionar para /select-company) em vez de
  // mostrar um erro genérico de "acesso negado".
  if (error instanceof CompanySelectionRequiredError) {
    return NextResponse.json(
      { code: "COMPANY_SELECTION_REQUIRED", activeMembershipCount: error.activeMembershipCount },
      { status: 409 },
    );
  }
  // Sprint SST 1.4C — código estável distinto de ForbiddenError, mesmo
  // espírito de COMPANY_SELECTION_REQUIRED: nunca revela dados da Company
  // (nem o nome), só que existe uma solicitação em análise para este
  // usuário. Clientes podem redirecionar para /company-claim/pending.
  if (error instanceof CompanyClaimPendingError) {
    return NextResponse.json({ code: "CLAIM_PENDING" }, { status: 403 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof ValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof ConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: "Dados inválidos.", fieldErrors: flattenError(error).fieldErrors },
      { status: 400 },
    );
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return NextResponse.json(
      { error: "Já existe um registro com esses dados." },
      { status: 409 },
    );
  }

  // `handleApiError` é síncrona (mudar isso exigiria `await` em toda rota
  // que já a chama) — `logError` é async só porque lê o request id via
  // `next/headers()`, então dispara sem aguardar ("fire and forget");
  // seguro aqui porque o processo (PM2) continua rodando depois da
  // resposta, não é uma function serverless que poderia matar o processo
  // antes da promise terminar.
  void logError("unhandled_api_error", {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  captureException(error);
  return NextResponse.json({ error: "Erro interno do servidor." }, { status: 500 });
}
