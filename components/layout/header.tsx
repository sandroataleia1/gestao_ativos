import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { MobileNav } from "@/components/layout/mobile-nav";

export function Header({
  userName,
  userEmail,
  companyName,
  companyLogoDataUrl,
  activeEmployeeCount,
}: {
  userName: string;
  userEmail: string;
  companyName: string;
  companyLogoDataUrl?: string | null;
  activeEmployeeCount: number;
}) {
  return (
    <header className="flex h-14 items-center justify-between gap-4 border-b bg-card px-4">
      <div className="flex items-center gap-2">
        <MobileNav />
        {companyLogoDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URL local, não passa pelo otimizador de imagem do Next
          <img src={companyLogoDataUrl} alt="" className="size-8 shrink-0 rounded-md object-contain" />
        ) : null}
        <div className="leading-tight">
          <p className="text-sm font-semibold">{companyName}</p>
          <p className="text-xs text-muted-foreground">
            {activeEmployeeCount} colaborador{activeEmployeeCount === 1 ? "" : "es"} ativo
            {activeEmployeeCount === 1 ? "" : "s"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <UserMenu name={userName} email={userEmail} />
      </div>
    </header>
  );
}
