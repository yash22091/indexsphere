"use client";

import React, { createContext, useContext, useState, useCallback } from 'react';
import { ElasticsearchClient, setElasticsearchClient, clearElasticsearchClient } from '@/lib/elasticsearch';
import { ElasticsearchConnectionConfig } from '@/types';

interface SavedConnection extends ElasticsearchConnectionConfig {
  id: string;
  name: string;
  lastConnected: string;
}

interface ConnectionContextType {
  isConnected: boolean;
  connectionConfig: ElasticsearchConnectionConfig | null;
  connecting: boolean;
  connectionError: string | null;
  savedConnections: SavedConnection[];
  currentConnectionId: string | null;
  currentSavedConnectionId: string | null;
  connect: (config: ElasticsearchConnectionConfig) => Promise<void>;
  disconnect: () => void;
  testConnection: (config: ElasticsearchConnectionConfig) => Promise<{ success: boolean; serverType?: string; version?: string }>;
  saveConnection: (config: ElasticsearchConnectionConfig, name: string) => void;
  deleteConnection: (id: string) => void;
  selectConnection: (id: string) => Promise<void>;
  activateSavedConnection: (id: string | number, url: string, type?: string) => Promise<void>;
}

const ConnectionContext = createContext<ConnectionContextType | undefined>(undefined);

export function ConnectionProvider({ children }: { children: React.ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionConfig, setConnectionConfig] = useState<ElasticsearchConnectionConfig | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [savedConnections, setSavedConnections] = useState<SavedConnection[]>([]);
  const [currentConnectionId, setCurrentConnectionId] = useState<string | null>(null);
  const [currentSavedConnectionId, setCurrentSavedConnectionId] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);

  // Handle hydration
  React.useEffect(() => {
    setIsClient(true);
  }, []);

  // Load saved connections on mount
  React.useEffect(() => {
    if (!isClient) return;
    
    const saved = localStorage.getItem('elasticsearch-saved-connections');
    if (saved) {
      try {
        const connections = JSON.parse(saved);
        setSavedConnections(connections);
      } catch {
        localStorage.removeItem('elasticsearch-saved-connections');
      }
    }

    const savedSavedId = localStorage.getItem('current-saved-connection-id');
    if (savedSavedId) setCurrentSavedConnectionId(savedSavedId);

    // Re-attach to the user's server-side cluster session after a page reload
    fetch('/api/connect')
      .then(r => (r.ok ? r.json() : null))
      .then((data: { connected?: boolean; url?: string; serverType?: 'elasticsearch' | 'opensearch'; savedConnectionId?: string | null } | null) => {
        if (!data?.connected || !data.url) return;
        const config: ElasticsearchConnectionConfig = { url: data.url, type: data.serverType };
        setElasticsearchClient(new ElasticsearchClient(config));
        setConnectionConfig(config);
        setIsConnected(true);
        setCurrentSavedConnectionId(data.savedConnectionId ?? null);
      })
      .catch(() => {});
  }, [isClient]);

  const testConnection = useCallback(async (config: ElasticsearchConnectionConfig): Promise<{ success: boolean; serverType?: string; version?: string }> => {
    try {
      // Use the existing API route for testing
      const response = await fetch('/api/cluster/health', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      });

      if (!response.ok) {
        throw new Error(`Connection test failed: ${response.statusText}`);
      }

      await response.json();
      
      // Try to get cluster info to detect server type
      try {
        const infoResponse = await fetch('/api/cluster/info', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(config),
        });
        
        if (infoResponse.ok) {
          const info = await infoResponse.json();
          const serverType = info.version?.distribution === 'opensearch' ? 'opensearch' : 'elasticsearch';
          const version = info.version?.number;
          
          return { 
            success: true, 
            serverType,
            version
          };
        }
      } catch {
        // Fallback if we can't get detailed info
      }
      
      return { 
        success: true, 
        serverType: config.type || 'elasticsearch'
      };
    } catch (error: any) {
      console.error('Connection test failed:', error);
      throw new Error(error.message || 'Connection failed');
    }
  }, []);

  const connect = useCallback(async (config: ElasticsearchConnectionConfig) => {
    setConnecting(true);
    setConnectionError(null);

    try {
      // Open a server-side session for this user. Credentials go to the server
      // once and are never kept in the browser afterwards.
      const response = await fetch('/api/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      });

      if (!response.ok) {
        let detail = response.statusText;
        try { const body = await response.json(); detail = body.message ?? body.error ?? response.statusText; } catch {}
        throw new Error(detail);
      }

      const { auth: _auth, ...configWithoutAuth } = config;
      const client = new ElasticsearchClient(configWithoutAuth);
      setElasticsearchClient(client);
      setConnectionConfig(configWithoutAuth);
      setIsConnected(true);
      setConnectionError(null);
      setCurrentSavedConnectionId(null);

      if (isClient) {
        localStorage.setItem('elasticsearch-current-connection', JSON.stringify(configWithoutAuth));
        localStorage.removeItem('current-saved-connection-id');
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Connection failed';
      setConnectionError(errorMessage);
      throw error;
    } finally {
      setConnecting(false);
    }
  }, [isClient]);

  const disconnect = useCallback(() => {
    fetch('/api/connect', { method: 'DELETE' }).catch(() => {});
    clearElasticsearchClient();
    setConnectionConfig(null);
    setIsConnected(false);
    setConnectionError(null);
    setCurrentConnectionId(null);
    setCurrentSavedConnectionId(null);
    
    // Clear current connection (but keep saved connections)
    if (isClient) {
      localStorage.removeItem('elasticsearch-current-connection');
      localStorage.removeItem('current-saved-connection-id');
    }
  }, [isClient]);

  const saveConnection = useCallback((config: ElasticsearchConnectionConfig, name: string) => {
    if (!isClient) return;
    
    // Credentials are intentionally stripped before persisting to localStorage.
    // The `auth` field is kept in memory only for the current session.
    const { auth: _auth, ...configWithoutAuth } = config;
    const id = 'conn-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    const savedConnection: SavedConnection = {
      ...configWithoutAuth,
      id,
      name,
      lastConnected: new Date().toISOString(),
    };

    const updatedConnections = [...savedConnections, savedConnection];
    setSavedConnections(updatedConnections);
    localStorage.setItem('elasticsearch-saved-connections', JSON.stringify(updatedConnections));
  }, [savedConnections, isClient]);

  const deleteConnection = useCallback((id: string) => {
    if (!isClient) return;
    
    const updatedConnections = savedConnections.filter(conn => conn.id !== id);
    setSavedConnections(updatedConnections);
    localStorage.setItem('elasticsearch-saved-connections', JSON.stringify(updatedConnections));
    
    // If deleting current connection, disconnect
    if (currentConnectionId === id) {
      disconnect();
    }
  }, [savedConnections, currentConnectionId, disconnect, isClient]);

  const selectConnection = useCallback(async (id: string) => {
    const connection = savedConnections.find(conn => conn.id === id);
    if (!connection) return;

    try {
      await connect(connection);
      setCurrentConnectionId(id);
      
      // Update last connected time
      const updatedConnections = savedConnections.map(conn => 
        conn.id === id 
          ? { ...conn, lastConnected: new Date().toISOString() }
          : conn
      );
      setSavedConnections(updatedConnections);
      localStorage.setItem('elasticsearch-saved-connections', JSON.stringify(updatedConnections));
    } catch (error) {
      console.error('Failed to select connection:', error);
    }
  }, [savedConnections, connect]);

  // Activate a server-side saved connection (password stays server-side encrypted, never sent to browser)
  const activateSavedConnection = useCallback(async (id: string | number, url: string, type = 'elasticsearch') => {
    setConnecting(true);
    setConnectionError(null);
    try {
      const res = await fetch(`/api/saved-connections/${id}/connect`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Activation failed');

      // Register a browser-side proxy client (no auth — server already has the real client)
      const config: ElasticsearchConnectionConfig = { url, type: (data.serverType ?? type) as 'elasticsearch' | 'opensearch' };
      const client = new ElasticsearchClient(config);
      setElasticsearchClient(client);
      setConnectionConfig(config);
      setIsConnected(true);
      setConnectionError(null);
      setCurrentSavedConnectionId(String(id));
      if (isClient) {
        localStorage.setItem('current-saved-connection-id', String(id));
        localStorage.setItem('elasticsearch-current-connection', JSON.stringify({ url, type }));
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Connection failed';
      setConnectionError(msg);
      throw error;
    } finally {
      setConnecting(false);
    }
  }, [isClient]);

  // Remove auto-restore functionality - user must manually select connection

  const value: ConnectionContextType = {
    isConnected,
    connectionConfig,
    connecting,
    connectionError,
    savedConnections,
    currentConnectionId,
    currentSavedConnectionId,
    connect,
    disconnect,
    testConnection,
    saveConnection,
    deleteConnection,
    selectConnection,
    activateSavedConnection,
  };

  return (
    <ConnectionContext.Provider value={value}>
      {children}
    </ConnectionContext.Provider>
  );
}

export function useConnection() {
  const context = useContext(ConnectionContext);
  if (context === undefined) {
    throw new Error('useConnection must be used within a ConnectionProvider');
  }
  return context;
}
