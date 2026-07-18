import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { signAttendanceList } from "@/lib/training-documents";
import { trainingAttendanceSignatureInputSchema } from "@/lib/validations/training-document";

type RouteParams = { params: Promise<{ id: string; documentId: string }> };

// `ipAddress`/`userAgent` nunca vêm do body do client — lidos direto dos
// headers da requisição (mesma regra de custódia — evidência não forjável).
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { user, companyId } = await requirePermission(PERMISSIONS.TRAINING_MANAGE);
    const { id, documentId } = await params;

    const body = await request.json();
    const input = trainingAttendanceSignatureInputSchema.parse(body);

    const forwardedFor = request.headers.get("x-forwarded-for");
    const ipAddress = forwardedFor?.split(",")[0]?.trim();

    const signature = await signAttendanceList(companyId, { id: user.id, name: user.name }, id, documentId, {
      ...input,
      ipAddress,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    return NextResponse.json({ signature }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
