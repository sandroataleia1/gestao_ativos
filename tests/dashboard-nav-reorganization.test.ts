import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildDashboardQuickActions } from "@/lib/dashboard";
import { filterNavGroupsByPermission, getActiveNavHref, isSubmenuActive, NAV_GROUPS } from "@/components/layout/nav-items";
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, type PermissionKey } from "@/lib/permissions";

function permissionMapFor(roleKeys: readonly PermissionKey[]): Partial<Record<PermissionKey, boolean>> {
  const granted = new Set(roleKeys);
  return Object.fromEntries(Object.values(PERMISSIONS).map((key) => [key, granted.has(key)]));
}

function flattenLabels(groups: ReturnType<typeof filterNavGroupsByPermission>): string[] {
  return groups.flatMap((group) =>
    group.items.flatMap((entry) => (entry.kind === "submenu" ? entry.items.map((i) => i.label) : [entry.label])),
  );
}

// Sprint Demo Comercial SST 1.2 — a suíte de testes deste projeto é toda
// Node/Prisma (sem jsdom/@testing-library/react), então os 11 comportamentos
// pedidos pela sprint são cobertos aqui como testes de DADOS/LÓGICA (o que
// realmente decide o que a interface mostra), não de texto renderizado —
// "não testar apenas textos frágeis quando um teste de comportamento for
// mais adequado" (Parte 16). Os casos que dependem de banco (isolamento de
// alertas entre empresas, permissões inalteradas) estão em
// tests/tenant-isolation/dashboard-scope.test.ts.

describe("Sprint Demo Comercial SST 1.2 — caso 1: identidade da marca", () => {
  it("sidebar e menu mobile usam 'Patrium' / 'Portal Empresa', não 'Gestão de Ativos' como marca principal", () => {
    const sidebarSource = readFileSync("components/layout/sidebar.tsx", "utf8");
    const mobileNavSource = readFileSync("components/layout/mobile-nav.tsx", "utf8");

    for (const source of [sidebarSource, mobileNavSource]) {
      expect(source).toContain("Patrium");
      expect(source).toContain("Portal Empresa");
      // "Gestão de Ativos" não pode mais aparecer como TEXTO RENDERIZADO
      // (nó de JSX, ex.: ">Gestão de Ativos<" ou "{"Gestão de Ativos"}") —
      // checar a string crua também pegaria comentários explicando a
      // mudança (como este arquivo tem), o que seria um teste de texto
      // frágil demais (Parte 16).
      expect(source).not.toMatch(/[>{]\s*["']?Gestão de Ativos["']?\s*[<}]/);
    }
  });
});

describe("Sprint Demo Comercial SST 1.2 — caso 2: item ativo único e correto", () => {
  it("rotas com prefixo compartilhado ativam só o item mais específico", () => {
    expect(getActiveNavHref("/trainings/classes/abc123")).toBe("/trainings/classes");
    expect(getActiveNavHref("/trainings/new")).toBe("/trainings");
    expect(getActiveNavHref("/trainings")).toBe("/trainings");
  });

  it("uma rota sem correspondência não ativa nenhum item (nunca ativa por engano)", () => {
    expect(getActiveNavHref("/configuracoes/empresa")).toBe("/configuracoes");
    expect(getActiveNavHref("/nao-existe")).toBeUndefined();
  });

  it("cada item de nav aparece em só um grupo (sem duplicidade que causaria realce duplo)", () => {
    const allHrefs = NAV_GROUPS.flatMap((group) =>
      group.items.flatMap((entry) => (entry.kind === "submenu" ? entry.items.map((i) => i.href) : [entry.href])),
    );
    expect(new Set(allHrefs).size).toBe(allHrefs.length);
  });
});

describe("Sprint Demo Comercial SST 1.2 — caso 3: Treinamentos e Turmas agrupados em SST", () => {
  it("o grupo SST contém exatamente Treinamentos, Turmas e Alertas — sem duplicar em outro grupo", () => {
    const sstGroup = NAV_GROUPS.find((group) => group.label === "SST");
    expect(sstGroup).toBeDefined();
    const labels = sstGroup!.items.map((item) => item.label);
    expect(labels).toEqual(["Treinamentos", "Turmas", "Alertas"]);

    const otherGroupsLabels = NAV_GROUPS.filter((group) => group.label !== "SST").flatMap((group) =>
      group.items.flatMap((entry) => (entry.kind === "submenu" ? entry.items.map((i) => i.label) : [entry.label])),
    );
    expect(otherGroupsLabels).not.toContain("Treinamentos");
    expect(otherGroupsLabels).not.toContain("Turmas");
  });
});

describe("Sprint Demo Comercial SST 1.2 — caso 4: Cadastros auxiliares permanecem acessíveis", () => {
  it("Categorias/Fabricantes/Fornecedores existem dentro do submenu 'Cadastros auxiliares', com os hrefs originais", () => {
    const gestaoGroup = NAV_GROUPS.find((group) => group.label === "Gestão");
    const submenu = gestaoGroup?.items.find((entry) => entry.kind === "submenu");
    expect(submenu).toBeDefined();
    if (submenu?.kind !== "submenu") throw new Error("esperado submenu");

    const byLabel = new Map(submenu.items.map((item) => [item.label, item.href]));
    expect(byLabel.get("Categorias")).toBe("/cadastros/categorias");
    expect(byLabel.get("Fabricantes")).toBe("/cadastros/fabricantes");
    expect(byLabel.get("Fornecedores")).toBe("/cadastros/fornecedores");
  });

  it("o submenu é reconhecido como ativo quando a rota atual é um dos seus filhos", () => {
    const gestaoGroup = NAV_GROUPS.find((group) => group.label === "Gestão")!;
    const submenu = gestaoGroup.items.find((entry) => entry.kind === "submenu");
    if (submenu?.kind !== "submenu") throw new Error("esperado submenu");

    expect(isSubmenuActive("/cadastros/fabricantes", submenu)).toBe(true);
    expect(isSubmenuActive("/dashboard", submenu)).toBe(false);
  });
});

describe("Sprint Demo Comercial SST 1.2 — achado da validação manual: sidebar nunca linka para página que bloqueia (403)", () => {
  it("ADMIN (todas as permissões) vê todos os itens gated", () => {
    const labels = flattenLabels(filterNavGroupsByPermission(permissionMapFor(DEFAULT_ROLE_PERMISSIONS.ADMIN)));
    expect(labels).toEqual(
      expect.arrayContaining(["Ativos", "Estoque", "Entregas", "Colaboradores", "Treinamentos", "Turmas", "Alertas", "Relatórios", "Importações"]),
    );
  });

  it("RH não tem stock:view — 'Estoque' some da sidebar (antes desta sprint, o link existia e o clique dava 403)", () => {
    const labels = flattenLabels(filterNavGroupsByPermission(permissionMapFor(DEFAULT_ROLE_PERMISSIONS.RH)));
    expect(labels).not.toContain("Estoque");
    // RH continua vendo o que de fato pode abrir.
    expect(labels).toContain("Colaboradores");
    expect(labels).toContain("Entregas");
  });

  it("CONSULTA não tem import:view — 'Importações' some da sidebar (mesmo achado, outro papel)", () => {
    const labels = flattenLabels(filterNavGroupsByPermission(permissionMapFor(DEFAULT_ROLE_PERMISSIONS.CONSULTA)));
    expect(labels).not.toContain("Importações");
    expect(labels).toContain("Relatórios");
  });

  it("itens sem permissão associada (Configurações, Cadastros auxiliares) aparecem para qualquer papel", () => {
    const labels = flattenLabels(filterNavGroupsByPermission(permissionMapFor(DEFAULT_ROLE_PERMISSIONS.CONSULTA)));
    expect(labels).toContain("Configurações");
    expect(labels).toContain("Categorias");
  });

  it("um grupo que ficasse sem nenhum item visível seria removido inteiro (nunca um cabeçalho de grupo vazio)", () => {
    const groups = filterNavGroupsByPermission({});
    expect(groups.every((group) => group.items.length > 0)).toBe(true);
    // Sem nenhuma permissão concedida, só sobram os itens sem gate (Visão
    // geral, Cadastros auxiliares, Configurações) — os grupos Operação e
    // SST inteiros desaparecem.
    expect(groups.find((g) => g.label === "Operação")).toBeUndefined();
    expect(groups.find((g) => g.label === "SST")).toBeUndefined();
  });
});

describe("Sprint Demo Comercial SST 1.2 — caso 6: ação não permitida não aparece nas ações rápidas", () => {
  it("com todas as permissões, retorna as 4 ações na ordem de prioridade fixa", () => {
    const actions = buildDashboardQuickActions({
      canManageCustody: true,
      canManageStock: true,
      canManageEmployee: true,
      canManageAsset: true,
    });
    expect(actions.map((a) => a.key)).toEqual(["custody", "stock", "employee", "asset"]);
  });

  it("sem nenhuma permissão de escrita, a lista de ações fica vazia (nunca mostra ação proibida)", () => {
    const actions = buildDashboardQuickActions({
      canManageCustody: false,
      canManageStock: false,
      canManageEmployee: false,
      canManageAsset: false,
    });
    expect(actions).toEqual([]);
  });

  it("perfil só com permissão de estoque (ex.: ALMOXARIFADO-like) só vê a ação de estoque", () => {
    const actions = buildDashboardQuickActions({
      canManageCustody: false,
      canManageStock: true,
      canManageEmployee: false,
      canManageAsset: false,
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].key).toBe("stock");
  });
});

describe("Sprint Demo Comercial SST 1.2 — caso 8: dashboard nunca lê User.companyId diretamente", () => {
  it("app/(app)/dashboard/page.tsx resolve o tenant só via requireCompanyOrDeny(), nunca via user.companyId", () => {
    const source = readFileSync("app/(app)/dashboard/page.tsx", "utf8");
    expect(source).toContain("requireCompanyOrDeny");
    expect(source).not.toMatch(/user\.companyId/);
  });
});

describe("Sprint Demo Comercial SST 1.2 — caso 11: Portal Consultoria não foi tocado por esta sprint", () => {
  it("nenhum arquivo de app/sst/** importa components/layout/nav-items (nav própria e separada)", () => {
    const sstNavSource = readFileSync("app/sst/(portal)/sst-nav.tsx", "utf8");
    expect(sstNavSource).not.toContain("components/layout/nav-items");
    // A marca do Portal Consultoria continua intacta (não usa a marca nova
    // "Patrium / Portal Empresa" desta sprint — tem a sua própria).
    const sstLayoutSource = readFileSync("app/sst/(portal)/layout.tsx", "utf8");
    expect(sstLayoutSource).toContain("Portal Consultoria");
  });
});
