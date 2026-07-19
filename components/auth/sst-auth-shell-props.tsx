import { ShieldCheckIcon } from "lucide-react";

/**
 * Tema visual do Portal Consultoria SST para o AuthShell (app/sst/login,
 * app/sst/register) — accentClassName diferente do azul padrão do Portal
 * Empresa (bg-blue-950) é proposital: sinaliza visualmente, já na tela de
 * login, que a pessoa está no portal da consultoria e não no da empresa
 * cliente. Compartilhado entre as duas páginas pra manter os dois em sync.
 */
export const SST_AUTH_SHELL_PROPS = {
  brandLabel: "Portal Consultoria SST",
  brandIcon: ShieldCheckIcon,
  accentClassName: "bg-emerald-950",
  // Também deixa o botão "Entrar"/"Criar conta" (bg-primary) e o foco dos
  // campos verdes, em vez do azul padrão do resto do app — ver .sst-theme
  // em app/globals.css.
  formAccentClassName: "sst-theme",
  heroTitle: "Acompanhe a conformidade de todas as suas empresas clientes, em um só lugar.",
  features: [
    "Gestão de colaboradores, treinamentos e certificados por empresa",
    "Turmas com controle de presença, capacidade e vencimento",
    "Acesso liberado só pelas empresas que autorizarem sua consultoria",
  ],
} as const;
