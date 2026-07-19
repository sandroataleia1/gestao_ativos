-- Cadastro público de consultoria (app/sst/register) — impede duas
-- consultorias reais com o mesmo CNPJ; nulo continua permitido (registros
-- de seed/antigos sem document).
-- CreateIndex
CREATE UNIQUE INDEX "SstProvider_document_key" ON "SstProvider"("document");
