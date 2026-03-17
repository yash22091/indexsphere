'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Database, AlertTriangle, Download, FileText, Clock, Server, RefreshCw } from 'lucide-react';
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
  const currentConnection = connectionConfig ? (() => {
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
  })() : null

  useEffect(() => {
    if (currentConnection && isConnected && !dataFetched) {
      fetchClusterData()
    }
  }, [currentConnection, isConnected, dataFetched])

  const fetchClusterData = async () => {
    if (!currentConnection) return

    try {
      setError(null)
      setDataFetched(true) // Set flag to prevent continuous requests
      
      // Debug logging
      console.log('Current connection:', currentConnection)
      
      // Validate connection config
      if (!currentConnection.url) {
        setError('Invalid connection configuration. Please check your connection settings.')
        return
      }
      
      // Prepare ES config for proxy
      const esConfig = {
        url: currentConnection.url,
        auth: currentConnection.auth,
        headers: {}
      }
      
      console.log('ES config:', esConfig)
      
      // Fetch cluster health using es-proxy
      const healthResponse = await fetch('/api/es-proxy/_cluster/health', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-ES-Config': JSON.stringify(esConfig),
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
          'X-ES-Config': JSON.stringify(esConfig),
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
          'X-ES-Config': JSON.stringify(esConfig),
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

      // Prepare ES config for comprehensive data collection
      const esConfig = {
        url: currentConnection.url,
        auth: currentConnection.auth,
        headers: {}
      }

      // Collect comprehensive cluster data for all report types
      const promises = [
        // Basic cluster info
        fetch('/api/es-proxy/_cluster/health', {
          headers: { 'Content-Type': 'application/json', 'X-ES-Config': JSON.stringify(esConfig) }
        }).catch(() => null),
        
        // Cluster stats
        fetch('/api/es-proxy/_cluster/stats', {
          headers: { 'Content-Type': 'application/json', 'X-ES-Config': JSON.stringify(esConfig) }
        }).catch(() => null),
        
        // Node information
        fetch('/api/es-proxy/_nodes/stats', {
          headers: { 'Content-Type': 'application/json', 'X-ES-Config': JSON.stringify(esConfig) }
        }).catch(() => null),
        
        // Indices information
        fetch('/api/es-proxy/_cat/indices?format=json&bytes=b', {
          headers: { 'Content-Type': 'application/json', 'X-ES-Config': JSON.stringify(esConfig) }
        }).catch(() => null),
        
        // Index stats
        fetch('/api/es-proxy/_stats', {
          headers: { 'Content-Type': 'application/json', 'X-ES-Config': JSON.stringify(esConfig) }
        }).catch(() => null),
        
        // Shard allocation
        fetch('/api/es-proxy/_cat/shards?format=json', {
          headers: { 'Content-Type': 'application/json', 'X-ES-Config': JSON.stringify(esConfig) }
        }).catch(() => null),
        
        // Index templates
        fetch('/api/es-proxy/_index_template', {
          headers: { 'Content-Type': 'application/json', 'X-ES-Config': JSON.stringify(esConfig) }
        }).catch(() => null),
        
        // Cluster settings
        fetch('/api/es-proxy/_cluster/settings', {
          headers: { 'Content-Type': 'application/json', 'X-ES-Config': JSON.stringify(esConfig) }
        }).catch(() => null),
        
        // Pending tasks
        fetch('/api/es-proxy/_cluster/pending_tasks', {
          headers: { 'Content-Type': 'application/json', 'X-ES-Config': JSON.stringify(esConfig) }
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
            headers: { 'Content-Type': 'application/json', 'X-ES-Config': JSON.stringify(esConfig) }
          }, 10000).catch(() => null),
          
          // Node information with full stats including JVM, OS, process info
          fetchWithTimeout('/api/es-proxy/_nodes/stats', {
            headers: { 'Content-Type': 'application/json', 'X-ES-Config': JSON.stringify(esConfig) }
          }, 10000).catch(() => null),
          
          // Indices information with comprehensive stats
          fetchWithTimeout('/api/es-proxy/_cat/indices?format=json&bytes=b&h=index,health,status,docs.count,docs.deleted,store.size,pri,rep,creation.date', {
            headers: { 'Content-Type': 'application/json', 'X-ES-Config': JSON.stringify(esConfig) }
          }, 10000).catch(() => null),
          
          // Cluster stats for search and indexing performance
          fetchWithTimeout('/api/es-proxy/_cluster/stats', {
            headers: { 'Content-Type': 'application/json', 'X-ES-Config': JSON.stringify(esConfig) }
          }, 10000).catch(() => null),
          
          // Shard allocation with reasons for unassigned shards
          fetchWithTimeout('/api/es-proxy/_cluster/allocation/explain', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-ES-Config': JSON.stringify(esConfig) },
            body: JSON.stringify({})
          }, 10000).catch(() => null),
          
          // Cat shards for detailed shard info
          fetchWithTimeout('/api/es-proxy/_cat/shards?format=json&h=index,shard,prirep,state,docs,store,ip,node,unassigned.reason', {
            headers: { 'Content-Type': 'application/json', 'X-ES-Config': JSON.stringify(esConfig) }
          }, 10000).catch(() => null),
        ]

        const comprehensiveResponses = await Promise.all(comprehensivePromises)
        
        // Parse comprehensive responses with timeout
        const [
          healthData,
          nodesStatsData,
          indicesData,
          clusterStatsData,
          allocationData,
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
      <div className="container mx-auto px-4 py-8">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Please connect to an Elasticsearch cluster first. Go to the Connect page to establish a connection.
          </AlertDescription>
        </Alert>
        
        {savedConnections.length > 0 && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                Saved Connections
              </CardTitle>
              <CardDescription>
                Click on a saved connection to connect and view reports
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {savedConnections.map((connection: any) => (
                  <Button
                    key={connection.id}
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => selectConnection(connection.id)}
                  >
                    <Server className="h-4 w-4 mr-2" />
                    <div className="text-left">
                      <div className="font-medium">{connection.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {connection.url}
                      </div>
                    </div>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Cluster Reports</h1>
        <p className="text-muted-foreground">
          Generate comprehensive reports about your Elasticsearch cluster
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Connection Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Current Connection
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              onClick={refreshData}
              variant="outline"
              size="sm"
              className="flex items-center gap-2"
              disabled={!dataFetched}
            >
              <RefreshCw className="h-4 w-4" />
              Refresh Data
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="p-3 bg-muted rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{currentConnection.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {currentConnection.url}
                  </p>
                </div>
                <Badge variant={clusterInfo?.status === 'green' ? 'default' : 'destructive'}>
                  {clusterInfo?.status || 'Unknown'}
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cluster Summary */}
      {clusterInfo && (
        <Card>
          <CardHeader>
            <CardTitle>Cluster Summary</CardTitle>
            <CardDescription>Overview of your Elasticsearch cluster</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-2">
                <p className="text-sm font-medium">Cluster Name</p>
                <p className="text-2xl font-bold">{clusterInfo.cluster_name}</p>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Total Nodes</p>
                <p className="text-2xl font-bold">{clusterInfo.number_of_nodes}</p>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Active Shards</p>
                <p className="text-2xl font-bold">{clusterInfo.active_shards}</p>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Indices</p>
                <p className="text-2xl font-bold">{indexInfo.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Report Generation */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Generate Reports
          </CardTitle>
          <CardDescription>
            Export comprehensive reports of your cluster status, nodes, and indices
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <Button 
              onClick={() => generateReport('pdf')}
              disabled={isGenerating}
              className="flex items-center gap-2"
              variant="default"
            >
              <Download className="h-4 w-4" />
              {isGenerating ? 'Generating...' : 'Export as PDF (Comprehensive)'}
            </Button>
            <Button 
              onClick={() => generateReport('json')}
              disabled={isGenerating}
              variant="outline"
              className="flex items-center gap-2"
            >
              <Download className="h-4 w-4" />
              {isGenerating ? 'Generating...' : 'Export as JSON'}
            </Button>
          </div>
          
          {isGenerating && (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4 animate-spin" />
              {generatingType === 'pdf' 
                ? 'Generating PDF report... This may take up to 2 minutes for comprehensive analysis.'
                : 'Generating JSON report... This will complete shortly.'
              }
            </div>
          )}

          <div className="mt-4 p-4 bg-blue-50 rounded-lg">
            <h4 className="font-medium text-blue-900 mb-2">Report Types:</h4>
            <div className="space-y-2 text-sm text-blue-800">
              <div><strong>PDF:</strong> Comprehensive cluster analysis with visual charts, performance metrics, search analytics, issues detection, and recommendations. Includes data from all cluster pages.</div>
              <div><strong>JSON:</strong> Raw structured data for programmatic use and integration with other tools.</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Report Content Preview */}
      {clusterInfo && (
        <Card>
          <CardHeader>
            <CardTitle>Report Preview</CardTitle>
            <CardDescription>Preview of data that will be included in the reports</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <h4 className="font-medium mb-2">Cluster Health</h4>
                <div className="grid md:grid-cols-3 gap-4 text-sm">
                  <div>Status: <Badge variant={clusterInfo.status === 'green' ? 'default' : 'destructive'}>{clusterInfo.status}</Badge></div>
                  <div>Nodes: {clusterInfo.number_of_nodes}</div>
                  <div>Shards: {clusterInfo.active_shards}</div>
                </div>
              </div>
              
              <div>
                <h4 className="font-medium mb-2">Nodes ({nodeInfo.length})</h4>
                <div className="text-sm text-muted-foreground">
                  {nodeInfo.slice(0, 3).map((node, index) => (
                    <div key={index}>{node.name} - {node.roles.join(', ')}</div>
                  ))}
                  {nodeInfo.length > 3 && <div>... and {nodeInfo.length - 3} more</div>}
                </div>
              </div>
              
              <div>
                <h4 className="font-medium mb-2">Indices ({indexInfo.length})</h4>
                <div className="text-sm text-muted-foreground">
                  {indexInfo.slice(0, 3).map((index, idx) => (
                    <div key={idx}>{index.index} - {index['docs.count']} docs ({index['store.size']})</div>
                  ))}
                  {indexInfo.length > 3 && <div>... and {indexInfo.length - 3} more</div>}
                </div>
              </div>

              <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
                <p className="text-sm text-yellow-800">
                  <strong>PDF reports include additional data:</strong> Search performance analytics, resource utilization, 
                  automatic issue detection, optimization recommendations, and visual charts.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}