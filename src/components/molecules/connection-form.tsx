"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, Server } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface ConnectionFormProps {
  onConnect: (host: string) => void;
  isConnecting?: boolean;
  error?: string;
}

export function ConnectionForm({ onConnect, isConnecting = false, error }: ConnectionFormProps) {
  const [host, setHost] = useState("http://localhost:9200");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConnect(host);
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <div className="flex justify-center mb-4">
          <Server className="h-12 w-12 text-primary" />
        </div>
        <CardTitle>Connect to Elasticsearch</CardTitle>
        <CardDescription>
          Enter your Elasticsearch cluster URL to get started
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="host">Elasticsearch Host</Label>
            <Input
              id="host"
              type="url"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="http://localhost:9200"
              disabled={isConnecting}
              required
            />
          </div>
          
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          
          <Button 
            type="submit" 
            className="w-full" 
            disabled={isConnecting || !host.trim()}
          >
            {isConnecting ? "Connecting..." : "Connect"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
