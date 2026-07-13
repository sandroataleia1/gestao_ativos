import Link from "next/link";
import { UserXIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// Sprint Demo Comercial — Wizard de Nova Entrega, Parte 5: sem colaborador
// ativo, o wizard nem é montado — mostra este estado bloqueado em vez de um
// formulário vazio que parece funcional mas não pode ser concluído. A ação
// de cadastro só aparece para quem tem `employee:manage` (decidido no
// Server Component, nunca escondido só via CSS) — quem não tem vê a
// orientação de procurar um administrador/RH.
export function NoActiveEmployeesState({ canManageEmployees }: { canManageEmployees: boolean }) {
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Nova entrega</h1>
      </div>

      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-muted">
            <UserXIcon className="size-6 text-muted-foreground" aria-hidden="true" />
          </span>
          <div className="grid gap-1">
            <p className="font-medium">Nenhum colaborador ativo</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Para registrar uma entrega, cadastre ou reative um colaborador.
            </p>
          </div>

          {canManageEmployees ? (
            <Button render={<Link href="/employees/new" />}>Cadastrar colaborador</Button>
          ) : (
            <p className="max-w-sm text-sm text-muted-foreground">
              Solicite a um administrador ou usuário de RH o cadastro ou a reativação do colaborador.
            </p>
          )}

          <Button variant="outline" size="sm" render={<Link href="/custodies" />}>
            Voltar para entregas
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
