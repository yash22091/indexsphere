"use client";

import { redirect } from 'next/navigation';
import { useEffect } from 'react';

// Dashboard is an alias for Overview page
export default function DashboardPage() {
  useEffect(() => {
    redirect('/overview');
  }, []);

  return null;
}
