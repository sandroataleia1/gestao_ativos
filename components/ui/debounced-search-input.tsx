"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SearchIcon } from "lucide-react";

import { Input } from "@/components/ui/input";

const DEBOUNCE_MS = 300;

/** Campo de busca que atualiza a URL (`?q=`) após um debounce, disparando
 * nova busca server-side — substitui o filtro client-side em `useMemo` que
 * as tabelas usavam antes (só filtrava a página já carregada, o que deixa
 * de fazer sentido com paginação real). Sempre volta pra página 1 numa
 * busca nova. */
export function DebouncedSearchInput({
  paramKey = "q",
  pageParamKey = "page",
  placeholder,
  className,
}: {
  paramKey?: string;
  /** Parâmetro de página a resetar numa busca nova — permite mais de uma
   * tabela paginada na mesma página (ex.: /stock). */
  pageParamKey?: string;
  placeholder?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get(paramKey) ?? "");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setValue(searchParams.get(paramKey) ?? "");
    // Só precisa reagir quando o valor do parâmetro muda (ex.: navegação
    // externa/voltar), não a cada render do componente pai.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get(paramKey)]);

  function handleChange(next: string) {
    setValue(next);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (next.trim()) params.set(paramKey, next.trim());
      else params.delete(paramKey);
      params.delete(pageParamKey);
      router.push(`${pathname}?${params.toString()}`);
    }, DEBOUNCE_MS);
  }

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <div className={`relative ${className ?? ""}`}>
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        className="pl-8"
      />
    </div>
  );
}
