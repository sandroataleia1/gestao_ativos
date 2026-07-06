import { forbidden, redirect } from "next/navigation";

import { hasPermission, requireAuthOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";

// Cada cadastro de apoio agora tem página própria (ver ./categorias,
// ./fabricantes, ./fornecedores) e item próprio na sidebar, em vez de tudo
// dividido em abas nesta única página. Status e Condição de ativo não têm
// mais tela própria — são fixos, definidos só pelo seed. Quem acessa
// /cadastros diretamente (link antigo/favorito) é redirecionado para a
// primeira seção que tiver permissão de ver.
export default async function CadastrosPage() {
  await requireAuthOrDeny();

  const [canCategory, canManufacturer, canSupplier] = await Promise.all([
    hasPermission(PERMISSIONS.CATEGORY_MANAGE),
    hasPermission(PERMISSIONS.MANUFACTURER_MANAGE),
    hasPermission(PERMISSIONS.SUPPLIER_MANAGE),
  ]);

  if (canCategory) redirect("/cadastros/categorias");
  if (canManufacturer) redirect("/cadastros/fabricantes");
  if (canSupplier) redirect("/cadastros/fornecedores");
  forbidden();
}
