export class ApiError extends Error {
  constructor(message: string, public code = 'network', public status = 0) { super(message); }
}

export async function request(path: string, body: unknown, signal?: AbortSignal, timeout = 70_000): Promise<Response> {
  if (!navigator.onLine) throw new ApiError('Nėra interneto ryšio. Jūsų tekstas ir nuotrauka išliko. Prisijungus galėsite tęsti.', 'offline');
  // Avoid AbortSignal.any/timeout, which are missing in older iPhone browsers.
  const controller = new AbortController();
  const cancelled = () => controller.abort();
  signal?.addEventListener('abort', cancelled, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
      body: body instanceof FormData ? body : JSON.stringify(body),
      signal: controller.signal,
      credentials: 'same-origin',
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new ApiError(data.error || 'Vertėjas nepasiekiamas. Pabandykite dar kartą po kelių akimirkų.', data.code, response.status);
    }
    return response;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    throw new ApiError('Ryšys nutrūko arba užtruko. Jūsų tekstas ir nuotrauka išliko. Pabandykite dar kartą.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancelled);
  }
}

export function mediaError(error: unknown, device = 'mikrofoną'): string {
  if (!window.isSecureContext) return 'Atverkite vertėją saugiu HTTPS adresu, kad telefonas galėtų įjungti mikrofoną ar kamerą.';
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') return `Naršyklės šios svetainės nustatymuose leiskite naudoti ${device}, tada pabandykite dar kartą.`;
    if (error.name === 'NotFoundError') return `Telefonas nerado mikrofono. Patikrinkite prijungtas ausines arba parašykite klausimą.`;
    if (error.name === 'NotReadableError') return 'Mikrofoną naudoja kita programa. Užbaikite kitą skambutį ir pabandykite dar kartą.';
  }
  return error instanceof Error ? error.message : 'Nepavyko įjungti mikrofono. Pabandykite dar kartą.';
}
