import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { MobileNav } from "@/components/layout/mobile-nav";
import { CompanySwitcher, type SwitchableCompany } from "@/components/layout/company-switcher";

export function Header({
  userName,
  userEmail,
  companyName,
  companyLogoDataUrl,
  activeEmployeeCount,
  currentCompanyId,
  switchableCompanies,
}: {
  userName: string;
  userEmail: string;
  companyName: string;
  companyLogoDataUrl?: string | null;
  activeEmployeeCount: number;
  // Sprint 0.6, Parte E — só passa mais de 1 item quando o usuário
  // realmente tem mais de uma empresa selecionável; com 0 ou 1, o seletor
  // fica oculto (ver condicional abaixo).
  currentCompanyId?: string;
  switchableCompanies?: SwitchableCompany[];
}) {
  const showSwitcher = Boolean(currentCompanyId) && (switchableCompanies?.length ?? 0) > 1;

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
        {showSwitcher ? (
          <CompanySwitcher currentCompanyId={currentCompanyId!} companies={switchableCompanies!} />
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <UserMenu name={userName} email={userEmail} />
      </div>
    </header>
  );
}
