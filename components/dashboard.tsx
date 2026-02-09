"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SummaryCards } from "@/components/summary-cards";
import { TicketTable } from "@/components/ticket-table";
import { ConnectionStatus } from "@/components/connection-status";
import { RefreshCw, LayoutDashboard } from "lucide-react";
import type { AnalyzedTicket } from "@/lib/freshservice";

type ViewType = "active" | "created-today" | "updated-since";

interface TicketResponse {
  endpoint: string;
  total_tickets: number;
  summary: {
    fresh_tickets: number;
    replied_tickets: number;
    p1_count: number;
    p2_count: number;
    p3_count: number;
    p4_count: number;
  };
  tickets: AnalyzedTicket[];
  analysis_timestamp: string;
  days_lookback?: number;
  error?: string;
}

interface HealthResponse {
  status: string;
  authentication: {
    api_key_configured: boolean;
    connection_test: { success: boolean; error?: string } | null;
  };
  config: {
    domain: string;
    workspace_id: number;
    group_id: string;
  };
}

export function Dashboard() {
  const [view, setView] = useState<ViewType>("active");
  const [days, setDays] = useState(1);
  const [data, setData] = useState<TicketResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch("/api");
      const json = await res.json();
      setHealth(json);
    } catch {
      setHealth(null);
    }
  }, []);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    setError(null);

    let url = "/api/active-tickets";
    if (view === "created-today") {
      url = "/api/tickets-created-today";
    } else if (view === "updated-since") {
      url = `/api/tickets-updated-since?days=${days}`;
    }

    try {
      const res = await fetch(url);
      const json = await res.json();

      if (json.error) {
        setError(json.error);
        setData(null);
      } else {
        setData(json);
        setLastUpdated(new Date().toLocaleTimeString());
      }
    } catch (err) {
      setError((err as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [view, days]);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const apiKeyConfigured =
    health?.authentication?.api_key_configured ?? false;
  const connected =
    health?.authentication?.connection_test?.success ?? null;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <LayoutDashboard className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">
                Freshservice Tickets
              </h1>
              <p className="text-xs text-muted-foreground">
                {health?.config?.domain || "yondrgroup.freshservice.com"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-xs text-muted-foreground">
                Last updated: {lastUpdated}
              </span>
            )}
            <ConnectionStatus
              connected={connected}
              apiKeyConfigured={apiKeyConfigured}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={fetchTickets}
              disabled={loading}
              className="gap-2 border-border bg-secondary text-secondary-foreground hover:bg-accent"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {/* API Key Warning */}
        {!apiKeyConfigured && (
          <Card className="border-chart-3/30 bg-chart-3/5">
            <CardContent className="flex flex-col gap-2 p-4">
              <p className="text-sm font-medium text-chart-3">
                API Key Required
              </p>
              <p className="text-xs text-muted-foreground">
                Set the <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">FRESHSERVICE_API_KEY</code> environment variable to connect to Freshservice. You can find your API key in Freshservice under Profile Settings.
              </p>
            </CardContent>
          </Card>
        )}

        {/* View Selector */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg border border-border bg-card p-1">
            <button
              onClick={() => setView("active")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                view === "active"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Active Tickets
            </button>
            <button
              onClick={() => setView("created-today")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                view === "created-today"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Created Today
            </button>
            <button
              onClick={() => setView("updated-since")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                view === "updated-since"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Updated Since
            </button>
          </div>

          {view === "updated-since" && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Lookback:</span>
              <div className="flex rounded-lg border border-border bg-card p-1">
                {[1, 3, 7, 14, 30].map((d) => (
                  <button
                    key={d}
                    onClick={() => setDays(d)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      days === d
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Summary Cards */}
        <SummaryCards
          totalTickets={data?.total_tickets ?? 0}
          summary={data?.summary ?? null}
          loading={loading}
        />

        {/* Error Display */}
        {error && (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="p-4">
              <p className="text-sm text-destructive">{error}</p>
            </CardContent>
          </Card>
        )}

        {/* Ticket Table */}
        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between border-b border-border pb-4">
            <CardTitle className="text-base font-medium text-foreground">
              {data?.endpoint || "Tickets"}
            </CardTitle>
            <span className="font-mono text-xs text-muted-foreground">
              {data?.total_tickets ?? 0} tickets
            </span>
          </CardHeader>
          <CardContent className="p-0">
            <TicketTable tickets={data?.tickets ?? []} loading={loading} />
          </CardContent>
        </Card>

        {/* API Endpoints Reference */}
        <Card className="border-border bg-card">
          <CardHeader className="border-b border-border pb-4">
            <CardTitle className="text-base font-medium text-foreground">
              API Endpoints
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="grid gap-3 md:grid-cols-2">
              {[
                {
                  method: "GET",
                  path: "/api",
                  desc: "Health check & connection test",
                },
                {
                  method: "GET",
                  path: "/api/tickets-created-today",
                  desc: "Tickets created today",
                },
                {
                  method: "GET",
                  path: "/api/active-tickets",
                  desc: "Open or Pending tickets",
                },
                {
                  method: "GET",
                  path: "/api/tickets-updated-since?days=1",
                  desc: "Recently updated tickets",
                },
              ].map((ep) => (
                <div
                  key={ep.path}
                  className="flex items-start gap-3 rounded-lg border border-border bg-background p-3"
                >
                  <Badge className="mt-0.5 bg-primary/15 font-mono text-xs text-primary border-primary/30" variant="outline">
                    {ep.method}
                  </Badge>
                  <div className="flex flex-col gap-0.5">
                    <code className="font-mono text-sm text-foreground">
                      {ep.path}
                    </code>
                    <span className="text-xs text-muted-foreground">
                      {ep.desc}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function Badge({
  children,
  className,
  variant: _variant,
}: {
  children: React.ReactNode;
  className?: string;
  variant?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {children}
    </span>
  );
}
