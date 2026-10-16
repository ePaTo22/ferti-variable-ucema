import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const maxDuration = 120;
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (file instanceof File && file.size > 25 * 1024 * 1024) return NextResponse.json({ detail: 'El archivo supera 25 MB.' }, { status: 413 });
    const response = await fetch(`${process.env.WORKER_URL ?? 'http://127.0.0.1:8001'}/process`, { method: 'POST', body: form, cache: 'no-store' });
    const text = await response.text();
    let payload: unknown;
    try { payload = JSON.parse(text); }
    catch { return NextResponse.json({ detail: 'El servicio geoespacial respondió un error no válido. Revisá los logs del worker en Vercel.' }, { status: 502 }); }
    return NextResponse.json(payload, { status: response.status });
  } catch (error) { return NextResponse.json({ detail: String(error) }, { status: 502 }); }
}
