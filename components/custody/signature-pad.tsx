"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { Button } from "@/components/ui/button";

/**
 * Assinatura desenhada num canvas (dedo/mouse/caneta) — mesmo mecanismo já
 * usado em app/(app)/custodies/custody-documents-dialog.tsx para assinar um
 * termo depois de gerado, só que aqui embutido inline no próprio formulário
 * de entrega, para capturar a assinatura no mesmo passo. `onChange` recebe
 * a imagem como data URL PNG (ou `null` quando o canvas está vazio).
 */
export function SignaturePad({
  onChange,
  disabled,
}: {
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  function getCanvasPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = getCanvasPoint(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
    isDrawingRef.current = true;
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!isDrawingRef.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = getCanvasPoint(event);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1e293b";
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasDrawn) setHasDrawn(true);
  }

  function handlePointerUp() {
    if (isDrawingRef.current) {
      onChange(canvasRef.current?.toDataURL("image/png") ?? null);
    }
    isDrawingRef.current = false;
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
    onChange(null);
  }

  return (
    <div className="grid gap-2">
      <canvas
        ref={canvasRef}
        width={480}
        height={160}
        className="w-full touch-none rounded-lg border bg-white"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Assine com o dedo, caneta ou mouse.</p>
        <Button type="button" variant="ghost" size="sm" onClick={clearCanvas} disabled={disabled}>
          Limpar
        </Button>
      </div>
    </div>
  );
}
