"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircleIcon, BuildingIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type ProvisionalLink = {
  id: string;
  providerName: string;
  accessLevel: "VIEW" | "OPERATION" | "ADMINISTRATION";
};

const ACCESS_LEVEL_LABELS: Record<ProvisionalLink["accessLevel"], string> = {
  VIEW: "Visualização",
  OPERATION: "Operação",
  ADMINISTRATION: "Administração",
};

async function parseErrorMessage(response: Response) {
  const data = await response.json().catch(() => null);
  return data?.error ?? "Não foi possível concluir a ação.";
}

export function ClaimReviewPanel({ links: initialLinks }: { links: ProvisionalLink[] }) {
  const router = useRouter();
  const [links, setLinks] = useState(initialLinks);
  const [levels, setLevels] = useState<Record<string, ProvisionalLink["accessLevel"]>>(
    Object.fromEntries(initialLinks.map((link) => [link.id, link.accessLevel])),
  );
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(link: ProvisionalLink, decision: "CONTINUE" | "BLOCK") {
    setError(null);
    setWorkingId(link.id);
    try {
      const response = await fetch(`/api/companies/claim-review/${link.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          ...(decision === "CONTINUE" ? { accessLevel: levels[link.id] } : {}),
        }),
      });
      if (!response.ok) {
        setError(await parseErrorMessage(response));
        return;
      }
      const data = (await response.json()) as { claimFinalized: boolean };
      toast.success(decision === "CONTINUE" ? `${link.providerName} continua autorizado.` : `Acesso de ${link.providerName} bloqueado.`);

      const remaining = links.filter((l) => l.id !== link.id);
      setLinks(remaining);

      if (data.claimFinalized || remaining.length === 0) {
        router.push("/dashboard");
        router.refresh();
      }
    } catch {
      setError("Não foi possível concluir a ação. Tente novamente.");
    } finally {
      setWorkingId(null);
    }
  }

  if (links.length === 0) {
    return (
      <Card>
        <CardContent className="grid gap-2 pt-6 text-center">
          <BuildingIcon className="mx-auto size-8 text-muted-foreground" />
          <p className="font-medium">Tudo revisado — redirecionando...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      {error ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {links.map((link) => (
        <Card key={link.id}>
          <CardContent className="grid gap-4 pt-6">
            <div>
              <p className="font-medium">{link.providerName}</p>
              <p className="text-sm text-muted-foreground">
                Esta consultoria criou o pré-cadastro da sua empresa e atualmente possui acesso
                provisório para operação dos dados de SST cadastrados.
              </p>
            </div>

            <div className="grid gap-2">
              <Label>Nível de acesso ao continuar autorizando</Label>
              <Select
                items={ACCESS_LEVEL_LABELS}
                value={levels[link.id]}
                onValueChange={(value) =>
                  setLevels((prev) => ({ ...prev, [link.id]: value as ProvisionalLink["accessLevel"] }))
                }
                disabled={workingId === link.id}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ACCESS_LEVEL_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => decide(link, "CONTINUE")} disabled={workingId === link.id}>
                {workingId === link.id ? <Loader2Icon className="animate-spin" /> : null}
                Continuar autorizando
              </Button>
              <Button
                variant="outline"
                className="border-destructive text-destructive hover:bg-destructive/10"
                onClick={() => decide(link, "BLOCK")}
                disabled={workingId === link.id}
              >
                Bloquear acesso da consultoria
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
