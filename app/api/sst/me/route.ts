import { NextResponse } from "next/server";

import { requireSstAuth } from "@/lib/sst-auth";
import { handleApiError } from "@/lib/api-errors";

// Usado pelo login do Portal Consultoria para decidir se redireciona para
// /sst/dashboard (200) ou mostra "Este usuário não possui acesso ao Portal
// Consultoria." (403) — ver app/sst/login/sst-login-form.tsx.
export async function GET() {
  try {
    const { user, sstProviderUser } = await requireSstAuth();

    return NextResponse.json({
      user: { id: user.id, name: user.name, email: user.email },
      provider: {
        id: sstProviderUser.provider.id,
        name: sstProviderUser.provider.name,
      },
      role: sstProviderUser.role,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
