import { NextResponse } from 'next/server';
export async function GET(){ return NextResponse.json({error:'Source not configured'},{status:503}); }
