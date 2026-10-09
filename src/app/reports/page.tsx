'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Database, AlertTriangle, Download, FileText, Loader2, RefreshCw } from 'lucide-react';
import { EmptyState, HealthBadge, PageHeader, StatCard } from '@/components/app';
import { useConnection } from '@/contexts/connection-context';

interface ClusterInfo {
  cluster_name: string
  status: string
  timed_out: boolean
  number_of_nodes: number
  number_of_data_nodes: number
  active_primary_shards: number
  active_shards: number
  relocating_shards: number
  initializing_shards: number
  unassigned_shards: number
  delayed_unassigned_shards: number
  number_of_pending_tasks: number
  number_of_in_flight_fetch: number
  task_max_waiting_in_queue_millis: number
  active_shards_percent_as_number: number
}

interface NodeInfo {
  name: string
  transport_address: string
  host: string
  ip: string
  version: string
  build_flavor: string
  build_type: string
  build_hash: string
  roles: string[]
  attributes: Record<string, any>
  total_indexing_buffer: number
}

interface IndexInfo {
  health: string
  status: string
  index: string
  uuid: string
  pri: string
  rep: string
  'docs.count': string
  'docs.deleted': string
  'store.size': string
  'pri.store.size': string
}

export default function ReportsPage() {
  const { connectionConfig, isConnected, savedConnections, currentConnectionId, selectConnection } = useConnection()
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatingType, setGeneratingType] = useState<'pdf' | 'json' | null>(null)
  const [clusterInfo, setClusterInfo] = useState<ClusterInfo | null>(null)
  const [nodeInfo, setNodeInfo] = useState<NodeInfo[]>([])
  const [indexInfo, setIndexInfo] = useState<IndexInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [dataFetched, setDataFetched] = useState(false)

  // Get current connection details
  // Memoised so effects that depend on it only re-run when the connection actually changes
  const currentConnection = useMemo(() => connectionConfig ? (() => {
    try {
      const url = new URL(connectionConfig.url)
      return {
        ...connectionConfig,
        protocol: url.protocol.replace(':', ''),
        host: url.hostname,
        port: url.port || (url.protocol === 'https:' ? '443' : '80'),
        username: connectionConfig.auth?.username,
        password: connectionConfig.auth?.password,
        name: savedConnections.find((conn: any) => conn.id === currentConnectionId)?.name || 'Current Connection'
      }
    } catch (error) {
      console.error('Error parsing connection URL:', error)
      return null
    }
  })() : null, [connectionConfig, savedConnections, currentConnectionId])

  // fetchClusterData is declared below and recreated every render; the effect
  // calls the latest version through a ref so its trigger values stay unchanged.
  const fetchClusterDataRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    if (currentConnection && isConnected && !dataFetched) {
      fetchClusterDataRef.current()
    }
  }, [currentConnection, isConnected, dataFetched])

  const fetchClusterData = async () => {
    if (!currentConnection) return

    try {
      setError(null)
      setDataFetched(true) // Set flag to prevent continuous requests
      
      // Debug logging
      
      // Validate connection config
      if (!currentConnection.url) {
        setError('Invalid connection configuration. Please check your connection settings.')
        return
      }
      
      // The ES proxy uses this user's server-side cluster session — no config is sent
      // Fetch cluster health using es-proxy
      const healthResponse = await fetch('/api/es-proxy/_cluster/health', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (healthResponse.ok) {
        const healthData = await healthResponse.json()
        setClusterInfo(healthData)
      } else {
        const errorText = await healthResponse.text()
        console.error('Health check failed:', errorText)
        setError(`Failed to fetch cluster health: ${errorText}`)
      }

      // Fetch nodes info using es-proxy
      const nodesResponse = await fetch('/api/es-proxy/_nodes', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (nodesResponse.ok) {
        const nodesData = await nodesResponse.json()
        setNodeInfo(Object.values(nodesData.nodes || {}))
      }

      // Fetch indices info using es-proxy
      const indicesResponse = await fetch('/api/es-proxy/_cat/indices?format=json&bytes=b', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (indicesResponse.ok) {
        const indicesData = await indicesResponse.json()
        setIndexInfo(indicesData || [])
      }

    } catch (error) {
      console.error('Error fetching cluster data:', error)
      setError('Failed to fetch cluster data')
      setDataFetched(false) // Allow retry on error
    }
  }

  fetchClusterDataRef.current = fetchClusterData

  // Add refresh function
  const refreshData = () => {
    setDataFetched(false)
    setError(null)
    if (currentConnection && isConnected) {
      fetchClusterData()
    }
  }

  // Timeout wrapper for fetch requests
  const fetchWithTimeout = (url: string, options: any, timeout = 10000) => {
    return Promise.race([
      fetch(url, options),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout')), timeout)
      )
    ])
  }

  const generateReport = async (format: 'json' | 'pdf') => {
    if (!currentConnection) return

    try {
      setIsGenerating(true)
      setGeneratingType(format)
      setError(null)

      // Collect comprehensive cluster data for all report types
      const promises = [
        // Basic cluster info
        fetch('/api/es-proxy/_cluster/health', {
          headers: { 'Content-Type': 'application/json' }
        }).catch(() => null),
        
        // Cluster stats
        fetch('/api/es-proxy/_cluster/stats', {
          headers: { 'Content-Type': 'application/json' }
        }).catch(() => null),
        
        // Node information
        fetch('/api/es-proxy/_nodes/stats', {
          headers: { 'Content-Type': 'application/json' }
        }).catch(() => null),
        
        // Indices information
        fetch('/api/es-proxy/_cat/indices?format=json&bytes=b', {
          headers: { 'Content-Type': 'application/json' }
        }).catch(() => null),
        
        // Index stats
        fetch('/api/es-proxy/_stats', {
          headers: { 'Content-Type': 'application/json' }
        }).catch(() => null),
        
        // Shard allocation
        fetch('/api/es-proxy/_cat/shards?format=json', {
          headers: { 'Content-Type': 'application/json' }
        }).catch(() => null),
        
        // Index templates
        fetch('/api/es-proxy/_index_template', {
          headers: { 'Content-Type': 'application/json' }
        }).catch(() => null),
        
        // Cluster settings
        fetch('/api/es-proxy/_cluster/settings', {
          headers: { 'Content-Type': 'application/json' }
        }).catch(() => null),
        
        // Pending tasks
        fetch('/api/es-proxy/_cluster/pending_tasks', {
          headers: { 'Content-Type': 'application/json' }
        }).catch(() => null),
      ]

      const responses = await Promise.all(promises)
      
      // Parse all responses
      const [
        healthData,
        statsData, 
        nodesData,
        indicesData,
        indexStatsData,
        shardsData,
        templatesData,
        settingsData,
        tasksData
      ] = await Promise.all(
        responses.map(async (response, index) => {
          if (!response || !response.ok) {
            console.warn(`Failed to fetch data for request ${index}`)
            return null
          }
          try {
            return await response.json()
          } catch (error) {
            console.warn(`Failed to parse JSON for request ${index}:`, error)
            return null
          }
        })
      )

      // Create comprehensive report data
      const reportData = {
        metadata: {
          timestamp: new Date().toISOString(),
          generatedBy: 'IndexSphere',
          version: '1.0.0',
          connection: {
            name: currentConnection.name,
            url: currentConnection.url
          }
        },
        cluster: {
          health: healthData,
          stats: statsData,
          settings: settingsData,
          pendingTasks: tasksData,
          summary: healthData ? {
            name: healthData.cluster_name,
            status: healthData.status,
            nodes: healthData.number_of_nodes,
            dataNodes: healthData.number_of_data_nodes,
            activeShards: healthData.active_shards,
            primaryShards: healthData.active_primary_shards,
            unassignedShards: healthData.unassigned_shards,
            activeShardsPercent: healthData.active_shards_percent_as_number
          } : null
        },
        nodes: {
          stats: nodesData,
          summary: nodesData ? Object.keys(nodesData.nodes || {}).map(nodeId => {
            const node = nodesData.nodes[nodeId]
            return {
              id: nodeId,
              name: node.name,
              roles: node.roles,
              version: node.version,
              jvm: {
                heapUsedPercent: node.jvm?.mem?.heap_used_percent,
                heapMax: node.jvm?.mem?.heap_max_in_bytes,
                heapUsed: node.jvm?.mem?.heap_used_in_bytes
              },
              os: {
                cpuPercent: node.os?.cpu?.percent,
                loadAverage: node.os?.cpu?.load_average
              },
              fs: {
                totalBytes: node.fs?.total?.total_in_bytes,
                availableBytes: node.fs?.total?.available_in_bytes,
                freeBytes: node.fs?.total?.free_in_bytes
              }
            }
          }) : []
        },
        indices: {
          list: indicesData || [],
          stats: indexStatsData,
          count: indicesData ? indicesData.length : 0,
          totalDocs: indicesData ? indicesData.reduce((sum: number, idx: any) => sum + parseInt(idx['docs.count'] || '0'), 0) : 0,
          totalSize: indicesData ? indicesData.reduce((sum: number, idx: any) => {
            const sizeStr = idx['store.size'] || '0b'
            const sizeNum = parseFloat(sizeStr)
            const unit = sizeStr.slice(-2)
            let multiplier = 1
            if (unit === 'kb') multiplier = 1024
            else if (unit === 'mb') multiplier = 1024 * 1024
            else if (unit === 'gb') multiplier = 1024 * 1024 * 1024
            return sum + (sizeNum * multiplier)
          }, 0) : 0
        },
        shards: {
          allocation: shardsData || [],
          summary: shardsData ? {
            total: shardsData.length,
            started: shardsData.filter((s: any) => s.state === 'STARTED').length,
            relocating: shardsData.filter((s: any) => s.state === 'RELOCATING').length,
            initializing: shardsData.filter((s: any) => s.state === 'INITIALIZING').length,
            unassigned: shardsData.filter((s: any) => s.state === 'UNASSIGNED').length
          } : null
        },
        templates: {
          indexTemplates: templatesData?.index_templates || [],
          count: templatesData?.index_templates?.length || 0
        }
      }

      if (format === 'pdf') {
        // For PDF, collect comprehensive data including all the missing metrics
        const comprehensivePromises = [
          // Basic cluster info
          fetchWithTimeout('/api/es-proxy/_cluster/health', {
            headers: { 'Content-Type': 'application/json' }
          }, 10000).catch(() => null),
          
          // Node information with full stats including JVM, OS, process info
          fetchWithTimeout('/api/es-proxy/_nodes/stats', {
            headers: { 'Content-Type': 'application/json' }
          }, 10000).catch(() => null),
          
          // Indices information with comprehensive stats
          fetchWithTimeout('/api/es-proxy/_cat/indices?format=json&bytes=b&h=index,health,status,docs.count,docs.deleted,store.size,pri,rep,creation.date', {
            headers: { 'Content-Type': 'application/json' }
          }, 10000).catch(() => null),
          
          // Cluster stats for search and indexing performance
          fetchWithTimeout('/api/es-proxy/_cluster/stats', {
            headers: { 'Content-Type': 'application/json' }
          }, 10000).catch(() => null),
          
          // Cat shards for detailed shard info
          fetchWithTimeout('/api/es-proxy/_cat/shards?format=json&h=index,shard,prirep,state,docs,store,ip,node,unassigned.reason', {
            headers: { 'Content-Type': 'application/json' }
          }, 10000).catch(() => null),
        ]

        const comprehensiveResponses = await Promise.all(comprehensivePromises)
        
        // Parse comprehensive responses with timeout
        const [
          healthData,
          nodesStatsData,
          indicesData,
          clusterStatsData,
          shardsData
        ] = await Promise.all(
          comprehensiveResponses.map(async (response, index) => {
            if (!response || !(response as Response).ok) {
              console.warn(`Failed to fetch comprehensive data for request ${index}`)
              return null
            }
            try {
              return await (response as Response).json()
            } catch (error) {
              console.warn(`Failed to parse JSON for request ${index}:`, error)
              return null
            }
          })
        )
        // Transform our comprehensive data to match the expected PDF API format
        const pdfReportData = {
          metadata: {
            generated_at: new Date().toISOString(),
            generated_by: 'IndexSphere User',
            cluster_name: healthData?.cluster_name || 'Unknown',
            connection_name: currentConnection.name
          },
          executive_summary: {
            cluster_status: healthData?.status || 'unknown',
            total_nodes: healthData?.number_of_nodes || 0,
            data_nodes: healthData?.number_of_data_nodes || 0,
            total_indices: indicesData?.length || 0,
            total_documents: indicesData ? indicesData.reduce((sum: number, idx: any) => sum + parseInt(idx['docs.count'] || '0'), 0) : 0,
            total_storage_gb: indicesData ? Math.round(indicesData.reduce((sum: number, idx: any) => {
              const sizeStr = idx['store.size'] || '0b'
              const sizeNum = parseFloat(sizeStr)
              const unit = sizeStr.slice(-2).toLowerCase()
              let multiplier = 1
              if (unit === 'kb') multiplier = 1024
              else if (unit === 'mb') multiplier = 1024 * 1024
              else if (unit === 'gb') multiplier = 1024 * 1024 * 1024
              else if (unit === 'tb') multiplier = 1024 * 1024 * 1024 * 1024
              return sum + (sizeNum * multiplier)
            }, 0) / (1024 * 1024 * 1024) * 100) / 100 : 0,
            active_shards_percent: healthData?.active_shards_percent_as_number || 0,
            active_shards: healthData?.active_shards || 0,
            primary_shards: healthData?.active_primary_shards || 0,
            unassigned_shards: healthData?.unassigned_shards || 0,
            relocating_shards: healthData?.relocating_shards || 0,
            initializing_shards: healthData?.initializing_shards || 0,
            issues_count: (healthData?.status === 'red' ? 3 : healthData?.status === 'yellow' ? 1 : 0) + (healthData?.unassigned_shards > 0 ? 1 : 0),
            recommendations_count: (healthData?.unassigned_shards > 0 ? 1 : 0) + (healthData?.number_of_nodes < 3 ? 1 : 0)
          },
          cluster_health: {
            ...healthData,
            // Add search and indexing performance from cluster stats
            search_performance: clusterStatsData ? {
              total_queries: clusterStatsData.indices?.search?.query_total || 0,
              query_time_in_millis: clusterStatsData.indices?.search?.query_time_in_millis || 0,
              avg_query_time: clusterStatsData.indices?.search?.query_total > 0 ? 
                Math.round((clusterStatsData.indices?.search?.query_time_in_millis || 0) / clusterStatsData.indices?.search?.query_total) : 0,
              current_queries: clusterStatsData.indices?.search?.query_current || 0,
              fetch_total: clusterStatsData.indices?.search?.fetch_total || 0,
              fetch_time_in_millis: clusterStatsData.indices?.search?.fetch_time_in_millis || 0,
              avg_fetch_time: clusterStatsData.indices?.search?.fetch_total > 0 ? 
                Math.round((clusterStatsData.indices?.search?.fetch_time_in_millis || 0) / clusterStatsData.indices?.search?.fetch_total) : 0
            } : null,
            indexing_performance: clusterStatsData ? {
              total_indexing: clusterStatsData.indices?.indexing?.index_total || 0,
              indexing_time_in_millis: clusterStatsData.indices?.indexing?.index_time_in_millis || 0,
              avg_indexing_time: clusterStatsData.indices?.indexing?.index_total > 0 ? 
                Math.round((clusterStatsData.indices?.indexing?.index_time_in_millis || 0) / clusterStatsData.indices?.indexing?.index_total) : 0,
              current_indexing: clusterStatsData.indices?.indexing?.index_current || 0,
              delete_total: clusterStatsData.indices?.indexing?.delete_total || 0,
              delete_time_in_millis: clusterStatsData.indices?.indexing?.delete_time_in_millis || 0
            } : null
          },
          nodes_analysis: {
            nodes: nodesStatsData ? Object.keys(nodesStatsData.nodes || {}).map(nodeId => {
              const node = nodesStatsData.nodes[nodeId]
              return {
                id: nodeId,
                name: node.name,
                ip: node.ip,
                roles: node.roles || [],
                memory_usage: Math.round(node.jvm?.mem?.heap_used_percent || 0),
                memory_used_bytes: node.jvm?.mem?.heap_used_in_bytes || 0,
                memory_max_bytes: node.jvm?.mem?.heap_max_in_bytes || 0,
                cpu_usage: Math.round(node.os?.cpu?.percent || 0),
                load_average: node.os?.cpu?.load_average ? Object.values(node.os.cpu.load_average)[0] : 0,
                disk_usage: node.fs?.total ? Math.round(((node.fs.total.total_in_bytes - node.fs.total.available_in_bytes) / node.fs.total.total_in_bytes) * 100) : 0,
                disk_used_bytes: node.fs?.total ? (node.fs.total.total_in_bytes - node.fs.total.available_in_bytes) : 0,
                disk_total_bytes: node.fs?.total?.total_in_bytes || 0,
                version: node.version,
                uptime_millis: node.jvm?.uptime_in_millis || 0,
                gc_collection_count: node.jvm?.gc?.collectors ? Object.values(node.jvm.gc.collectors).reduce((sum: number, gc: any) => sum + (gc.collection_count || 0), 0) : 0,
                gc_collection_time: node.jvm?.gc?.collectors ? Object.values(node.jvm.gc.collectors).reduce((sum: number, gc: any) => sum + (gc.collection_time_in_millis || 0), 0) : 0
              }
            }) : [],
            summary: {
              total_nodes: nodesStatsData ? Object.keys(nodesStatsData.nodes || {}).length : 0,
              data_nodes: nodesStatsData ? Object.values(nodesStatsData.nodes || {}).filter((n: any) => n.roles?.includes('data')).length : 0,
              master_nodes: nodesStatsData ? Object.values(nodesStatsData.nodes || {}).filter((n: any) => n.roles?.includes('master')).length : 0,
              avg_memory_usage: nodesStatsData ? Math.round(Object.values(nodesStatsData.nodes || {}).reduce((sum: number, n: any) => sum + (n.jvm?.mem?.heap_used_percent || 0), 0) / Object.keys(nodesStatsData.nodes || {}).length) : 0,
              avg_cpu_usage: nodesStatsData ? Math.round(Object.values(nodesStatsData.nodes || {}).reduce((sum: number, n: any) => sum + (n.os?.cpu?.percent || 0), 0) / Object.keys(nodesStatsData.nodes || {}).length) : 0,
              avg_disk_usage: nodesStatsData ? Math.round(Object.values(nodesStatsData.nodes || {}).reduce((sum: number, n: any) => {
                if (!n.fs?.total) return sum
                return sum + (((n.fs.total.total_in_bytes - n.fs.total.available_in_bytes) / n.fs.total.total_in_bytes) * 100)
              }, 0) / Object.keys(nodesStatsData.nodes || {}).length) : 0
            }
          },
          indices_analysis: {
            indices: indicesData ? indicesData.slice(0, 30).map((idx: any) => ({
              name: idx.index,
              docs_count: parseInt(idx['docs.count'] || '0'),
              docs_deleted: parseInt(idx['docs.deleted'] || '0'),
              store_size_bytes: (() => {
                const sizeStr = idx['store.size'] || '0b'
                const sizeNum = parseFloat(sizeStr)
                const unit = sizeStr.slice(-2).toLowerCase()
                let multiplier = 1
                if (unit === 'kb') multiplier = 1024
                else if (unit === 'mb') multiplier = 1024 * 1024
                else if (unit === 'gb') multiplier = 1024 * 1024 * 1024
                else if (unit === 'tb') multiplier = 1024 * 1024 * 1024 * 1024
                return Math.round(sizeNum * multiplier)
              })(),
              health: idx.health,
              status: idx.status,
              primary_shards: parseInt(idx.pri || '0'),
              replica_shards: parseInt(idx.rep || '0'),
              creation_date: idx['creation.date'] ? new Date(parseInt(idx['creation.date'])).toISOString() : null
            })) : [],
            summary: {
              total_indices: indicesData?.length || 0,
              total_documents: indicesData ? indicesData.reduce((sum: number, idx: any) => sum + parseInt(idx['docs.count'] || '0'), 0) : 0,
              total_deleted: indicesData ? indicesData.reduce((sum: number, idx: any) => sum + parseInt(idx['docs.deleted'] || '0'), 0) : 0,
              largest_index: indicesData && indicesData.length > 0 ? indicesData[0].index : 'N/A',
              avg_docs_per_index: indicesData && indicesData.length > 0 ? Math.round(indicesData.reduce((sum: number, idx: any) => sum + parseInt(idx['docs.count'] || '0'), 0) / indicesData.length) : 0,
              total_primary_shards: indicesData ? indicesData.reduce((sum: number, idx: any) => sum + parseInt(idx.pri || '0'), 0) : 0,
              total_replica_shards: indicesData ? indicesData.reduce((sum: number, idx: any) => sum + parseInt(idx.rep || '0'), 0) : 0
            }
          },
          shards_analysis: {
            allocation: shardsData || [],
            unassigned_reasons: shardsData ? shardsData
              .filter((shard: any) => shard.state === 'UNASSIGNED')
              .reduce((reasons: any, shard: any) => {
                const reason = shard['unassigned.reason'] || 'UNKNOWN'
                reasons[reason] = (reasons[reason] || 0) + 1
                return reasons
              }, {}) : {},
            summary: shardsData ? {
              total: shardsData.length,
              started: shardsData.filter((s: any) => s.state === 'STARTED').length,
              relocating: shardsData.filter((s: any) => s.state === 'RELOCATING').length,
              initializing: shardsData.filter((s: any) => s.state === 'INITIALIZING').length,
              unassigned: shardsData.filter((s: any) => s.state === 'UNASSIGNED').length,
              primary_shards: shardsData.filter((s: any) => s.prirep === 'p').length,
              replica_shards: shardsData.filter((s: any) => s.prirep === 'r').length
            } : null
          },
          search_performance: clusterStatsData ? {
            total_queries: clusterStatsData.indices?.search?.query_total || 0,
            average_query_time: clusterStatsData.indices?.search?.query_total > 0 ? 
              Math.round((clusterStatsData.indices?.search?.query_time_in_millis || 0) / clusterStatsData.indices?.search?.query_total) : 0,
            average_fetch_time: clusterStatsData.indices?.search?.fetch_total > 0 ? 
              Math.round((clusterStatsData.indices?.search?.fetch_time_in_millis || 0) / clusterStatsData.indices?.search?.fetch_total) : 0,
            total_query_time: clusterStatsData.indices?.search?.query_time_in_millis || 0,
            current_queries: clusterStatsData.indices?.search?.query_current || 0,
            total_fetch: clusterStatsData.indices?.search?.fetch_total || 0,
            total_fetch_time: clusterStatsData.indices?.search?.fetch_time_in_millis || 0,
            scroll_total: clusterStatsData.indices?.search?.scroll_total || 0,
            scroll_time: clusterStatsData.indices?.search?.scroll_time_in_millis || 0,
            // Calculate EPS (Events Per Second) approximation
            current_eps: clusterStatsData.indices?.indexing?.index_current || 0,
            peak_eps: Math.max(clusterStatsData.indices?.indexing?.index_current || 0, clusterStatsData.indices?.search?.query_current || 0)
          } : {
            total_queries: 0,
            average_query_time: 0,
            average_fetch_time: 0,
            total_query_time: 0,
            current_queries: 0,
            current_eps: 0,
            peak_eps: 0
          },
          issues_and_recommendations: {
            issues: (() => {
              const issues = []
              if (healthData?.status === 'red') {
                issues.push({
                  severity: 'critical',
                  category: 'cluster_health',
                  title: 'Cluster Status is RED',
                  description: 'Some primary shards are not allocated. This means data is unavailable.',
                  affected_resources: [`${healthData.unassigned_shards} unassigned shards`]
                })
              } else if (healthData?.status === 'yellow') {
                issues.push({
                  severity: 'warning',
                  category: 'cluster_health',
                  title: 'Cluster Status is YELLOW',
                  description: 'Some replica shards are not allocated. Data is available but not fully replicated.',
                  affected_resources: [`${healthData.unassigned_shards} unassigned shards`]
                })
              }
              
              if (healthData?.unassigned_shards > 0) {
                const unassignedReasons = Object.entries(shardsData ? shardsData
                  .filter((shard: any) => shard.state === 'UNASSIGNED')
                  .reduce((reasons: any, shard: any) => {
                    const reason = shard['unassigned.reason'] || 'UNKNOWN'
                    reasons[reason] = (reasons[reason] || 0) + 1
                    return reasons
                  }, {}) : {})
                
                issues.push({
                  severity: healthData.status === 'red' ? 'critical' : 'warning',
                  category: 'shard_allocation',
                  title: `${healthData.unassigned_shards} Unassigned Shards`,
                  description: 'Shards that cannot be allocated to any node',
                  affected_resources: unassignedReasons.map(([reason, count]) => `${count} shards: ${reason}`)
                })
              }
              
              // Check for high memory usage
              if (nodesStatsData) {
                const highMemoryNodes = Object.values(nodesStatsData.nodes || {}).filter((n: any) => (n.jvm?.mem?.heap_used_percent || 0) > 85)
                if (highMemoryNodes.length > 0) {
                  issues.push({
                    severity: 'warning',
                    category: 'resource_usage',
                    title: 'High Memory Usage',
                    description: 'Some nodes have high JVM heap usage (>85%)',
                    affected_resources: highMemoryNodes.map((n: any) => `${n.name}: ${n.jvm?.mem?.heap_used_percent || 0}%`)
                  })
                }
                
                // Check for high disk usage
                const highDiskNodes = Object.values(nodesStatsData.nodes || {}).filter((n: any) => {
                  if (!n.fs?.total) return false
                  const diskUsage = ((n.fs.total.total_in_bytes - n.fs.total.available_in_bytes) / n.fs.total.total_in_bytes) * 100
                  return diskUsage > 85
                })
                if (highDiskNodes.length > 0) {
                  issues.push({
                    severity: 'warning',
                    category: 'resource_usage',
                    title: 'High Disk Usage',
                    description: 'Some nodes have high disk usage (>85%)',
                    affected_resources: highDiskNodes.map((n: any) => {
                      const diskUsage = Math.round(((n.fs.total.total_in_bytes - n.fs.total.available_in_bytes) / n.fs.total.total_in_bytes) * 100)
                      return `${n.name}: ${diskUsage}%`
                    })
                  })
                }
              }
              
              return issues
            })(),
            recommendations: (() => {
              const recommendations = []
              
              if (healthData?.status === 'red') {
                recommendations.push({
                  priority: 'high',
                  category: 'cluster_health',
                  title: 'Resolve Red Cluster Status',
                  description: 'Investigate and fix unassigned primary shards immediately',
                  actions: [
                    'Check node availability and disk space',
                    'Review shard allocation settings',
                    'Consider increasing the number of data nodes',
                    'Check for any allocation filters or routing settings'
                  ]
                })
              } else if (healthData?.status === 'yellow') {
                recommendations.push({
                  priority: 'medium',
                  category: 'cluster_health',
                  title: 'Resolve Yellow Cluster Status',
                  description: 'Fix unassigned replica shards to improve fault tolerance',
                  actions: [
                    'Add more data nodes to accommodate replicas',
                    'Review replica settings for indices',
                    'Check shard allocation awareness settings'
                  ]
                })
              }
              
              if (!healthData || healthData.number_of_nodes < 3) {
                recommendations.push({
                  priority: 'medium',
                  category: 'architecture',
                  title: 'Increase Node Count',
                  description: 'Add more nodes for better fault tolerance and performance',
                  actions: [
                    'Deploy additional Elasticsearch nodes',
                    'Configure proper master-eligible nodes (minimum 3)',
                    'Distribute data nodes across availability zones'
                  ]
                })
              }
              
              // Performance recommendations
              if (clusterStatsData?.indices?.search?.query_total > 0) {
                const avgQueryTime = (clusterStatsData.indices.search.query_time_in_millis || 0) / clusterStatsData.indices.search.query_total
                if (avgQueryTime > 100) {
                  recommendations.push({
                    priority: 'medium',
                    category: 'performance',
                    title: 'Optimize Search Performance',
                    description: `Average query time is ${Math.round(avgQueryTime)}ms`,
                    actions: [
                      'Review and optimize slow queries',
                      'Consider index optimization and mapping improvements',
                      'Increase shard count for large indices',
                      'Review JVM heap sizing and GC settings'
                    ]
                  })
                }
              }
              
              return recommendations
            })()
          }
        }

        // Generate PDF using the properly formatted data with extended timeout
        const pdfResponse = await Promise.race([
          fetch('/api/reports/generate-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              reportData: pdfReportData,
            }),
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('PDF generation timeout - please try again')), 150000) // 2.5 minutes
          )
        ]) as Response

        if (!pdfResponse.ok) {
          const errorText = await pdfResponse.text()
          console.error('PDF generation failed:', errorText)
          throw new Error('Failed to generate PDF report')
        }

        // Download the PDF
        const blob = await pdfResponse.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.style.display = 'none'
        a.href = url
        a.download = `elasticsearch-cluster-report-${Date.now()}.pdf`
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(url)
        document.body.removeChild(a)

      } else {
        // For JSON, use the comprehensive data structure
        const response = await fetch('/api/cluster/health', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            format,
            data: reportData,
            connection: currentConnection,
          }),
        })

        if (!response.ok) {
          throw new Error('Failed to generate report')
        }

        // Download the file
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.style.display = 'none'
        a.href = url
        a.download = `elasticsearch-comprehensive-report-${Date.now()}.${format}`
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(url)
        document.body.removeChild(a)
      }

    } catch (error) {
      console.error('Error generating report:', error)
      setError('Failed to generate report')
    } finally {
      setIsGenerating(false)
      setGeneratingType(null)
    }
  }

  if (!currentConnection || !isConnected) {
    return (
      <div className="space-y-6">
        <PageHeader title="Reports" description="Download a cluster report as PDF or JSON." />
        <EmptyState
          icon={Database}
          title="No cluster connected"
          description="Reports are generated from the cluster you are connected to."
          action={<Button asChild><Link href="/connections">Go to connections</Link></Button>}
        />
        {savedConnections.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Remembered in this browser</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {savedConnections.map((connection: any) => (
                  <li key={connection.id} className="flex items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{connection.name}</div>
                      <div className="truncate font-mono text-xs text-muted-foreground">{connection.url}</div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => selectConnection(connection.id)}>Connect</Button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Download a point-in-time report of the connected cluster."
        meta={<Badge variant="outline" className="font-mono text-xs">{currentConnection.name || currentConnection.url}</Badge>}
        actions={
          <>
            <Button variant="outline" onClick={refreshData} disabled={!dataFetched}>
              <RefreshCw className="h-4 w-4 mr-1.5" />Refresh
            </Button>
            <Button variant="outline" onClick={() => generateReport('json')} disabled={isGenerating}>
              {isGenerating && generatingType === 'json' ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Download className="h-4 w-4 mr-1.5" />}
              JSON
            </Button>
            <Button onClick={() => generateReport('pdf')} disabled={isGenerating}>
              {isGenerating && generatingType === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <FileText className="h-4 w-4 mr-1.5" />}
              Download PDF
            </Button>
          </>
        }
      />

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {isGenerating && (
        <Alert>
          <Loader2 className="h-4 w-4 animate-spin" />
          <AlertDescription>
            {generatingType === 'pdf'
              ? 'Building the PDF report. Large clusters can take up to a minute.'
              : 'Building the JSON report.'}
          </AlertDescription>
        </Alert>
      )}

      {clusterInfo && (
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <StatCard label="Cluster" value={<span className="truncate text-xl">{clusterInfo.cluster_name}</span>} hint={<HealthBadge status={clusterInfo.status} />} />
          <StatCard label="Nodes" value={clusterInfo.number_of_nodes} />
          <StatCard label="Active shards" value={clusterInfo.active_shards} />
          <StatCard label="Indices" value={indexInfo.length} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What the reports contain</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div>
              <p className="font-medium">PDF</p>
              <p className="text-muted-foreground">A formatted document with cluster health, node resources, index sizes, shard allocation, search performance, and detected issues with recommendations.</p>
            </div>
            <div>
              <p className="font-medium">JSON</p>
              <p className="text-muted-foreground">The same data, structured for scripts and other tools.</p>
            </div>
            <p className="text-xs text-muted-foreground">To receive reports by email on a schedule, use <Link href="/scheduled-reports" className="underline underline-offset-2">Scheduled reports</Link>.</p>
          </CardContent>
        </Card>

        {clusterInfo && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Preview</CardTitle>
              <CardDescription>A sample of the data included.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm">
              <div>
                <p className="mb-1 font-medium">Nodes ({nodeInfo.length})</p>
                <ul className="space-y-0.5 text-muted-foreground">
                  {nodeInfo.slice(0, 3).map((node, index) => (
                    <li key={index} className="truncate">{node.name} · {node.roles.join(', ')}</li>
                  ))}
                  {nodeInfo.length > 3 && <li>and {nodeInfo.length - 3} more</li>}
                </ul>
              </div>
              <div>
                <p className="mb-1 font-medium">Indices ({indexInfo.length})</p>
                <ul className="space-y-0.5 text-muted-foreground">
                  {indexInfo.slice(0, 3).map((index, idx) => (
                    <li key={idx} className="truncate">{index.index} · {Number(index['docs.count'] ?? 0).toLocaleString()} docs</li>
                  ))}
                  {indexInfo.length > 3 && <li>and {indexInfo.length - 3} more</li>}
                </ul>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
