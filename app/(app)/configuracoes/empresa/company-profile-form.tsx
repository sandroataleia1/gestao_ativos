"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ImageIcon, Loader2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { maskBrazilianPhone, maskCEP, maskCNPJ, maskUF } from "@/lib/masks";
import { compressImageFile } from "@/lib/image-compress";
import { focusFirstFieldWithError } from "@/lib/form-focus";

type CompanyProfile = {
  name: string;
  tradeName: string | null;
  document: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  responsibleName: string | null;
  logoDataUrl: string | null;
};

export function CompanyProfileForm({ company }: { company: CompanyProfile }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [values, setValues] = useState({
    name: company.name,
    tradeName: company.tradeName ?? "",
    document: company.document ?? "",
    email: company.email ?? "",
    phone: company.phone ?? "",
    address: company.address ?? "",
    city: company.city ?? "",
    state: company.state ?? "",
    zipCode: company.zipCode ?? "",
    responsibleName: company.responsibleName ?? "",
  });
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(company.logoDataUrl);
  const [logoRemoved, setLogoRemoved] = useState(false);
  const [confirmRemoveLogo, setConfirmRemoveLogo] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isProcessingLogo, setIsProcessingLogo] = useState(false);

  function setField(key: keyof typeof values, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleLogoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsProcessingLogo(true);
    try {
      // Logo: menor e com mais compressão que uma foto de custódia — não
      // precisa de resolução alta, só de ficar legível no cabeçalho/termos.
      const dataUrl = await compressImageFile(file, 512, 0.85);
      setLogoDataUrl(dataUrl);
      setLogoRemoved(false);
    } catch {
      toast.error("Não foi possível processar a imagem.");
    } finally {
      setIsProcessingLogo(false);
    }
  }

  function handleRemoveLogo() {
    setLogoDataUrl(null);
    setLogoRemoved(true);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});
    setIsSubmitting(true);

    const payload: Record<string, unknown> = { ...values };
    if (logoRemoved) {
      payload.logoDataUrl = null;
    } else if (logoDataUrl && logoDataUrl !== company.logoDataUrl) {
      payload.logoDataUrl = logoDataUrl;
    }

    try {
      const response = await fetch("/api/company", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        if (data?.fieldErrors) {
          setFieldErrors(data.fieldErrors);
          focusFirstFieldWithError(data.fieldErrors, Object.keys(values), (key) => `company-${key}`);
        }
        setFormError(data?.error ?? "Não foi possível salvar.");
        return;
      }

      toast.success("Dados da empresa atualizados.");
      router.refresh();
    } catch {
      setFormError("Não foi possível conectar ao servidor.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6">
      {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Logo</CardTitle>
          <CardDescription>Aparece no cabeçalho, nos termos de custódia e na página de QR Code.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          <div className="flex size-20 shrink-0 items-center justify-center rounded-lg border bg-muted/30">
            {logoDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- data URL local, não passa pelo otimizador de imagem do Next
              <img src={logoDataUrl} alt="Logo da empresa" className="size-full rounded-lg object-contain p-1" />
            ) : (
              <ImageIcon className="size-6 text-muted-foreground" />
            )}
          </div>
          <div className="flex flex-col gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleLogoChange}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isProcessingLogo}
              onClick={() => fileInputRef.current?.click()}
            >
              {isProcessingLogo ? <Loader2Icon className="animate-spin" /> : null}
              {logoDataUrl ? "Trocar logo" : "Enviar logo"}
            </Button>
            {logoDataUrl ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmRemoveLogo(true)}>
                <XIcon />
                Remover
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmRemoveLogo} onOpenChange={setConfirmRemoveLogo}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover a logo?</AlertDialogTitle>
            <AlertDialogDescription>
              A logo deixa de aparecer no cabeçalho, nos termos de custódia e na página de QR Code
              assim que você salvar as alterações.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                handleRemoveLogo();
                setConfirmRemoveLogo(false);
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Dados da empresa</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="company-name">Razão social</Label>
            <Input
              id="company-name"
              value={values.name}
              onChange={(e) => setField("name", e.target.value)}
              disabled={isSubmitting}
              required
            />
            {fieldErrors.name ? <p className="text-sm text-destructive">{fieldErrors.name[0]}</p> : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="company-tradeName">Nome fantasia (opcional)</Label>
            <Input
              id="company-tradeName"
              value={values.tradeName}
              onChange={(e) => setField("tradeName", e.target.value)}
              disabled={isSubmitting}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="company-document">CNPJ (opcional)</Label>
            <Input
              id="company-document"
              value={values.document}
              onChange={(e) => setField("document", maskCNPJ(e.target.value))}
              placeholder="00.000.000/0000-00"
              disabled={isSubmitting}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="company-responsibleName">Responsável (opcional)</Label>
            <Input
              id="company-responsibleName"
              value={values.responsibleName}
              onChange={(e) => setField("responsibleName", e.target.value)}
              disabled={isSubmitting}
            />
            <p className="text-xs text-muted-foreground">
              Nome de quem responde pela empresa — aparece nos termos de custódia junto com a
              assinatura.
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="company-email">E-mail (opcional)</Label>
            <Input
              id="company-email"
              type="email"
              value={values.email}
              onChange={(e) => setField("email", e.target.value)}
              disabled={isSubmitting}
              aria-invalid={Boolean(fieldErrors.email)}
            />
            {fieldErrors.email ? <p className="text-sm text-destructive">{fieldErrors.email[0]}</p> : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="company-phone">Telefone (opcional)</Label>
            <Input
              id="company-phone"
              value={values.phone}
              onChange={(e) => setField("phone", maskBrazilianPhone(e.target.value))}
              placeholder="(00) 00000-0000"
              disabled={isSubmitting}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Endereço</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="company-address">Endereço (opcional)</Label>
            <Input
              id="company-address"
              value={values.address}
              onChange={(e) => setField("address", e.target.value)}
              disabled={isSubmitting}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="company-city">Cidade (opcional)</Label>
            <Input
              id="company-city"
              value={values.city}
              onChange={(e) => setField("city", e.target.value)}
              disabled={isSubmitting}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="company-state">UF (opcional)</Label>
              <Input
                id="company-state"
                value={values.state}
                onChange={(e) => setField("state", maskUF(e.target.value))}
                placeholder="SP"
                disabled={isSubmitting}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="company-zipCode">CEP (opcional)</Label>
              <Input
                id="company-zipCode"
                value={values.zipCode}
                onChange={(e) => setField("zipCode", maskCEP(e.target.value))}
                placeholder="00000-000"
                disabled={isSubmitting}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
          Salvar alterações
        </Button>
      </div>
    </form>
  );
}
