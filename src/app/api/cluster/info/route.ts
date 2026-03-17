import { NextRequest, NextResponse } from 'next/server';
import { sslBypassFetch } from '@/lib/ssl-bypass';

export async function POST(request: NextRequest) {
  try {
    const config = await request.json();
    const { url, auth } = config;

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // Prepare headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add authentication if provided
    if (auth && auth.username && auth.password) {
      const credentials = btoa(`${auth.username}:${auth.password}`);
      headers.Authorization = `Basic ${credentials}`;
    }

    // Make request to get cluster info with SSL bypass
    const response = await sslBypassFetch(`${url}/`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to get cluster info: ${response.statusText}`);
    }

    const info = await response.json();
    return NextResponse.json(info);

  } catch (error: any) {
    console.error('Cluster info error:', error);
    return NextResponse.json(
      { error: 'Failed to get cluster info', message: error.message },
      { status: 500 }
    );
  }
}
