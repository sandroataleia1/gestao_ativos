"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { AlertCircleIcon, BuildingIcon, FileTextIcon, Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { isValidCnpj, maskCnpjInput } from "@/lib/cnpj";

// Fluxo de duas fases (Sprint Comercial SST 1.4, §10): fase 1 verifica o
// CNPJ (somente leitura — POST /api/sst/companies/check-cnpj); fase 2
// mostra a ação certa conforme o resultado, sem nunca revelar dados da
// empresa antes da autorização (§18).

type CheckResult =
  | { status: "ALREADY_AUTHORIZED"; companyId: string; companyName: string }
  | { status: "ALREADY_PROVISIONALLY_AUTHORIZED"; companyId: string; companyName: string }
  | {
      status:
        | "AVAILABLE_FOR_PRE_REGISTRATION"
        | "AUTHORIZATION_REQUIRED"
        | "AUTHORIZATION_PENDING"
        | "RELATIONSHIP_REVIEW_REQUIRED"
        | "COMPANY_UNAVAILABLE";
    };

async function parseErrorMessage(response: Response) {
  const data = await response.json().catch(() => null);
  return data?.error ?? "Não foi possível concluir a ação.";
}

export function AddCompanyForm() {
  const [cnpj, setCnpj] = useState("");
  const [cnpjError, setCnpjError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);

  const [companyName, setCompanyName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [newCompanyId, setNewCompanyId] = useState<string | null>(null);

  async function handleCheck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCnpjError(null);
    setActionError(null);
    setSuccessMessage(null);
    setResult(null);
    setNewCompanyId(null);

    if (!isValidCnpj(cnpj)) {
      setCnpjError("Informe um CNPJ válido.");
      return;
    }

    setIsChecking(true);
    try {
      const response = await fetch("/api/sst/companies/check-cnpj", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cnpj }),
      });
      if (!response.ok) {
        setCnpjError(await parseErrorMessage(response));
        return;
      }
      setResult((await response.json()) as CheckResult);
    } catch {
      setCnpjError("Não foi possível verificar o CNPJ. Tente novamente.");
    } finally {
      setIsChecking(false);
    }
  }

  async function handlePreRegister() {
    if (!companyName.trim()) {
      setActionError("Informe o nome da empresa.");
      return;
    }
    setActionError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/sst/companies/pre-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cnpj, name: companyName }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setActionError(data?.error ?? "Não foi possível pré-cadastrar a empresa.");
        return;
      }
      if (data.created) {
        setSuccessMessage(`Empresa "${data.company.name}" pré-cadastrada com sucesso. Acesso provisório concedido.`);
        setNewCompanyId(data.company.id as string);
      } else if (data.reason === "ALREADY_PROVISIONALLY_AUTHORIZED" || data.reason === "ALREADY_AUTHORIZED") {
        setSuccessMessage("Sua consultoria já possui acesso a esta empresa.");
      } else {
        setSuccessMessage("Solicitação enviada — aguardando autorização da empresa.");
      }
    } catch {
      setActionError("Não foi possível pré-cadastrar a empresa. Tente novamente.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRequestAccess() {
    setActionError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/sst/companies/request-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cnpj }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setActionError(data?.error ?? "Não foi possível solicitar autorização.");
        return;
      }
      setSuccessMessage(
        data.status === "ALREADY_AUTHORIZED" || data.status === "ALREADY_PROVISIONALLY_AUTHORIZED"
          ? "Sua consultoria já possui acesso a esta empresa."
          : "Solicitação enviada — aguardando autorização da empresa.",
      );
    } catch {
      setActionError("Não foi possível solicitar autorização. Tente novamente.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function resetToStepOne() {
    setResult(null);
    setCompanyName("");
    setActionError(null);
    setSuccessMessage(null);
    setNewCompanyId(null);
  }

  return (
    <div className="grid max-w-lg gap-6">
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleCheck} className="grid gap-2">
            <Label htmlFor="cnpj">CNPJ da empresa</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <FileTextIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="cnpj"
                  inputMode="numeric"
                  placeholder="00.000.000/0000-00"
                  value={cnpj}
                  onChange={(event) => {
                    setCnpj(maskCnpjInput(event.target.value));
                    setResult(null);
                  }}
                  disabled={isChecking || Boolean(result)}
                  aria-invalid={Boolean(cnpjError)}
                  className="pl-8"
                />
              </div>
              {result ? (
                // `key` explícita — sem isso, o React reaproveita o mesmo nó
                // do DOM deste botão e do "Verificar" abaixo (mesma posição
                // na árvore), só trocando o atributo `type`. Como essa troca
                // acontece de forma síncrona durante o clique, o navegador
                // processa o "comportamento de ativação" do clique já vendo
                // type="submit" e envia o formulário sem querer — bug real
                // encontrado na validação manual desta sprint.
                <Button key="trocar" type="button" variant="outline" onClick={resetToStepOne} disabled={isSubmitting}>
                  Trocar CNPJ
                </Button>
              ) : (
                <Button key="verificar" type="submit" disabled={isChecking}>
                  {isChecking ? <Loader2Icon className="animate-spin" /> : null}
                  Verificar
                </Button>
              )}
            </div>
            {cnpjError ? <p className="text-sm text-destructive">{cnpjError}</p> : null}
          </form>
        </CardContent>
      </Card>

      {result ? (
        <ResultPanel
          result={result}
          companyName={companyName}
          onCompanyNameChange={setCompanyName}
          successMessage={successMessage}
          actionError={actionError}
          newCompanyId={newCompanyId}
          isSubmitting={isSubmitting}
          onPreRegister={handlePreRegister}
          onRequestAccess={handleRequestAccess}
        />
      ) : null}
    </div>
  );
}

function ResultPanel({
  result,
  companyName,
  onCompanyNameChange,
  successMessage,
  actionError,
  newCompanyId,
  isSubmitting,
  onPreRegister,
  onRequestAccess,
}: {
  result: CheckResult;
  companyName: string;
  onCompanyNameChange: (value: string) => void;
  successMessage: string | null;
  actionError: string | null;
  newCompanyId: string | null;
  isSubmitting: boolean;
  onPreRegister: () => void;
  onRequestAccess: () => void;
}) {
  if (successMessage) {
    return (
      <Card>
        <CardContent className="grid gap-3 pt-6 text-center">
          <BuildingIcon className="mx-auto size-8 text-muted-foreground" />
          <p className="font-medium">{successMessage}</p>
          {newCompanyId ? (
            <Button render={<Link href={`/sst/companies/${newCompanyId}`} />} className="mx-auto">
              Abrir empresa
            </Button>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  if (actionError) {
    return (
      <Alert variant="destructive">
        <AlertCircleIcon />
        <AlertDescription>{actionError}</AlertDescription>
      </Alert>
    );
  }

  switch (result.status) {
    case "AVAILABLE_FOR_PRE_REGISTRATION":
      return (
        <Card>
          <CardContent className="grid gap-4 pt-6">
            <div>
              <p className="font-medium">Empresa ainda não cadastrada</p>
              <p className="text-sm text-muted-foreground">
                Você poderá criar um pré-cadastro e iniciar a operação provisória dos dados de SST
                desta empresa.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="company-name">Nome da empresa</Label>
              <Input
                id="company-name"
                value={companyName}
                onChange={(event) => onCompanyNameChange(event.target.value)}
                disabled={isSubmitting}
                autoFocus
              />
            </div>
            <Button onClick={onPreRegister} disabled={isSubmitting}>
              {isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
              Pré-cadastrar empresa
            </Button>
            <p className="text-xs text-muted-foreground">
              Os dados continuarão pertencendo à empresa. Quando ela assumir o cadastro, poderá
              manter, suspender ou bloquear o acesso da consultoria.
            </p>
          </CardContent>
        </Card>
      );

    case "AUTHORIZATION_REQUIRED":
      return (
        <Card>
          <CardContent className="grid gap-3 pt-6">
            <p className="text-sm text-muted-foreground">
              Esta empresa já está cadastrada na plataforma.
              <br />
              Para operar os dados de SST, solicite autorização.
            </p>
            <Button onClick={onRequestAccess} disabled={isSubmitting}>
              {isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
              Solicitar autorização
            </Button>
          </CardContent>
        </Card>
      );

    case "ALREADY_AUTHORIZED":
      return (
        <Card>
          <CardContent className="grid gap-3 pt-6">
            <p className="text-sm text-muted-foreground">Sua consultoria já possui acesso autorizado.</p>
            <Button render={<Link href={`/sst/companies/${result.companyId}`} />}>Abrir empresa</Button>
          </CardContent>
        </Card>
      );

    case "ALREADY_PROVISIONALLY_AUTHORIZED":
      return (
        <Card>
          <CardContent className="grid gap-3 pt-6">
            <p className="text-sm text-muted-foreground">
              Sua consultoria possui acesso provisório para operação dos dados de SST desta
              empresa (pré-cadastro ainda não reivindicado).
            </p>
            <Button render={<Link href={`/sst/companies/${result.companyId}`} />}>Abrir empresa</Button>
          </CardContent>
        </Card>
      );

    case "AUTHORIZATION_PENDING":
      return (
        <Alert>
          <AlertCircleIcon />
          <AlertDescription>Solicitação aguardando análise da empresa.</AlertDescription>
        </Alert>
      );

    case "RELATIONSHIP_REVIEW_REQUIRED":
      return (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertDescription>
            O vínculo da sua consultoria com esta empresa precisa de uma revisão administrativa
            antes de qualquer nova solicitação.
          </AlertDescription>
        </Alert>
      );

    case "COMPANY_UNAVAILABLE":
      return (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertDescription>Esta empresa não está disponível para autorização no momento.</AlertDescription>
        </Alert>
      );

    default:
      return null;
  }
}
