export async function fetchTextWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 10_000,
  fetchImpl: typeof fetch = fetch,
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("timeoutMs must be positive");
  }

  const controller = new AbortController();
  const upstreamSignal = init.signal;
  const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);
  if (upstreamSignal?.aborted) abortFromUpstream();
  else upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });

  const timer = setTimeout(() => controller.abort(new Error("Jelly API request timed out")), timeoutMs);
  try {
    const response = await fetchImpl(input, { ...init, signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timer);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
}
