import Link from "next/link";
import { BoxesIcon, CheckCircle2Icon, type LucideIcon } from "lucide-react";

const DEFAULT_FEATURES = [
  "Rastreamento individual de ativos por número de patrimônio",
  "Controle de estoque de consumíveis em tempo real",
  "Histórico completo e imutável de movimentações",
];

function Wordmark({
  dark = false,
  label,
  icon: Icon,
}: {
  dark?: boolean;
  label: string;
  icon: LucideIcon;
}) {
  return (
    <span
      className={`flex items-center gap-2 font-heading text-lg font-semibold ${dark ? "text-zinc-50" : "text-foreground"}`}
    >
      <span
        className={`flex size-8 items-center justify-center rounded-lg ${dark ? "bg-white text-zinc-950" : "bg-primary text-primary-foreground"}`}
      >
        <Icon className="size-4" />
      </span>
      {label}
    </span>
  );
}

/**
 * Shell genérico de tela de auth (split-screen: painel escuro com destaque
 * à esquerda, formulário à direita) — usado tanto pelo Portal Empresa
 * (app/login, app/register, sem props de tema: ficam nos valores padrão)
 * quanto pelo Portal Consultoria SST (app/sst/login, app/sst/register, com
 * `accentClassName`/`brandLabel`/`brandIcon`/`features` próprios), pra dar
 * uma identidade visual distinta entre os dois portais sem duplicar o
 * layout inteiro.
 */
export function AuthShell({
  title,
  description,
  children,
  footer,
  brandLabel = "Gestão de Ativos",
  brandIcon = BoxesIcon,
  heroTitle = "Controle total dos ativos da sua empresa, em um só lugar.",
  features = DEFAULT_FEATURES,
  accentClassName = "bg-blue-950",
  formAccentClassName = "",
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  brandLabel?: string;
  brandIcon?: LucideIcon;
  heroTitle?: string;
  features?: readonly string[];
  accentClassName?: string;
  /** Classe extra pro painel de formulário (lado direito) — usada pra
   * escopar a cor de destaque dos botões/links do form (ex.: "sst-theme")
   * sem afetar o Portal Empresa, que fica no padrão azul. */
  formAccentClassName?: string;
}) {
  return (
    <div className="flex min-h-screen">
      <div
        className={`relative hidden w-1/2 flex-col justify-between overflow-hidden p-10 lg:flex ${accentClassName}`}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.15]"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(255,255,255,0.5) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 -right-32 size-96 rounded-full bg-white/5 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -left-24 size-96 rounded-full bg-white/5 blur-3xl"
        />

        <Link href="/" className="relative z-10">
          <Wordmark dark label={brandLabel} icon={brandIcon} />
        </Link>

        <div className="relative z-10 max-w-md space-y-6">
          <h2 className="text-3xl font-semibold leading-tight text-balance text-zinc-50">
            {heroTitle}
          </h2>
          <ul className="space-y-3">
            {features.map((feature) => (
              <li key={feature} className="flex items-start gap-2.5 text-sm text-zinc-300">
                <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-zinc-500" />
                {feature}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 text-xs text-zinc-500">
          © {new Date().getFullYear()} {brandLabel}
        </p>
      </div>

      <div
        className={`auth-shell-light relative flex w-full flex-col items-center justify-center bg-white p-6 text-foreground lg:w-1/2 ${formAccentClassName}`}
      >
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Wordmark label={brandLabel} icon={brandIcon} />
          </div>

          <div className="mb-6 space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>

          {children}

          {footer ? (
            <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
