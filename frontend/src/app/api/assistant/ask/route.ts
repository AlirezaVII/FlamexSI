/**
 * Streams Ask FlamexSI from the backend to the browser line by line. The generic /api
 * rewrite proxy can hold a streamed response back (on Vercel the stages then arrive in
 * bursts); this route passes every chunk on as soon as it arrives.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const backend = process.env.FALMEX_BACKEND_URL;
  if (!backend) return Response.json({ detail: "The assistant is not configured on this server" }, { status: 503 });
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  let upstream: Response;
  try {
    upstream = await fetch(`${backend}/api/assistant/ask`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": forwarded },
      body: await req.text(),
      signal: req.signal,
      cache: "no-store",
    });
  } catch {
    return Response.json({ detail: "The analysis server did not respond. Please try again." }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body)
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
    });
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
