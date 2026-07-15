"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClockIcon, LogOutIcon } from "lucide-react";
import { toast } from "sonner";

import { signOut } from "@/lib/auth-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type ClaimStatus = "PENDING" | "UNDER_REVIEW";

const STATUS_LABELS: Record<ClaimStatus, string> = {
  PENDING: "Aguardando análise",
  UNDER_REVIEW: "Em análise",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

async function parseErrorMessage(response: Response) {
  const data = await response.json().catch(() => null);
  return data?.error ?? "Não foi possível concluir a ação.";
}

export function ClaimPendingPanel({
  claim,
}: {
  claim: {
    id: string;
    status: string;
    requestedAt: string;
    companyName: string;
    cnpjMasked: string | null;
  };
}) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut() {
    setIsSigningOut(true);
    await signOut();
    router.push("/login");
    router.refresh();
  }

  async function handleCancel() {
    setError(null);
    setIsCancelling(true);
    try {
      const response = await fetch(`/api/company-claim-requests/${claim.id}/cancel`, {
        method: "POST",
      });
      if (!response.ok) {
        setError(await parseErrorMessage(response));
        return;
      }
      setCancelled(true);
      toast.success("Solicitação cancelada.");
    } catch {
      setError("Não foi possível cancelar a solicitação. Tente novamente.");
    } finally {
      setIsCancelling(false);
    }
  }

  if (cancelled) {
    return (
      <Card>
        <CardContent className="grid gap-4 pt-6 text-center">
          <p className="font-medium">Solicitação cancelada.</p>
          <p className="text-sm text-muted-foreground">
            Você pode encerrar a sessão ou entrar em contato para uma nova tentativa.
          </p>
          <Button variant="outline" onClick={handleSignOut} disabled={isSigningOut}>
            <LogOutIcon />
            {isSigningOut ? "Saindo..." : "Sair"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex items-center gap-3">
          <ClockIcon className="size-8 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-medium">{STATUS_LABELS[claim.status as ClaimStatus] ?? claim.status}</p>
            <p className="text-sm text-muted-foreground">Solicitado em {formatDate(claim.requestedAt)}</p>
          </div>
        </div>

        <dl className="grid gap-1 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Empresa</dt>
            <dd className="text-right font-medium">{claim.companyName}</dd>
          </div>
          {claim.cnpjMasked ? (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">CNPJ</dt>
              <dd className="text-right font-medium">{claim.cnpjMasked}</dd>
            </div>
          ) : null}
        </dl>

        <p className="text-sm text-muted-foreground">
          Nenhum dado da empresa fica disponível até que a solicitação seja aprovada. Você pode
          sair a qualquer momento e voltar depois — o retorno traz de volta esta mesma página.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handleSignOut} disabled={isSigningOut}>
            <LogOutIcon />
            {isSigningOut ? "Saindo..." : "Sair"}
          </Button>
          <Button
            variant="outline"
            className="border-destructive text-destructive hover:bg-destructive/10"
            onClick={handleCancel}
            disabled={isCancelling}
          >
            {isCancelling ? "Cancelando..." : "Cancelar solicitação"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
