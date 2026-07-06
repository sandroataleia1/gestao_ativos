import { NextResponse } from "next/server";
import { ZodError, flattenError } from "zod";

import { AuthError, ForbiddenError } from "@/lib/auth-server";
import { Prisma } from "@/app/generated/prisma/client";

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

  console.error(error);
  return NextResponse.json({ error: "Erro interno do servidor." }, { status: 500 });
}
