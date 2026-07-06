"use client";

import { useRef, useState } from "react";
import { CameraIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { compressImageFile } from "@/lib/image-compress";

const MAX_PHOTOS = 5;

/**
 * Seletor de até 5 fotos (câmera do celular ou galeria) — cada uma
 * comprimida no client (lib/image-compress.ts) antes de virar data URL,
 * pra manter o payload pequeno. Usado na entrega (foto do estado do item
 * ao entregar) e na devolução (foto do estado ao devolver).
 */
export function PhotoPicker({
  photos,
  onChange,
  disabled,
  label = "Fotos do ativo",
}: {
  photos: string[];
  onChange: (photos: string[]) => void;
  disabled?: boolean;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const remaining = MAX_PHOTOS - photos.length;
    const selected = Array.from(files).slice(0, remaining);

    setIsProcessing(true);
    try {
      const compressed = await Promise.all(selected.map((file) => compressImageFile(file)));
      onChange([...photos, ...compressed]);
    } catch {
      // Falha ao processar uma imagem (formato não suportado, etc.) não
      // deve travar o restante do formulário — simplesmente ignora as que
      // já foram processadas com sucesso.
    } finally {
      setIsProcessing(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function removePhoto(index: number) {
    onChange(photos.filter((_, i) => i !== index));
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{label}</p>
        <span className="text-xs text-muted-foreground">{photos.length}/{MAX_PHOTOS}</span>
      </div>

      {photos.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {photos.map((photo, index) => (
            <div key={index} className="group relative size-20 shrink-0 overflow-hidden rounded-lg border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo} alt={`Foto ${index + 1}`} className="size-full object-cover" />
              <button
                type="button"
                aria-label="Remover foto"
                onClick={() => removePhoto(index)}
                disabled={disabled}
                className="absolute top-1 right-1 flex size-5 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white"
              >
                <XIcon className="size-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {photos.length < MAX_PHOTOS ? (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            disabled={disabled || isProcessing}
            onClick={() => inputRef.current?.click()}
          >
            <CameraIcon className="size-4" />
            {isProcessing ? "Processando..." : "Adicionar foto"}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            onChange={(event) => handleFiles(event.target.files)}
          />
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Limite de {MAX_PHOTOS} fotos atingido.</p>
      )}
    </div>
  );
}
