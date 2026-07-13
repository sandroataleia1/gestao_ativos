import {
  AlertTriangleIcon,
  BarChart3Icon,
  BoxesIcon,
  Building2Icon,
  CalendarClockIcon,
  FactoryIcon,
  FolderCogIcon,
  GraduationCapIcon,
  LayoutDashboardIcon,
  PackageIcon,
  SettingsIcon,
  TagIcon,
  TruckIcon,
  UploadIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

import { PERMISSIONS, type PermissionKey } from "@/lib/permissions";

// Sprint Demo Comercial SST 1.2 — reorganização da navegação do Portal
// Empresa para comunicar que a plataforma cobre SST/treinamentos além de
// ativos/estoque (ver relatório da sprint). Só a ORGANIZAÇÃO/rotulagem
// mudou — nenhum href novo, nenhuma permissão nova, nenhuma rota criada.
//
// `permission`: achado durante a validação manual desta sprint — vários
// destinos usam `requirePermissionOrDeny()` (bloqueio real, não só
// esconder botão de escrita) para uma permissão que nem todo papel padrão
// possui (ex.: RH não tem `stock:view`, CONSULTA não tem `import:view`).
// Antes desta sprint a sidebar mostrava o item mesmo assim, e o clique
// caía numa tela de acesso negado — viola "não mostrar itens de menu... que
// o usuário não pode utilizar" (Parte 2). Guardar aqui qual permissão cada
// item exige permite ao Server Component pai (app/(app)/layout.tsx)
// filtrar antes de passar para Sidebar/MobileNav — nenhuma permissão nova
// foi criada, só mapeada a permissões já existentes em lib/permissions.ts.
export type NavLeaf = {
  kind: "link";
  label: string;
  href: string;
  icon: LucideIcon;
  /** Texto completo, usado como tooltip/title quando o rótulo da sidebar é
   * mais compacto que o nome real da seção (ex.: "Entregas" → "Entregas e
   * devoluções") — nunca a única forma de transmitir a informação (o
   * rótulo visível já é compreensível sozinho). */
  description?: string;
  /** Permissão exigida pelo destino via `requirePermissionOrDeny()`.
   * `undefined` = qualquer usuário com acesso à empresa pode abrir (ex.:
   * Configurações, Cadastros auxiliares — a própria página decide o que
   * mostrar por dentro). */
  permission?: PermissionKey;
};

export type NavSubmenu = {
  kind: "submenu";
  label: string;
  icon: LucideIcon;
  items: NavLeaf[];
};

export type NavEntry = NavLeaf | NavSubmenu;

export type NavGroup = {
  label: string;
  items: NavEntry[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Visão geral",
    items: [{ kind: "link", label: "Visão geral", href: "/dashboard", icon: LayoutDashboardIcon }],
  },
  {
    label: "Operação",
    items: [
      { kind: "link", label: "Ativos", href: "/assets", icon: PackageIcon, permission: PERMISSIONS.ASSET_VIEW },
      { kind: "link", label: "Estoque", href: "/stock", icon: BoxesIcon, permission: PERMISSIONS.STOCK_VIEW },
      {
        kind: "link",
        label: "Entregas",
        href: "/custodies",
        icon: TruckIcon,
        description: "Entregas e devoluções",
        permission: PERMISSIONS.CUSTODY_VIEW,
      },
      {
        kind: "link",
        label: "Colaboradores",
        href: "/employees",
        icon: UsersIcon,
        permission: PERMISSIONS.EMPLOYEE_VIEW,
      },
    ],
  },
  {
    label: "SST",
    items: [
      {
        kind: "link",
        label: "Treinamentos",
        href: "/trainings",
        icon: GraduationCapIcon,
        permission: PERMISSIONS.TRAINING_VIEW,
      },
      {
        kind: "link",
        label: "Turmas",
        href: "/trainings/classes",
        icon: CalendarClockIcon,
        permission: PERMISSIONS.TRAINING_VIEW,
      },
      { kind: "link", label: "Alertas", href: "/alerts", icon: AlertTriangleIcon, permission: PERMISSIONS.ALERT_VIEW },
    ],
  },
  {
    label: "Gestão",
    items: [
      { kind: "link", label: "Relatórios", href: "/reports", icon: BarChart3Icon, permission: PERMISSIONS.REPORT_VIEW },
      { kind: "link", label: "Importações", href: "/imports", icon: UploadIcon, permission: PERMISSIONS.IMPORT_VIEW },
      {
        kind: "submenu",
        label: "Cadastros auxiliares",
        icon: FolderCogIcon,
        items: [
          { kind: "link", label: "Categorias", href: "/cadastros/categorias", icon: TagIcon },
          { kind: "link", label: "Fabricantes", href: "/cadastros/fabricantes", icon: FactoryIcon },
          { kind: "link", label: "Fornecedores", href: "/cadastros/fornecedores", icon: Building2Icon },
        ],
      },
      { kind: "link", label: "Configurações", href: "/configuracoes", icon: SettingsIcon },
    ],
  },
];

const ALL_LEAVES: NavLeaf[] = NAV_GROUPS.flatMap((group) =>
  group.items.flatMap((entry) => (entry.kind === "submenu" ? entry.items : [entry])),
);

export const NAV_ITEMS: NavLeaf[] = ALL_LEAVES;

/**
 * Item de navegação "ativo" para um pathname — o de maior prefixo entre os
 * que casam (`pathname === href` ou `pathname.startsWith(href + "/")`).
 * Necessário porque alguns hrefs são prefixo de outros (ex.: "/trainings" e
 * "/trainings/classes") — sem isso, os dois acenderiam juntos em
 * "/trainings/classes/...".
 */
export function getActiveNavHref(pathname: string): string | undefined {
  const matches = ALL_LEAVES.filter(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  if (matches.length === 0) return undefined;
  return matches.reduce((best, item) => (item.href.length > best.href.length ? item : best)).href;
}

/** Um submenu é "ativo" (deve abrir por padrão e destacar seu cabeçalho)
 * quando a rota atual corresponde a algum dos seus itens filhos. */
export function isSubmenuActive(pathname: string, submenu: NavSubmenu): boolean {
  const activeHref = getActiveNavHref(pathname);
  return submenu.items.some((item) => item.href === activeHref);
}

/**
 * Filtra NAV_GROUPS pelas permissões do usuário atual — nunca mostra um
 * item cujo destino bloquearia com "acesso negado" (`requirePermissionOrDeny`
 * no destino). Grupos/submenus que ficam sem nenhum item visível são
 * removidos inteiros (nunca um cabeçalho de grupo vazio). A checagem em si
 * (`hasPermission`) continua acontecendo do lado do servidor, em
 * app/(app)/layout.tsx — esta função só decide o que RENDERIZAR, nunca é a
 * fonte de autorização.
 */
export function filterNavGroupsByPermission(
  hasPermissionMap: Partial<Record<PermissionKey, boolean>>,
): NavGroup[] {
  const isVisible = (item: NavLeaf) => !item.permission || hasPermissionMap[item.permission] === true;

  return NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.items
      .map((entry): NavEntry | null => {
        if (entry.kind === "link") return isVisible(entry) ? entry : null;
        const visibleItems = entry.items.filter(isVisible);
        return visibleItems.length > 0 ? { ...entry, items: visibleItems } : null;
      })
      .filter((entry): entry is NavEntry => entry !== null),
  })).filter((group) => group.items.length > 0);
}
