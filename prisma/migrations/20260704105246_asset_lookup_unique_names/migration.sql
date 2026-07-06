-- AlterTable: nome único por empresa nos cadastros de apoio de ativos —
-- antes era possível cadastrar duas categorias/status/condições/fabricantes
-- com o mesmo nome (sem tela de gestão, isso nunca tinha acontecido na
-- prática; confirmado sem duplicados existentes antes desta migration).
CREATE UNIQUE INDEX "AssetCategory_companyId_name_key" ON "AssetCategory"("companyId", "name");

CREATE UNIQUE INDEX "Manufacturer_companyId_name_key" ON "Manufacturer"("companyId", "name");

CREATE UNIQUE INDEX "Supplier_companyId_corporateName_key" ON "Supplier"("companyId", "corporateName");

CREATE UNIQUE INDEX "AssetStatus_companyId_name_key" ON "AssetStatus"("companyId", "name");

CREATE UNIQUE INDEX "AssetCondition_companyId_name_key" ON "AssetCondition"("companyId", "name");
