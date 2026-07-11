import type { Metadata } from "next";

import { requireSstAuthOrDeny } from "@/lib/sst-auth";
import { listTeamMembers } from "@/lib/sst-team";
import { TeamPanel } from "./team-panel";

export const metadata: Metadata = {
  title: "Equipe — Portal Consultoria SST",
};

// /sst/settings/team — Sprint Demo Comercial SST 1.0, Parte 3. Qualquer
// membro autenticado da consultoria pode ver a página (a lista de colegas é
// informação básica de equipe); só quem é OWNER vê e-mail e ações de
// gestão — ver lib/sst-team.ts.
export default async function SstTeamPage() {
  const ctx = await requireSstAuthOrDeny();
  const isOwner = ctx.sstProviderUser.role === "OWNER";
  const members = await listTeamMembers(ctx.providerId, ctx.user.id, isOwner);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Equipe</h1>
        <p className="text-sm text-muted-foreground">
          Pessoas com acesso ao Portal Consultoria da {ctx.sstProviderUser.provider.name}.
        </p>
      </div>

      <TeamPanel initialMembers={members} isOwner={isOwner} />
    </div>
  );
}
