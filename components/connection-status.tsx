"use client";

import { Badge } from "@/components/ui/badge";
import { Circle } from "lucide-react";

interface ConnectionStatusProps {
  connected: boolean | null;
  apiKeyConfigured: boolean;
}

export function ConnectionStatus({
  connected,
  apiKeyConfigured,
}: ConnectionStatusProps) {
  if (!apiKeyConfigured) {
    return (
      <Badge
        variant="outline"
        className="gap-1.5 border-destructive/30 bg-destructive/10 text-destructive"
      >
        <Circle className="h-2 w-2 fill-current" />
        API Key Missing
      </Badge>
    );
  }

  if (connected === null) {
    return (
      <Badge
        variant="outline"
        className="gap-1.5 border-border bg-muted text-muted-foreground"
      >
        <Circle className="h-2 w-2 animate-pulse fill-current" />
        Checking...
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className={
        connected
          ? "gap-1.5 border-primary/30 bg-primary/10 text-primary"
          : "gap-1.5 border-destructive/30 bg-destructive/10 text-destructive"
      }
    >
      <Circle className="h-2 w-2 fill-current" />
      {connected ? "Connected" : "Connection Failed"}
    </Badge>
  );
}
