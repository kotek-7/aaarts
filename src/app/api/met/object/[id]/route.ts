export const runtime = "nodejs";

function objectUrl(id: string) {
  return `https://collectionapi.metmuseum.org/public/collection/v1/objects/${encodeURIComponent(id)}`;
}

async function fetchWithRetry(url: string, init: RequestInit = {}, retries = 2, backoffMs = 200) {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      const c = new AbortController();
      const timer = setTimeout(() => c.abort(), 10_000);
      const r = await fetch(url, { ...init, signal: c.signal, cache: "no-store" });
      clearTimeout(timer);
      if (!r.ok && r.status >= 500 && i < retries) {
        await new Promise((res) => setTimeout(res, backoffMs * (i + 1)));
        continue;
      }
      return r;
    } catch (e) {
      lastErr = e;
      if (i < retries) {
        await new Promise((res) => setTimeout(res, backoffMs * (i + 1)));
        continue;
      }
    }
  }
  throw lastErr;
}

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const { id } = ctx.params;
  if (!id) {
    return new Response(JSON.stringify({ error: "Missing id" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  try {
    const r = await fetchWithRetry(objectUrl(id));
    const headers = new Headers();
    const ct = r.headers.get("content-type") || "application/json; charset=utf-8";
    headers.set("content-type", ct);
    return new Response(r.body, { status: r.status, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Failed to fetch object" }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
