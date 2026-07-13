"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui/react";

import { Label } from "@/components/ui/label";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import type { EmployeeOption } from "../types";

// Etapa 1 do wizard — Sprint Demo Comercial, Parte 4. `employees` já vem
// escopado à empresa e filtrado a ACTIVE pelo Server Component (Parte 2:
// nunca lista colaborador de outra empresa nem inativo) — este componente
// só decide COMO mostrar, nunca amplia o conjunto recebido.
export function StepEmployee({
  employees,
  selectedEmployee,
  onSelect,
  query,
  onQueryChange,
  disabled,
}: {
  employees: EmployeeOption[];
  selectedEmployee: EmployeeOption | null;
  onSelect: (employee: EmployeeOption | null) => void;
  query: string;
  onQueryChange: (query: string) => void;
  disabled?: boolean;
}) {
  const filter = ComboboxPrimitive.useFilter({ sensitivity: "base" });

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-lg font-medium">Colaborador</h2>
        <p className="text-sm text-muted-foreground">Selecione quem receberá o item.</p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="wizard-employee">Buscar colaborador</Label>
        <Combobox
          items={employees}
          value={selectedEmployee}
          onValueChange={onSelect}
          inputValue={query}
          onInputValueChange={onQueryChange}
          itemToStringLabel={(employee) => employee.name}
          isItemEqualToValue={(item, value) => item.id === value.id}
          filter={(employee, q) =>
            q.trim().length >= 3 && filter.contains(employee, q, (e) => `${e.name} ${e.document}`)
          }
          disabled={disabled}
        >
          <ComboboxInput
            id="wizard-employee"
            placeholder="Digite ao menos 3 letras do nome..."
            showTrigger={false}
            aria-describedby="wizard-employee-hint"
          />
          <ComboboxContent>
            <ComboboxEmpty>
              {query.trim().length < 3 ? "Digite ao menos 3 letras para buscar." : "Nenhum colaborador encontrado."}
            </ComboboxEmpty>
            <ComboboxList>
              {(employee: EmployeeOption) => (
                <ComboboxItem key={employee.id} value={employee}>
                  <span className="grid">
                    <span>{employee.name}</span>
                    {employee.position || employee.department ? (
                      <span className="text-xs text-muted-foreground">
                        {[employee.position, employee.department].filter(Boolean).join(" · ")}
                      </span>
                    ) : null}
                  </span>
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
        <p id="wizard-employee-hint" className="text-xs text-muted-foreground">
          Somente colaboradores ativos aparecem na busca.
        </p>
      </div>

      {selectedEmployee ? (
        <div className="grid gap-1 rounded-lg border bg-muted/30 p-3">
          <p className="font-medium">{selectedEmployee.name}</p>
          <p className="text-sm text-muted-foreground">
            {[selectedEmployee.position, selectedEmployee.department].filter(Boolean).join(" · ")}
          </p>
          <p className="text-xs text-muted-foreground">Situação: Ativo</p>
        </div>
      ) : null}
    </div>
  );
}
