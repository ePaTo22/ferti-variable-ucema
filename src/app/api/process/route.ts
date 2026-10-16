import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const maxDuration = 120;
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type');
    if (!contentType?.startsWith('multipart/form-data')) return NextResponse.json({ detail: 'Se esperaba un formulario multipart.' }, { status: 415 });
    const response = await fetch(`${process.env.WORKER_URL ?? 'http://127.0.0.1:8001'}/process`, {
      method: 'POST', body: req.body, headers: { 'Content-Type': contentType }, cache: 'no-store',
      // Node.js requires this when forwarding a request body stream.
      // @ts-expect-error -- `duplex` is available in Node's fetch implementation.
      duplex: 'half',
    });
    const text = await response.text();
    let payload: unknown;
    try { payload = JSON.parse(text); }
    catch { return NextResponse.json({ detail: 'El servicio geoespacial respondió un error no válido. Revisá los logs del worker en Vercel.' }, { status: 502 }); }
    return NextResponse.json(payload, { status: response.status });
  } catch (error) { return NextResponse.json({ detail: String(error) }, { status: 502 }); }
}
