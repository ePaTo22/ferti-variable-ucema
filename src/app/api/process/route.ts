import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const maxDuration = 120;
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (file instanceof File && file.size > 25 * 1024 * 1024) return NextResponse.json({ detail: 'El archivo supera 25 MB.' }, { status: 413 });
    const response = await fetch(`${process.env.WORKER_URL ?? 'http://127.0.0.1:8001'}/process`, { method: 'POST', body: form, cache: 'no-store' });
    return new NextResponse(await response.text(), { status: response.status, headers: { 'Content-Type': 'application/json' } });
  } catch (error) { return NextResponse.json({ detail: String(error) }, { status: 502 }); }
}
