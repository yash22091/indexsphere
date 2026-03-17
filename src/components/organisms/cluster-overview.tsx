"use client";

import { ClusterStatus } from "@/components/atoms/cluster-status";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ElasticsearchCluster } from "@/types";
import { Server, Database, Activity, AlertTriangle } from "lucide-react";

interface ClusterOverviewProps {
  cluster: ElasticsearchCluster;
}

export function ClusterOverview({ cluster }: ClusterOverviewProps) {
  const healthPercentage = cluster.activeShardsPercentAsNumber || 0;
  
  return (
    <div className="space-y-6">
      {/* Cluster Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{cluster.name}</h1>
          <p className="text-muted-foreground">Cluster Overview</p>
        </div>
        <ClusterStatus status={cluster.status} />
      </div>

      {/* Cluster Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Nodes</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{cluster.numberOfNodes}</div>
            <p className="text-xs text-muted-foreground">
              {cluster.numberOfDataNodes} data nodes
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Shards</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{cluster.activeShards}</div>
            <p className="text-xs text-muted-foreground">
              {cluster.activePrimaryShards} primary
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Shard Health</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{healthPercentage.toFixed(1)}%</div>
            <Progress value={healthPercentage} className="mt-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Issues</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{cluster.unassignedShards}</div>
            <p className="text-xs text-muted-foreground">
              unassigned shards
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Stats */}
      <Card>
        <CardHeader>
          <CardTitle>Cluster Details</CardTitle>
          <CardDescription>Detailed cluster information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">SHARDS</h4>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-sm">Active Primary:</span>
                  <Badge variant="outline">{cluster.activePrimaryShards}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Active Total:</span>
                  <Badge variant="outline">{cluster.activeShards}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Relocating:</span>
                  <Badge variant="secondary">{cluster.relocatingShards}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Initializing:</span>
                  <Badge variant="secondary">{cluster.initializingShards}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Unassigned:</span>
                  <Badge variant={cluster.unassignedShards > 0 ? "destructive" : "outline"}>
                    {cluster.unassignedShards}
                  </Badge>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">TASKS</h4>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-sm">Pending Tasks:</span>
                  <Badge variant="outline">{cluster.numberOfPendingTasks}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">In-Flight Fetch:</span>
                  <Badge variant="outline">{cluster.numberOfInFlightFetch}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Max Wait Time:</span>
                  <Badge variant="outline">{cluster.taskMaxWaitingInQueueMillis}ms</Badge>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
