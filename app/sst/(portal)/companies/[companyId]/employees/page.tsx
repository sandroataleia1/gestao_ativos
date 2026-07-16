import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangleIcon, InfoIcon } from "lucide-react";

import { requireSstProviderEmployeeViewAccessOrDeny, sstCanManageEmployees } from "@/lib/sst-auth";
import { getSstCompanyEmployeesPage } from "@/lib/sst-employees";
import { parsePageParams, parseSearchParam, type SearchParamsInput } from "@/lib/pagination";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SstEmployeesTable } from "./sst-employees-table";

export const metadata: Metadata = {
  title: "Colaboradores — Portal Consultoria SST",
};

type RouteParams = { params: Promise<{ companyId: string }>; searchParams: Promise<SearchParamsInput> };

export default async function SstEmployeesPage({ params, searchParams }: RouteParams) {
  const { companyId } = await params;
  const ctx = await requireSstProviderEmployeeViewAccessOrDeny(companyId);
  const canManage = sstCanManageEmployees(ctx);
  const resolvedSearchParams = await searchParams;

  const { page, pageSize } = parsePageParams(resolvedSearchParams, { defaultPageSize: 20 });
  const search = parseSearchParam(resolvedSearchParams);
  const statusParam = resolvedSearchParams.status;
  const status = statusParam === "INACTIVE" || statusParam === "ALL" ? statusParam : "ACTIVE";

  const { rows: employees, total } = await getSstCompanyEmployeesPage(companyId, {
    page,
    pageSize,
    search: search || undefined,
    status,
  });

  const isReviewInProgress = ctx.company.controlStatus === "CLAIM_PENDING" || ctx.company.controlStatus === "DISPUTED";
  const isProvisional = ctx.company.controlStatus === "UNCLAIMED";

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Colaboradores</h1>
          <p className="text-sm text-muted-foreground">Gerencie os colaboradores utilizados nas operações de SST desta empresa.</p>
        </div>
        {canManage ? (
          <Button render={<Link href={`/sst/companies/${companyId}/employees/new`} />}>Cadastrar colaborador</Button>
        ) : null}
      </div>

      {isProvisional ? (
        <Alert>
          <InfoIcon />
          <AlertDescription>
            Esta empresa ainda não assumiu o cadastro na plataforma. Sua consultoria possui acesso provisório para
            organizar os dados de SST. Quando a empresa assumir o controle, ela poderá manter, limitar ou bloquear
            essa autorização.
          </AlertDescription>
        </Alert>
      ) : null}

      {isReviewInProgress ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertDescription>
            A empresa está revisando o controle do cadastro. Alterações estão temporariamente bloqueadas.
          </AlertDescription>
        </Alert>
      ) : !canManage ? (
        <Alert>
          <InfoIcon />
          <AlertDescription>Você possui acesso somente para consulta.</AlertDescription>
        </Alert>
      ) : null}

      <SstEmployeesTable companyId={companyId} employees={employees} total={total} page={page} pageSize={pageSize} canManage={canManage} />
    </div>
  );
}
