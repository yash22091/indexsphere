import { NextRequest, NextResponse } from 'next/server';
import { secureCookies } from '@/lib/cookies';
import { getUserFromRequest } from '@/lib/auth';
import { clearClickHouseSession, clearClusterSession } from '@/lib/cluster-session';

export async function POST(request: NextRequest) {
  try {
    // Drop the user's server-side cluster session
    const user = getUserFromRequest(request);
    if (user) {
      clearClusterSession(user.id);
      clearClickHouseSession(user.id);
    }

    // Clear the authentication cookie
    const response = NextResponse.json({ success: true, message: 'Logged out successfully' });
    
    response.cookies.set('auth-token', '', {
      httpOnly: true,
      secure: secureCookies(),
      sameSite: 'strict',
      maxAge: 0, // Expire immediately
      path: '/'
    });

    return response;

  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
