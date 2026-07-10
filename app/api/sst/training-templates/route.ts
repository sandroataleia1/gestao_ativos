import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireSstAuth } from "@/lib/sst-auth";
import { handleApiError } from "@/lib/api-errors";
import { TRAINING_TYPE_VALUES } from "@/lib/validations/training";
import type { Prisma } from "@/app/generated/prisma/client";

// Catálogo global (sem companyId — TrainingTemplate não pertence a nenhuma
// empresa), mesma query de app/api/training-templates/route.ts. Gate é só
// `requireSstAuth` (qualquer usuário do Portal Consultoria autenticado) —
// não depende de empresa/accessLevel: browsing do catálogo não expõe nada
// sensível, só entra em jogo de verdade quando o provider tenta criar um
// CompanyTraining (requireSstCompanyAdministrationAccess).
export async function GET(request: Request) {
  try {
    await requireSstAuth();

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("q")?.trim();
    const category = searchParams.get("category")?.trim();
    const trainingTypeParam = searchParams.get("trainingType");
    const trainingType = (TRAINING_TYPE_VALUES as readonly string[]).includes(trainingTypeParam ?? "")
      ? (trainingTypeParam as (typeof TRAINING_TYPE_VALUES)[number])
      : undefined;

    const where: Prisma.TrainingTemplateWhereInput = {
      active: true,
      ...(category ? { category } : {}),
      ...(trainingType ? { trainingType } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: "insensitive" as const } },
              { code: { contains: search, mode: "insensitive" as const } },
              { category: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const templates = await prisma.trainingTemplate.findMany({ where, orderBy: { title: "asc" } });

    return NextResponse.json({ templates });
  } catch (error) {
    return handleApiError(error);
  }
}
