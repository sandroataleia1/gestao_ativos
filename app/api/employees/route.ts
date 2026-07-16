import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { createEmployeeForCompany, employeeListInclude } from "@/lib/employees";
import { employeeInputSchema } from "@/lib/validations/employee";

export async function GET(request: NextRequest) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.EMPLOYEE_VIEW);

    const q = request.nextUrl.searchParams.get("q")?.trim();

    const employees = await prisma.employee.findMany({
      where: {
        companyId,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { document: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: employeeListInclude,
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ employees });
  } catch (error) {
    return handleApiError(error);
  }
}

// Sprint SST 1.4F — criação extraída para lib/employees.ts:
// createEmployeeForCompany (compartilhada com o Portal Consultoria SST),
// que agora também audita a criação (`employee.create`, antes não
// registrada) e trata duplicidade de documento com mensagem amigável (nunca
// expõe P2002 bruto).
export async function POST(request: NextRequest) {
  try {
    const { companyId, user } = await requirePermission(PERMISSIONS.EMPLOYEE_MANAGE);

    const body = await request.json();
    const input = employeeInputSchema.parse(body);

    const employee = await createEmployeeForCompany(companyId, input, { id: user.id, name: user.name });

    return NextResponse.json({ employee }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
