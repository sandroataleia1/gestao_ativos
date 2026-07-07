"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ImportPanel } from "./import-panel";

export function ImportsTabs({ canManage }: { canManage: boolean }) {
  return (
    <Tabs defaultValue="employees">
      <TabsList>
        <TabsTrigger value="employees">Colaboradores</TabsTrigger>
        <TabsTrigger value="assets">Ativos</TabsTrigger>
        <TabsTrigger value="stock">Estoque inicial</TabsTrigger>
      </TabsList>

      <TabsContent value="employees">
        <ImportPanel
          type="employees"
          canManage={canManage}
          templates={[{ label: "Modelo — Colaboradores", templateType: "employees" }]}
        />
      </TabsContent>
      <TabsContent value="assets">
        <ImportPanel
          type="assets"
          canManage={canManage}
          templates={[{ label: "Modelo — Ativos", templateType: "assets" }]}
        />
      </TabsContent>
      <TabsContent value="stock">
        <ImportPanel
          type="stock"
          canManage={canManage}
          templates={[
            { label: "Modelo — Estoque consumível", templateType: "stock-consumable" },
            { label: "Modelo — Estoque individual", templateType: "stock-individual" },
          ]}
        />
      </TabsContent>
    </Tabs>
  );
}
