export class ServiceError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const localKey = () => typeof process === 'undefined' ? undefined : process.env.OPENAI_API_KEY;

export function requireKey(key: string | undefined = localKey()) {
  if (!key) {
    throw new ServiceError(503, 'not_configured', 'Vertėjas dar neparuoštas. Paprašykite kelionės organizatoriaus jį įjungti.');
  }
}

// Native fetch keeps the backend small and follows the documented Live HTTP contract.
// No upstream payload, request body or key is logged or forwarded as an error.
export const openaiRequest = (path: string, body?: unknown, timeout = 60_000): Promise<Response> => requestWithKey(localKey(), path, body, timeout);

// Workers inject secrets through bindings; the Node server continues to use .env.
export function createOpenAIRequest(key?: string): typeof openaiRequest {
  return (path, body, timeout = 60_000) => requestWithKey(key, path, body, timeout);
}

async function requestWithKey(key: string | undefined, path: string, body: unknown, timeout: number): Promise<Response> {
  requireKey(key);
  const multipart = body instanceof FormData;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let response: Response;
  try {
    response = await fetch(`https://api.openai.com/v1/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        ...(!multipart && body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new ServiceError(504, 'upstream_timeout', 'Ryšys su vertėju užtruko. Pabandykite dar kartą – jūsų tekstas ir nuotrauka išliko.');
  } finally { clearTimeout(timer); }
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
