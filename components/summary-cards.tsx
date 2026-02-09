"use client";

import { Card, CardContent } from "@/components/ui/card";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Inbox,
  Ticket,
  Zap,
} from "lucide-react";

interface Summary {
  fresh_tickets: number;
  replied_tickets: number;
  p1_count: number;
  p2_count: number;
  p3_count: number;
  p4_count: number;
}

interface SummaryCardsProps {
  totalTickets: number;
  summary: Summary | null;
  loading: boolean;
}

export function SummaryCards({
  totalTickets,
  summary,
  loading,
}: SummaryCardsProps) {
  const cards = [
    {
      label: "Total Tickets",
      value: totalTickets,
      icon: Ticket,
      color: "text-primary",
      bgColor: "bg-primary/10",
    },
    {
      label: "Fresh (Unattended)",
      value: summary?.fresh_tickets ?? 0,
      icon: Zap,
      color: "text-chart-3",
      bgColor: "bg-chart-3/10",
    },
    {
      label: "Replied",
      value: summary?.replied_tickets ?? 0,
      icon: CheckCircle2,
      color: "text-primary",
      bgColor: "bg-primary/10",
    },
    {
      label: "P1 Critical",
      value: summary?.p1_count ?? 0,
      icon: AlertTriangle,
      color: "text-destructive",
      bgColor: "bg-destructive/10",
    },
    {
      label: "P2 High",
      value: summary?.p2_count ?? 0,
      icon: Clock,
      color: "text-chart-3",
      bgColor: "bg-chart-3/10",
    },
    {
      label: "P3/P4",
      value: (summary?.p3_count ?? 0) + (summary?.p4_count ?? 0),
      icon: Inbox,
      color: "text-muted-foreground",
      bgColor: "bg-muted/50",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
      {cards.map((card) => (
        <Card key={card.label} className="border-border bg-card">
          <CardContent className="flex flex-col gap-3 p-4">
            <div className="flex items-center gap-2">
              <div className={`rounded-md p-1.5 ${card.bgColor}`}>
                <card.icon className={`h-4 w-4 ${card.color}`} />
              </div>
              <span className="text-xs text-muted-foreground">
                {card.label}
              </span>
            </div>
            {loading ? (
              <div className="h-8 w-16 animate-pulse rounded bg-muted" />
            ) : (
              <p className={`text-2xl font-semibold tracking-tight ${card.color}`}>
                {card.value}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
