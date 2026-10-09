import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const response = await fetch(`${process.env.WORKER_URL ?? 'http://127.0.0.1:8001'}/scenes?date_from=${encodeURIComponent(body.dateFrom)}&date_to=${encodeURIComponent(body.dateTo)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body.geometry), cache: 'no-store'
    });
    return new NextResponse(await response.text(), { status: response.status, headers: { 'Content-Type': 'application/json' } });
  } catch (error) { return NextResponse.json({ detail: String(error) }, { status: 502 }); }
}
