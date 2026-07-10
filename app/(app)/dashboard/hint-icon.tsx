"use client";

import { InfoIcon } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Precisa ser Client Component: o `onClick` (impede que o clique no ícone
 * dispare a navegação do `<Link>` que envolve o card inteiro) não pode ser
 * passado como prop de um elemento renderizado dentro de um Server
 * Component. */
export function HintIcon({ hint }: { hint: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className="inline-flex text-muted-foreground/70 hover:text-muted-foreground"
            onClick={(event) => event.preventDefault()}
          >
            <InfoIcon className="size-3.5" />
          </span>
        }
      />
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}
