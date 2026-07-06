import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { getCurrentCompany, getCurrentUser } from "@/lib/auth-server";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const [company, activeEmployeeCount] = await Promise.all([
    getCurrentCompany(),
    prisma.employee.count({ where: { companyId: user.companyId, status: "ACTIVE" } }),
  ]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          userName={user.name}
          userEmail={user.email}
          companyName={company?.name ?? "—"}
          activeEmployeeCount={activeEmployeeCount}
        />
        <main className="flex-1 overflow-y-auto bg-muted/30 p-6">{children}</main>
      </div>
    </div>
  );
}
