import Link from "next/link";
import { BoxesIcon, CheckCircle2Icon } from "lucide-react";

const FEATURES = [
  "Rastreamento individual de ativos por número de patrimônio",
  "Controle de estoque de consumíveis em tempo real",
  "Histórico completo e imutável de movimentações",
];

function Wordmark({ dark = false }: { dark?: boolean }) {
  return (
    <span
      className={`flex items-center gap-2 font-heading text-lg font-semibold ${dark ? "text-zinc-50" : "text-foreground"}`}
    >
      <span
        className={`flex size-8 items-center justify-center rounded-lg ${dark ? "bg-white text-zinc-950" : "bg-primary text-primary-foreground"}`}
      >
        <BoxesIcon className="size-4" />
      </span>
      Gestão de Ativos
    </span>
  );
}

export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-blue-950 p-10 lg:flex">
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
          <Wordmark dark />
        </Link>

        <div className="relative z-10 max-w-md space-y-6">
          <h2 className="text-3xl font-semibold leading-tight text-balance text-zinc-50">
            Controle total dos ativos da sua empresa, em um só lugar.
          </h2>
          <ul className="space-y-3">
            {FEATURES.map((feature) => (
              <li key={feature} className="flex items-start gap-2.5 text-sm text-zinc-300">
                <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-zinc-500" />
                {feature}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 text-xs text-zinc-500">
          © {new Date().getFullYear()} Gestão de Ativos
        </p>
      </div>

      <div className="relative flex w-full flex-col items-center justify-center bg-background p-6 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Wordmark />
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
