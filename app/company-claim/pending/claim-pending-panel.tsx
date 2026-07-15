"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, CheckCircle2Icon, ClockIcon, LogOutIcon, XCircleIcon } from "lucide-react";
import { toast } from "sonner";

import { signOut } from "@/lib/auth-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// Sprint SST 1.4C.1, §9 — estados possíveis exibidos por esta página.
// "DISPUTED" não é um CompanyClaimRequestStatus real (é
// Company.controlStatus) — page.tsx já resolve isso para o status
// "efetivo" antes de passar pra cá, então este componente só precisa saber
// renderizar cada rótulo, nunca reimplementar essa lógica.
type EffectiveStatus = "PENDING" | "UNDER_REVIEW" | "DISPUTED" | "APPROVED" | "REJECTED" | "CANCELLED" | "EXPIRED";

const STATUS_CONFIG: Record<
  EffectiveStatus,
  { label: string; message: string; icon: typeof ClockIcon; showCancel: boolean; showEnter: boolean }
> = {
  PENDING: {
    label: "Aguardando análise",
    message:
      "Nenhum dado da empresa fica disponível até que a solicitação seja aprovada. Você pode sair a qualquer momento e voltar depois — o retorno traz de volta esta mesma página.",
    icon: ClockIcon,
    showCancel: true,
    showEnter: false,
  },
  UNDER_REVIEW: {
    label: "Em análise",
    message: "Sua solicitação está sendo analisada. Você pode sair a qualquer momento e voltar depois.",
    icon: ClockIcon,
    showCancel: true,
    showEnter: false,
  },
  DISPUTED: {
    label: "Requer análise adicional",
    message:
      "Mais de uma solicitação foi registrada para esta empresa. Nossa equipe vai analisar antes de prosseguir — nenhum dado é liberado enquanto isso.",
    icon: AlertTriangleIcon,
    showCancel: true,
    showEnter: false,
  },
  APPROVED: {
    label: "Aprovada",
    message: "Sua solicitação foi aprovada e o acesso à empresa já está liberado.",
    icon: CheckCircle2Icon,
    showCancel: false,
    showEnter: true,
  },
  REJECTED: {
    label: "Não aprovada",
    message: "Sua solicitação não foi aprovada. Entre em contato com o suporte se precisar de mais informações.",
    icon: XCircleIcon,
    showCancel: false,
    showEnter: false,
  },
  CANCELLED: {
    label: "Cancelada",
    message: "Você cancelou esta solicitação.",
    icon: XCircleIcon,
    showCancel: false,
    showEnter: false,
  },
  EXPIRED: {
    label: "Expirada",
    message: "Esta solicitação expirou. Entre em contato com o suporte para uma nova tentativa.",
    icon: ClockIcon,
    showCancel: false,
    showEnter: false,
  },
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
  const [isEntering, setIsEntering] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const config = STATUS_CONFIG[claim.status as EffectiveStatus] ?? STATUS_CONFIG.PENDING;
  const Icon = config.icon;

  async function handleSignOut() {
    setIsSigningOut(true);
    await signOut();
    router.push("/login");
    router.refresh();
  }

  function handleEnter() {
    setIsEntering(true);
    router.push("/dashboard");
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
          <Icon className="size-8 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-medium">{config.label}</p>
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

        <p className="text-sm text-muted-foreground">{config.message}</p>

        <div className="flex flex-wrap gap-2">
          {config.showEnter ? (
            <Button onClick={handleEnter} disabled={isEntering}>
              {isEntering ? "Entrando..." : "Entrar na empresa"}
            </Button>
          ) : null}
          <Button variant="outline" onClick={handleSignOut} disabled={isSigningOut}>
            <LogOutIcon />
            {isSigningOut ? "Saindo..." : "Sair"}
          </Button>
          {config.showCancel ? (
            <Button
              variant="outline"
              className="border-destructive text-destructive hover:bg-destructive/10"
              onClick={handleCancel}
              disabled={isCancelling}
            >
              {isCancelling ? "Cancelando..." : "Cancelar solicitação"}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
