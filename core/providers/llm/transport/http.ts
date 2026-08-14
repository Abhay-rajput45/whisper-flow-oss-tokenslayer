/** Raw HTTP: no parsing, no interpretation. The reader owns the body. */

export function withTimeout(timeoutMs: number): {
  signal: AbortSignal;
  cancel: () => void;
} {
  const controller = new AbortController();
  const timer: ReturnType<typeof setTimeout> = setTimeout(
    () => controller.abort(),
    timeoutMs,
  );
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
}
