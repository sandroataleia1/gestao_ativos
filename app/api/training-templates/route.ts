import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { TRAINING_TYPE_VALUES } from "@/lib/validations/training";
import type { Prisma } from "@/app/generated/prisma/client";

// Catálogo global (não filtrado por companyId — TrainingTemplate não
// pertence a nenhuma empresa) — ver docs/trainings-domain.md. Somente
// leitura nesta sprint: sem POST/PUT/DELETE aqui.
export async function GET(request: Request) {
  try {
    // requirePermission (não requireAuth) porque a lista de templates só é
    // útil para quem já enxerga o domínio de treinamentos.
    await requirePermission(PERMISSIONS.TRAINING_VIEW);

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("q")?.trim();
    const category = searchParams.get("category")?.trim();
    const trainingTypeParam = searchParams.get("trainingType");
    const trainingType = (TRAINING_TYPE_VALUES as readonly string[]).includes(trainingTypeParam ?? "")
      ? (trainingTypeParam as (typeof TRAINING_TYPE_VALUES)[number])
      : undefined;
    const activeParam = searchParams.get("active");
    // Default active:true — é a fonte do seletor de "novo treinamento", não
    // faz sentido oferecer por padrão um modelo desativado. Passar
    // active=false/true explicitamente permite ver o catálogo completo.
    const active = activeParam === "false" ? false : activeParam === "true" ? true : true;

    const where: Prisma.TrainingTemplateWhereInput = {
      active,
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
