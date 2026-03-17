"use client";

/**
 * SecurityGuard — mounted once in the root layout.
 *
 * When Traffic Security Lock is ON (from DB):
 *   - Attaches keyboard/right-click blocking
 *   - Polls for DevTools open state every second
 *   - If DevTools detected → shows a full-screen lockout overlay
 *
 * When Debug Mode is active (admin entered the debug password):
 *   - All protections off
 *   - Shows a red "DEBUG MODE — TRAFFIC INSPECTION ACTIVE" banner
 */

import { useEffect, useState, useCallback } from "react";
import {
  attachBrowserLock, detachBrowserLock,
  isDevToolsOpen, isDebugMode, clearDebugMode,
  writeLockState, readLockState, calibrateDevToolsBaseline,
} from "@/lib/security-guardian";
import { ShieldOff, Bug, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function SecurityGuard() {
  const [lockEnabled, setLockEnabled] = useState(false);
  const [devToolsDetected, setDevToolsDetected] = useState(false);
  const [debugActive, setDebugActive] = useState(false);

  // Fetch lock status from server once on mount; also read cached state
  // from localStorage so the guard reacts instantly when the auth-config
  // page enables the lock during the same browser session.
  useEffect(() => {
    // 1. Calibrate DevTools size baseline before any DevTools might open
    calibrateDevToolsBaseline();

    // 2. Check localStorage for a cached lock state (instant)
    const cached = readLockState();
    if (cached !== null) setLockEnabled(cached);

    // 3. Fetch authoritative state from server
    fetch("/api/settings/security", { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        const enabled = d.lockEnabled ?? false;
        setLockEnabled(enabled);
        writeLockState(enabled); // keep cache in sync
      })
      .catch(() => {});

    // 4. Listen for storage events fired by the auth-config page when the
    //    user toggles the lock, so this component reacts immediately.
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'is:secLock') setLockEnabled(e.newValue === '1');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // React to lock state
  useEffect(() => {
    const debug = isDebugMode();
    setDebugActive(debug);
    if (!lockEnabled || debug) {
      detachBrowserLock();
      return;
    }
    attachBrowserLock();
    return () => detachBrowserLock();
  }, [lockEnabled]);

  // Poll for DevTools while lock is active and debug is off
  useEffect(() => {
    if (!lockEnabled || debugActive) { setDevToolsDetected(false); return; }
    const id = setInterval(() => {
      setDevToolsDetected(isDevToolsOpen());
      // Also re-check if debug mode was enabled in another component
      if (isDebugMode()) { setDebugActive(true); }
    }, 1000);
    return () => clearInterval(id);
  }, [lockEnabled, debugActive]);

  const exitDebug = useCallback(() => {
    clearDebugMode();
    setDebugActive(false);
    attachBrowserLock();
  }, []);

  // ── DevTools lockout overlay ──────────────────────────────────────────────
  if (lockEnabled && !debugActive && devToolsDetected) {
    return (
      <div
        className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/95 text-white select-none"
        onContextMenu={e => e.preventDefault()}
      >
        <Lock className="h-16 w-16 text-red-500 mb-6" />
        <h1 className="text-3xl font-bold mb-2">Session Locked</h1>
        <p className="text-muted-foreground text-center max-w-md mb-6">
          Dev-tools inspection is disabled while Traffic Security Lock is active.
          Close DevTools to resume, or enter Debug Mode from Settings → Security.
        </p>
        <p className="text-xs text-zinc-600">IndexSphere Traffic Security Lock</p>
      </div>
    );
  }

  // ── Debug mode banner (non-blocking, always on top) ─────────────────────
  if (debugActive) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[9998] bg-red-600 text-white px-4 py-1.5 flex items-center justify-between text-sm font-semibold">
        <div className="flex items-center gap-2">
          <Bug className="h-4 w-4" />
          DEBUG MODE — Traffic inspection is enabled. All actions are being logged.
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-xs border-white/50 text-white hover:bg-red-700"
          onClick={exitDebug}
        >
          <ShieldOff className="h-3 w-3 mr-1" /> Exit Debug Mode
        </Button>
      </div>
    );
  }

  return null;
}
