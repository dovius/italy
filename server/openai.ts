export class ServiceError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function requireKey() {
  if (!process.env.OPENAI_API_KEY) {
    throw new ServiceError(503, 'not_configured', 'Vertėjas dar neparuoštas. Paprašykite kelionės organizatoriaus jį įjungti.');
  }
}

// Native fetch keeps the backend small and follows the documented Live HTTP contract.
// No upstream payload, request body or key is logged or forwarded as an error.
export async function openaiRequest(path: string, body?: unknown, timeout = 60_000): Promise<Response> {
  requireKey();
  const multipart = body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(`https://api.openai.com/v1/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        ...(!multipart && body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    throw new ServiceError(504, 'upstream_timeout', 'Ryšys su vertėju užtruko. Pabandykite dar kartą – jūsų tekstas ir nuotrauka išliko.');
  }
  if (!response.ok) {
    // Consume the response without reflecting potentially sensitive diagnostics.
    await response.arrayBuffer();
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      throw new ServiceError(503, 'service_unavailable', 'Vertėjas šiuo metu nepasiekiamas. Paprašykite kelionės organizatoriaus patikrinti paslaugą.');
    }
    if (response.status === 429) {
      throw new ServiceError(429, 'busy', 'Vertėjas dabar užimtas. Palaukite minutę ir pabandykite dar kartą.');
    }
    throw new ServiceError(502, 'upstream_error', 'Nepavyko gauti vertimo. Palaukite kelias akimirkas ir pabandykite dar kartą.');
  }
  return response;
}
