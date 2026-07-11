"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BuildingIcon, CheckIcon, Loader2Icon, MailIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

type AvailableCompany = { companyId: string; membershipId: string; companyName: string };
type PendingInvitation = {
  membershipId: string;
  companyId: string;
  companyName: string;
  invitedAt: string;
  roleNames: string[];
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function SelectCompanyPanel({
  availableCompanies,
  pendingInvitations: initialPendingInvitations,
  currentCompanyId,
}: {
  availableCompanies: AvailableCompany[];
  pendingInvitations: PendingInvitation[];
  currentCompanyId: string | null;
}) {
  const router = useRouter();
  const [pendingInvitations, setPendingInvitations] = useState(initialPendingInvitations);
  const [acceptedCompanies, setAcceptedCompanies] = useState<AvailableCompany[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isNavigating, startTransition] = useTransition();

  const allAvailable = [...availableCompanies, ...acceptedCompanies];

  async function handleSelect(companyId: string) {
    setError(null);
    setBusyId(companyId);
    try {
      const res = await fetch("/api/company-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      if (!res.ok) {
        setError("Não foi possível selecionar esta empresa. Tente novamente.");
        return;
      }
      // Recarrega o contexto por completo (Sprint 0.6, Parte E: nenhum cache
      // do tenant anterior pode ser reaproveitado) — navegação de página
      // inteira, não só router.refresh(), garante que nenhum estado de
      // Client Component de uma renderização anterior sobreviva.
      startTransition(() => {
        window.location.assign("/dashboard");
      });
    } finally {
      setBusyId(null);
    }
  }

  async function handleAccept(invitation: PendingInvitation) {
    setError(null);
    setBusyId(invitation.membershipId);
    try {
      const res = await fetch(`/api/company-memberships/${invitation.membershipId}/accept`, {
        method: "POST",
      });
      if (!res.ok) {
        setError("Não foi possível aceitar este convite. Tente novamente.");
        return;
      }
      setPendingInvitations((prev) => prev.filter((p) => p.membershipId !== invitation.membershipId));
      setAcceptedCompanies((prev) => [
        ...prev,
        { companyId: invitation.companyId, membershipId: invitation.membershipId, companyName: invitation.companyName },
      ]);
    } finally {
      setBusyId(null);
    }
  }

  const isEmpty = allAvailable.length === 0 && pendingInvitations.length === 0;

  return (
    <div className="grid gap-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {isEmpty ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <BuildingIcon className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Você ainda não tem nenhuma empresa disponível. Peça para um administrador te convidar.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {allAvailable.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Suas empresas</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {allAvailable.map((company) => {
              const isCurrent = company.companyId === currentCompanyId;
              const isBusy = busyId === company.companyId && isNavigating;
              return (
                <div
                  key={company.membershipId}
                  className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
                >
                  <div className="flex items-center gap-2">
                    <BuildingIcon className="size-4 text-muted-foreground" />
                    <span className="font-medium">{company.companyName}</span>
                    {isCurrent ? <Badge variant="outline">Empresa atual</Badge> : null}
                  </div>
                  <Button
                    size="sm"
                    variant={isCurrent ? "outline" : "default"}
                    disabled={isBusy}
                    onClick={() => handleSelect(company.companyId)}
                  >
                    {isBusy ? <Loader2Icon className="size-4 animate-spin" /> : <CheckIcon className="size-4" />}
                    {isCurrent ? "Entrar novamente" : "Entrar"}
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      {pendingInvitations.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Convites pendentes</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {pendingInvitations.map((invitation) => (
              <div
                key={invitation.membershipId}
                className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  <MailIcon className="size-4 text-muted-foreground" />
                  <div>
                    <p className="font-medium">{invitation.companyName}</p>
                    <p className="text-xs text-muted-foreground">
                      Convidado em {formatDate(invitation.invitedAt)}
                      {invitation.roleNames.length ? ` · ${invitation.roleNames.join(", ")}` : ""}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === invitation.membershipId}
                  onClick={() => handleAccept(invitation)}
                >
                  {busyId === invitation.membershipId ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : null}
                  Aceitar convite
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
