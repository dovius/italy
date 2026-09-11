export async function prepareImage(file: File): Promise<string> {
  if (file.size > 25 * 1024 * 1024) throw new Error('Nuotrauka per didelė. Pasirinkite mažesnę arba nufotografuokite dar kartą.');
  if (!file.type.startsWith('image/')) throw new Error('Pasirinkite nuotrauką: JPG, PNG arba WebP failą.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 2000 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.86);
  } catch {
    throw new Error('Šios nuotraukos nepavyko atverti. Nufotografuokite per „Fotografuoti“ arba pasirinkite JPG, PNG ar WebP failą.');
  } finally { URL.revokeObjectURL(url); }
}
