"use client";

import { usePathname } from "next/navigation";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

// Rotas que devem sempre renderizar no tema claro, independentemente da
// preferência salva/do sistema (telas públicas de autenticação).
const FORCED_LIGHT_ROUTES = ["/login", "/register", "/q/"];

export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  const pathname = usePathname();
  const forcedTheme = FORCED_LIGHT_ROUTES.some((route) => pathname?.startsWith(route))
    ? "light"
    : undefined;

  return (
    <NextThemesProvider {...props} forcedTheme={forcedTheme}>
      {children}
    </NextThemesProvider>
  );
}
