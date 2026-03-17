'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FileDown, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';

interface ExportReportProps {
  connectionId?: string;
  connectionName?: string;
  connectionConfig?: any;  // ✅ Added
}

export default function ExportReport({ connectionId, connectionName, connectionConfig }: ExportReportProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState<{
    type: 'idle' | 'collecting' | 'generating' | 'success' | 'error';
    message: string;
  }>({ type: 'idle', message: '' });

  const generateReport = async () => {
    setIsGenerating(true);
    setStatus({ type: 'collecting', message: 'Collecting cluster data...' });

    try {
      // Step 1: Collect cluster data
      const reportResponse = await fetch('/api/reports/cluster-report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          connectionId: connectionId || 'active',
          useActiveConnection: !connectionId || connectionId === 'current',
          connectionConfig // ✅ Pass full config if available
        }),
      });

      if (!reportResponse.ok) {
        const error = await reportResponse.json();
        throw new Error(error.error || 'Failed to collect cluster data');
      }

      const { reportData } = await reportResponse.json();

      setStatus({ type: 'generating', message: 'Generating PDF report...' });

      // Step 2: Generate PDF
      const pdfResponse = await fetch('/api/reports/generate-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reportData }),
      });

      if (!pdfResponse.ok) {
        const error = await pdfResponse.text();
        throw new Error(error || 'Failed to generate PDF');
      }

      // Step 3: Download PDF
      const blob = await pdfResponse.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cluster-report-${connectionName || 'unknown'}-${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setStatus({ type: 'success', message: 'Report generated and downloaded successfully!' });

    } catch (error: any) {
      console.error('Report generation failed:', error);
      setStatus({
        type: 'error',
        message: error.message || 'Failed to generate report. Please try again.'
      });
    } finally {
      setIsGenerating(false);
      // Clear status after 5 seconds
      setTimeout(() => {
        setStatus({ type: 'idle', message: '' });
      }, 5000);
    }
  };

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileDown className="h-5 w-5" />
          Export Cluster Report
        </CardTitle>
        <CardDescription>
          Generate a comprehensive PDF report containing cluster health, node analysis,
          indices overview, performance metrics, and recommendations.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status Alert */}
        {status.type !== 'idle' && (
          <Alert className={`${
            status.type === 'error' ? 'border-red-200 bg-red-50' :
            status.type === 'success' ? 'border-green-200 bg-green-50' :
            'border-blue-200 bg-blue-50'
          }`}>
            <div className="flex items-center gap-2">
              {status.type === 'collecting' && <Loader2 className="h-4 w-4 animate-spin" />}
              {status.type === 'generating' && <Loader2 className="h-4 w-4 animate-spin" />}
              {status.type === 'success' && <CheckCircle className="h-4 w-4 text-green-600" />}
              {status.type === 'error' && <AlertTriangle className="h-4 w-4 text-red-600" />}
              <AlertDescription className={`${
                status.type === 'error' ? 'text-red-800' :
                status.type === 'success' ? 'text-green-800' :
                'text-blue-800'
              }`}>
                {status.message}
              </AlertDescription>
            </div>
          </Alert>
        )}

        <div className="flex gap-3">
          <Button
            onClick={generateReport}
            disabled={isGenerating || !connectionId}
            className="flex items-center gap-2"
            size="lg"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {status.type === 'collecting' ? 'Collecting Data...' : 'Generating PDF...'}
              </>
            ) : (
              <>
                <FileDown className="h-4 w-4" />
                Generate Report
              </>
            )}
          </Button>

          {!connectionId && (
            <Alert className="flex-1">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Please connect to an Elasticsearch cluster first to generate a report.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <div className="text-xs text-muted-foreground">
          <p>Note: Report generation may take 30-60 seconds depending on cluster size.</p>
          <p>The PDF will automatically download when ready.</p>
        </div>
      </CardContent>
    </Card>
  );
}

