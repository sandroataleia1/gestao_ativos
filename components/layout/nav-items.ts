import {
  AlertTriangleIcon,
  BarChart3Icon,
  BoxesIcon,
  Building2Icon,
  FactoryIcon,
  LayoutDashboardIcon,
  PackageIcon,
  SettingsIcon,
  TagIcon,
  TruckIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operacional",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboardIcon },
      { label: "Estoque", href: "/stock", icon: BoxesIcon },
      { label: "Entregas", href: "/custodies", icon: TruckIcon },
      { label: "Alertas", href: "/alerts", icon: AlertTriangleIcon },
    ],
  },
  {
    label: "Cadastros",
    items: [
      { label: "Ativos", href: "/assets", icon: PackageIcon },
      { label: "Colaboradores", href: "/employees", icon: UsersIcon },
      { label: "Categorias", href: "/cadastros/categorias", icon: TagIcon },
      { label: "Fabricantes", href: "/cadastros/fabricantes", icon: FactoryIcon },
      { label: "Fornecedores", href: "/cadastros/fornecedores", icon: Building2Icon },
    ],
  },
  {
    label: "Gestão",
    items: [
      { label: "Relatórios", href: "/reports", icon: BarChart3Icon },
      { label: "Configurações", href: "/configuracoes", icon: SettingsIcon },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);
