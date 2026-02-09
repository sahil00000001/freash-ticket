"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { AnalyzedTicket } from "@/lib/freshservice";

interface TicketTableProps {
  tickets: AnalyzedTicket[];
  loading: boolean;
}

function PriorityBadge({ priority }: { priority: string }) {
  const variants: Record<string, string> = {
    P1: "bg-destructive/15 text-destructive border-destructive/30",
    P2: "bg-chart-3/15 text-chart-3 border-chart-3/30",
    P3: "bg-chart-2/15 text-chart-2 border-chart-2/30",
    P4: "bg-muted text-muted-foreground border-border",
  };

  return (
    <Badge
      variant="outline"
      className={`font-mono text-xs ${variants[priority] || variants.P4}`}
    >
      {priority}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  const isOpen = status === "Open";
  const isPending = status === "Pending";

  return (
    <Badge
      variant="outline"
      className={
        isOpen
          ? "bg-primary/15 text-primary border-primary/30"
          : isPending
            ? "bg-chart-3/15 text-chart-3 border-chart-3/30"
            : "bg-muted text-muted-foreground border-border"
      }
    >
      {status}
    </Badge>
  );
}

function AttendanceBadge({ status }: { status: "FRESH" | "REPLIED" }) {
  return (
    <Badge
      variant="outline"
      className={
        status === "FRESH"
          ? "bg-chart-3/15 text-chart-3 border-chart-3/30 font-semibold"
          : "bg-primary/15 text-primary border-primary/30"
      }
    >
      {status}
    </Badge>
  );
}

export function TicketTable({ tickets, loading }: TicketTableProps) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-12 animate-pulse rounded-md bg-muted"
          />
        ))}
      </div>
    );
  }

  if (tickets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
        <p className="text-lg">No tickets found</p>
        <p className="text-sm">
          Try selecting a different view or check your API configuration.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <TableHead className="text-muted-foreground">ID</TableHead>
            <TableHead className="text-muted-foreground">Subject</TableHead>
            <TableHead className="text-muted-foreground">Priority</TableHead>
            <TableHead className="text-muted-foreground">Status</TableHead>
            <TableHead className="text-muted-foreground">Attendance</TableHead>
            <TableHead className="text-muted-foreground">Requester</TableHead>
            <TableHead className="text-muted-foreground">Update Status</TableHead>
            <TableHead className="text-muted-foreground text-right">
              Resp. Time
            </TableHead>
            <TableHead className="text-muted-foreground">Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tickets.map((ticket) => (
            <TableRow
              key={ticket.ticket_id}
              className="border-border hover:bg-accent/50"
            >
              <TableCell className="font-mono text-sm text-primary">
                {ticket.ticket_id}
              </TableCell>
              <TableCell className="max-w-[300px] truncate text-sm text-foreground">
                {ticket.subject}
              </TableCell>
              <TableCell>
                <PriorityBadge priority={ticket.priority_label} />
              </TableCell>
              <TableCell>
                <StatusBadge status={ticket.status} />
              </TableCell>
              <TableCell>
                <AttendanceBadge status={ticket.attendance_status} />
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {ticket.requester_name}
              </TableCell>
              <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                {ticket.update_status}
              </TableCell>
              <TableCell className="text-right font-mono text-sm text-muted-foreground">
                {ticket.response_time_minutes !== null
                  ? `${ticket.response_time_minutes}m`
                  : "-"}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {ticket.created_at || "-"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
