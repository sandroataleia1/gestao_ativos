import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangleIcon, ChevronRightIcon, InfoIcon } from "lucide-react";

import { prisma } from "@/lib/prisma";
import { requireSstTrainingParticipantViewAccessOrDeny, sstCanManageTrainingParticipants } from "@/lib/sst-auth";
import { getParticipantsForClass } from "@/lib/training-participants";
import { maskEmployeeDocument } from "@/lib/sst-employees";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SstParticipantsTable } from "./sst-participants-table";

export const metadata: Metadata = {
  title: "Detalhes da turma — Portal Consultoria SST",
};

const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: "Agendada",
  IN_PROGRESS: "Em andamento",
  COMPLETED: "Concluída",
  CANCELLED: "Cancelada",
};

const STATUS_BADGE_VARIANT: Record<string, "default" | "outline" | "secondary" | "destructive"> = {
  SCHEDULED: "outline",
  IN_PROGRESS: "default",
  COMPLETED: "secondary",
  CANCELLED: "destructive",
};

function formatDateTime(date: Date | null) {
  if (!date) return "—";
  return new Date(date).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

type RouteParams = { params: Promise<{ companyId: string; classId: string }> };

export default async function SstClassDetailPage({ params }: RouteParams) {
  const { companyId, classId } = await params;
  const ctx = await requireSstTrainingParticipantViewAccessOrDeny(companyId, classId);
  const canManage = sstCanManageTrainingParticipants(ctx);

  const [trainingClass, participants] = await Promise.all([
    prisma.trainingClass.findFirst({
      where: { id: classId, companyId },
      include: { companyTraining: { select: { id: true, title: true, validityMonths: true } } },
    }),
    getParticipantsForClass(companyId, classId),
  ]);

  if (!trainingClass) notFound();

  // Sprint SST 1.4G, §23/§25 — a página carrega participantes direto do
  // serviço (não passa pela rota GET, que já mascara), então o documento
  // precisa ser mascarado aqui antes de chegar à tabela client-side.
  const maskedParticipants = participants.map((participant) => ({
    ...participant,
    employee: { ...participant.employee, document: maskEmployeeDocument(participant.employee.document) },
  }));

  const enrolledCount = participants.filter((p) => p.enrollmentStatus !== "CANCELLED").length;
  const isReviewInProgress = ctx.company.controlStatus === "CLAIM_PENDING" || ctx.company.controlStatus === "DISPUTED";
  const isProvisional = ctx.company.controlStatus === "UNCLAIMED";

  return (
    <div className="grid gap-6">
      <div>
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <Link href={`/sst/companies/${companyId}/classes`} className="hover:text-foreground">
            Turmas
          </Link>
          <ChevronRightIcon className="size-3.5" />
          <span className="text-foreground">{trainingClass.title}</span>
        </div>
        <h1 className="text-2xl font-semibold">{trainingClass.title}</h1>
        <p className="text-sm text-muted-foreground">{trainingClass.companyTraining.title}</p>
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

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <p className="text-xs text-muted-foreground">Status</p>
            <Badge variant={STATUS_BADGE_VARIANT[trainingClass.status]}>{STATUS_LABELS[trainingClass.status]}</Badge>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Início</p>
            <p className="text-sm">{formatDateTime(trainingClass.startsAt)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Término</p>
            <p className="text-sm">{formatDateTime(trainingClass.endsAt)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Local</p>
            <p className="text-sm">{trainingClass.location ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Instrutor</p>
            <p className="text-sm">{trainingClass.internalInstructor ?? trainingClass.externalInstructor ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Participantes</p>
            <p className="text-sm">
              {enrolledCount}
              {trainingClass.maximumParticipants ? ` / ${trainingClass.maximumParticipants}` : ""}
            </p>
          </div>
        </CardContent>
      </Card>

      <SstParticipantsTable
        companyId={companyId}
        trainingClassId={trainingClass.id}
        trainingClassStatus={trainingClass.status}
        maximumParticipants={trainingClass.maximumParticipants}
        initialParticipants={maskedParticipants}
        canManage={canManage}
      />
    </div>
  );
}
