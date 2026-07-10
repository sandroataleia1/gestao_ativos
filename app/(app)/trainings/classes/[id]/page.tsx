import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { hasPermission, requirePermissionOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { getParticipantsForClass } from "@/lib/training-participants";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ParticipantsTable } from "./participants-table";

export const metadata: Metadata = {
  title: "Detalhes da turma — Gestão de Ativos",
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

export default async function TrainingClassDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { companyId } = await requirePermissionOrDeny(PERMISSIONS.TRAINING_VIEW);
  const canManage = await hasPermission(PERMISSIONS.TRAINING_MANAGE);

  const [trainingClass, participants, activeEmployees] = await Promise.all([
    prisma.trainingClass.findFirst({
      where: { id, companyId },
      include: { companyTraining: { select: { id: true, title: true, validityMonths: true } } },
    }),
    getParticipantsForClass(companyId, id),
    prisma.employee.findMany({
      where: { companyId, status: "ACTIVE" },
      select: { id: true, name: true, document: true, registration: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!trainingClass) notFound();

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{trainingClass.title}</h1>
        <p className="text-sm text-muted-foreground">{trainingClass.companyTraining.title}</p>
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <p className="text-xs text-muted-foreground">Status</p>
            <Badge variant={STATUS_BADGE_VARIANT[trainingClass.status]}>
              {STATUS_LABELS[trainingClass.status]}
            </Badge>
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
            <p className="text-sm">
              {trainingClass.internalInstructor ?? trainingClass.externalInstructor ?? "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Participantes</p>
            <p className="text-sm">
              {participants.length}
              {trainingClass.maximumParticipants ? ` / ${trainingClass.maximumParticipants}` : ""}
            </p>
          </div>
        </CardContent>
      </Card>

      <ParticipantsTable
        trainingClassId={trainingClass.id}
        trainingClassStatus={trainingClass.status}
        maximumParticipants={trainingClass.maximumParticipants}
        initialParticipants={participants}
        activeEmployees={activeEmployees}
        canManage={canManage}
      />
    </div>
  );
}
