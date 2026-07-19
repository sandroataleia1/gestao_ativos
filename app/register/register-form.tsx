"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircleIcon,
  Building2Icon,
  EyeIcon,
  EyeOffIcon,
  FileTextIcon,
  Loader2Icon,
  LockIcon,
  MailIcon,
  PhoneIcon,
  UserIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { isValidBrazilianMobilePhone, maskBrazilianMobilePhone } from "@/lib/phone-mask";
import { isValidCnpj, maskCnpjInput } from "@/lib/cnpj";
import { focusFirstFieldWithError } from "@/lib/form-focus";
import { resolveRegisterSuccessOutcome, type RegisterSuccessBody } from "@/lib/register-response";

const MIN_PASSWORD_LENGTH = 8;

type FieldErrors = {
  companyName?: string;
  cnpj?: string;
  name?: string;
  email?: string;
  phone?: string;
  password?: string;
  confirmPassword?: string;
};

type FormValues = {
  companyName: string;
  cnpj: string;
  name: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
};

function validate(values: FormValues): FieldErrors {
  const errors: FieldErrors = {};

  if (!values.companyName.trim()) {
    errors.companyName = "Informe o nome da empresa.";
  }

  if (!values.cnpj.trim()) {
    errors.cnpj = "Informe o CNPJ da empresa.";
  } else if (!isValidCnpj(values.cnpj)) {
    errors.cnpj = "Informe um CNPJ válido.";
  }

  if (!values.name.trim()) {
    errors.name = "Informe seu nome.";
  }

  if (!values.email.trim()) {
    errors.email = "Informe seu email.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
    errors.email = "Informe um email válido.";
  }

  // Celular é opcional — só valida o formato se algo foi digitado.
  if (values.phone.trim() && !isValidBrazilianMobilePhone(values.phone)) {
    errors.phone = "Informe um celular válido, com DDD (ex.: (11) 98765-4321).";
  }

  if (!values.password) {
    errors.password = "Informe uma senha.";
  } else if (values.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }

  if (!values.confirmPassword) {
    errors.confirmPassword = "Confirme sua senha.";
  } else if (values.password && values.confirmPassword !== values.password) {
    errors.confirmPassword = "As senhas não coincidem.";
  }

  return errors;
}

const EMPTY_VALUES: FormValues = {
  companyName: "",
  cnpj: "",
  name: "",
  email: "",
  phone: "",
  password: "",
  confirmPassword: "",
};

export function RegisterForm() {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(EMPTY_VALUES);
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Sprint SST 1.4C.1 — mensagem intermediária durante o redirecionamento
  // pós-cadastro (nunca um erro, nunca some antes do router.push concluir a
  // navegação). `isSubmitting` continua true nesse intervalo — o botão
  // permanece desabilitado, o que já impede submissão duplicada.
  const [redirectMessage, setRedirectMessage] = useState<string | null>(null);

  function setField<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const errors = validate(values);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      focusFirstFieldWithError(errors, [
        "companyName",
        "cnpj",
        "name",
        "email",
        "phone",
        "password",
        "confirmPassword",
      ]);
      return;
    }

    setIsSubmitting(true);
    let response: Response;
    try {
      response = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: values.companyName,
          cnpj: values.cnpj,
          name: values.name,
          email: values.email,
          phone: values.phone,
          password: values.password,
        }),
      });
    } catch {
      setIsSubmitting(false);
      setFormError("Não foi possível conectar ao servidor. Tente novamente.");
      return;
    }

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      setIsSubmitting(false);
      setFormError(data?.error ?? "Não foi possível criar a conta.");
      return;
    }

    // /api/register cria a conta e já auto-aprova a CompanyClaimRequest na
    // mesma requisição (ver app/api/register/route.ts) — toda tentativa
    // bem-sucedida devolve `{ ok: true, status: "ACTIVE" }` e o destino é
    // direto /dashboard, via resolveRegisterSuccessOutcome. Nunca depende de
    // CNPJ na query string nem de um companyId devolvido pelo servidor — o
    // redirecionamento é resolvido só a partir do `status` da resposta.
    const data = (await response.json().catch(() => null)) as RegisterSuccessBody;
    const outcome = resolveRegisterSuccessOutcome(data);
    setRedirectMessage(outcome.message);
    // `isSubmitting` continua true durante o redirecionamento — o botão
    // permanece desabilitado, impedindo um segundo submit acidental
    // enquanto a navegação está em andamento.
    router.push(outcome.redirectTo);
    router.refresh();
  }

  return (
    // method="post": se o JS falhar por algum motivo e o form cair no
    // submit nativo do navegador, ele não deve virar um GET (que jogaria a
    // senha na query string/URL/histórico).
    <form
      onSubmit={handleSubmit}
      noValidate
      method="post"
      className="grid gap-4"
    >
      {redirectMessage ? (
        <Alert>
          <Loader2Icon className="animate-spin" />
          <AlertDescription>{redirectMessage}</AlertDescription>
        </Alert>
      ) : formError ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor="companyName">Nome da empresa</Label>
        <div className="relative">
          <Building2Icon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="companyName"
            name="companyName"
            autoComplete="organization"
            autoFocus
            placeholder="Minha Empresa Ltda"
            value={values.companyName}
            onChange={(event) => setField("companyName", event.target.value)}
            aria-invalid={Boolean(fieldErrors.companyName)}
            disabled={isSubmitting}
            className="pl-8"
          />
        </div>
        {fieldErrors.companyName ? (
          <p className="text-sm text-destructive">{fieldErrors.companyName}</p>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="cnpj">CNPJ</Label>
        <div className="relative">
          <FileTextIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="cnpj"
            name="cnpj"
            inputMode="numeric"
            autoComplete="off"
            placeholder="00.000.000/0000-00"
            value={values.cnpj}
            onChange={(event) => setField("cnpj", maskCnpjInput(event.target.value))}
            aria-invalid={Boolean(fieldErrors.cnpj)}
            disabled={isSubmitting}
            className="pl-8"
          />
        </div>
        {fieldErrors.cnpj ? <p className="text-sm text-destructive">{fieldErrors.cnpj}</p> : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="name">Seu nome</Label>
        <div className="relative">
          <UserIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="name"
            name="name"
            autoComplete="name"
            placeholder="Seu nome completo"
            value={values.name}
            onChange={(event) => setField("name", event.target.value)}
            aria-invalid={Boolean(fieldErrors.name)}
            disabled={isSubmitting}
            className="pl-8"
          />
        </div>
        {fieldErrors.name ? <p className="text-sm text-destructive">{fieldErrors.name}</p> : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <div className="relative">
          <MailIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="voce@empresa.com"
            value={values.email}
            onChange={(event) => setField("email", event.target.value)}
            aria-invalid={Boolean(fieldErrors.email)}
            disabled={isSubmitting}
            className="pl-8"
          />
        </div>
        {fieldErrors.email ? <p className="text-sm text-destructive">{fieldErrors.email}</p> : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="phone">Celular (opcional)</Label>
        <div className="relative">
          <PhoneIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="phone"
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            placeholder="(11) 98765-4321"
            value={values.phone}
            onChange={(event) => setField("phone", maskBrazilianMobilePhone(event.target.value))}
            aria-invalid={Boolean(fieldErrors.phone)}
            disabled={isSubmitting}
            className="pl-8"
          />
        </div>
        {fieldErrors.phone ? <p className="text-sm text-destructive">{fieldErrors.phone}</p> : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="password">Senha</Label>
        <div className="relative">
          <LockIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={values.password}
            onChange={(event) => setField("password", event.target.value)}
            aria-invalid={Boolean(fieldErrors.password)}
            disabled={isSubmitting}
            className="pl-8 pr-8"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
            onClick={() => setShowPassword((value) => !value)}
            tabIndex={-1}
            aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
          >
            {showPassword ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
          </Button>
        </div>
        {fieldErrors.password ? (
          <p className="text-sm text-destructive">{fieldErrors.password}</p>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="confirmPassword">Confirmar senha</Label>
        <div className="relative">
          <LockIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={values.confirmPassword}
            onChange={(event) => setField("confirmPassword", event.target.value)}
            aria-invalid={Boolean(fieldErrors.confirmPassword)}
            disabled={isSubmitting}
            className="pl-8"
          />
        </div>
        {fieldErrors.confirmPassword ? (
          <p className="text-sm text-destructive">{fieldErrors.confirmPassword}</p>
        ) : null}
      </div>

      <Button type="submit" disabled={isSubmitting} className="mt-2">
        {isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
        Criar conta
      </Button>
    </form>
  );
}
