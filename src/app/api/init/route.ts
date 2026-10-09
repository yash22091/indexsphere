import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database-sqlite';

// Public first-run probe: only reports whether setup is needed.
export async function GET() {
  try {
    const users = await getDatabase().getUsers();
    const hasAdmin = users.some(u => u.role === 'admin');
    return NextResponse.json({ initialized: users.length > 0, hasAdmin, needsSetup: !hasAdmin });
  } catch (error) {
    console.error('Init check error:', error);
    return NextResponse.json({ initialized: false, hasAdmin: false, needsSetup: true });
  }
}
