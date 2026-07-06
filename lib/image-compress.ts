// Comprime/redimensiona uma foto no browser antes de mandar pro servidor —
// as fotos de entrega/devolução são guardadas como data URL direto no banco
// (mesmo padrão de CustodySignature.signatureData), então uma foto de
// câmera de celular sem compressão (vários MB) explodiria o tamanho do
// registro. Redimensiona para no máximo `maxDimension` no lado maior e
// reexporta como JPEG com a `quality` informada.
export async function compressImageFile(
  file: File,
  maxDimension = 1280,
  quality = 0.7,
): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não foi possível processar a imagem.");
  ctx.drawImage(bitmap, 0, 0, width, height);

  return canvas.toDataURL("image/jpeg", quality);
}
