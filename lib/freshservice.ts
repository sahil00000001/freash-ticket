// lib/freshservice.ts - Freshservice API utility functions
// Converted from server.js Express backend

const CONFIG = {
  domain: process.env.FRESHSERVICE_DOMAIN || "yondrgroup.freshservice.com",
  apiKey: process.env.FRESHSERVICE_API_KEY || "",
  groupId: process.env.FRESHSERVICE_GROUP_ID || "27000189625",
  workspaceId: parseInt(process.env.FRESHSERVICE_WORKSPACE_ID || "2"),
};

function log(message: string, data: unknown = null) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
  if (data) console.log(JSON.stringify(data, null, 2));
}

function getAuthHeader(): string {
  if (!CONFIG.apiKey) {
    throw new Error("Missing FRESHSERVICE_API_KEY environment variable");
  }
  const authString = Buffer.from(`${CONFIG.apiKey}:X`).toString("base64");
  return `Basic ${authString}`;
}

function formatDate(isoString: string | null | undefined): string | null {
  if (!isoString) return null;
  const date = new Date(isoString);
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

interface TicketStats {
  resolved_at?: string | null;
  closed_at?: string | null;
  agent_responded_at?: string | null;
  requester_responded_at?: string | null;
  inbound_count?: number;
  outbound_count?: number;
  first_resp_time_in_secs?: number | null;
}

interface FreshserviceTicket {
  id: number;
  subject?: string;
  priority: number;
  status: number;
  requester_id?: number;
  requester?: { name?: string };
  group_id?: number;
  stats?: TicketStats;
  created_at?: string;
  updated_at?: string;
}

export interface AnalyzedTicket {
  ticket_id: string;
  subject: string;
  priority_value: number;
  priority_label: string;
  requester_id?: number;
  requester_name: string;
  status: string;
  attendance_status: "FRESH" | "REPLIED";
  update_status: string;
  response_time_minutes: number | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface TicketAnalysis {
  analysis_timestamp: string;
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
}

function getUpdateStatus(ticket: FreshserviceTicket): string {
  const stats = ticket.stats;
  if (!stats) return "Unknown";

  if (stats.resolved_at) return "Resolved - Work Complete";
  if (stats.closed_at) return "Closed";

  const agentResponded = !!stats.agent_responded_at;
  const requesterResponded = !!stats.requester_responded_at;
  const inboundCount = stats.inbound_count || 0;

  if (agentResponded && requesterResponded && inboundCount > 1) {
    return "Active Discussion - Team & Client Communicating";
  }

  if (agentResponded && inboundCount > 1) {
    return "Client Replied - Team Reviewing";
  }

  if (agentResponded && !requesterResponded) {
    return "Awaiting Client Response - Team Replied";
  }

  if (agentResponded) {
    return "Team Working On It - In Progress";
  }

  return "New/Fresh - Not Yet Addressed";
}

export function analyzeTickets(tickets: FreshserviceTicket[]): TicketAnalysis {
  log(`Analyzing ${tickets.length} tickets...`);

  const priorityMap: Record<number, string> = {
    1: "P4",
    2: "P3",
    3: "P2",
    4: "P1",
  };
  const statusMap: Record<number, string> = {
    2: "Open",
    3: "Pending",
    4: "Resolved",
    5: "Closed",
  };

  const analyzedTickets: AnalyzedTicket[] = tickets.map((t) => {
    const isFresh =
      !t.stats?.agent_responded_at && (t.stats?.outbound_count || 0) <= 1;
    const respTime = t.stats?.first_resp_time_in_secs
      ? Math.round(t.stats.first_resp_time_in_secs / 60)
      : null;

    let requesterName = t.requester?.name;
    if (!requesterName || requesterName === "Unknown") {
      const subject = t.subject || "";
      const match = subject.match(/for\s+(.*?)\s*[:|-]/i);
      if (match && match[1]) {
        requesterName = match[1].trim();
      } else {
        requesterName = "Unknown";
      }
    }

    return {
      ticket_id: `#${t.id}`,
      subject: t.subject?.substring(0, 100) || "No subject",
      priority_value: t.priority,
      priority_label: priorityMap[t.priority] || "Unknown",
      requester_id: t.requester_id,
      requester_name: requesterName,
      status: statusMap[t.status] || `Status ${t.status}`,
      attendance_status: isFresh ? ("FRESH" as const) : ("REPLIED" as const),
      update_status: getUpdateStatus(t),
      response_time_minutes: respTime,
      created_at: formatDate(t.created_at),
      updated_at: formatDate(t.updated_at),
    };
  });

  const analysis: TicketAnalysis = {
    analysis_timestamp: new Date().toISOString(),
    total_tickets: tickets.length,
    summary: {
      fresh_tickets: analyzedTickets.filter(
        (t) => t.attendance_status === "FRESH"
      ).length,
      replied_tickets: analyzedTickets.filter(
        (t) => t.attendance_status === "REPLIED"
      ).length,
      p1_count: analyzedTickets.filter((t) => t.priority_label === "P1").length,
      p2_count: analyzedTickets.filter((t) => t.priority_label === "P2").length,
      p3_count: analyzedTickets.filter((t) => t.priority_label === "P3").length,
      p4_count: analyzedTickets.filter((t) => t.priority_label === "P4").length,
    },
    tickets: analyzedTickets,
  };

  log("Analysis complete", {
    total: analysis.total_tickets,
    summary: analysis.summary,
  });
  return analysis;
}

// API 1: Tickets created today
export async function fetchTicketsCreatedToday(): Promise<FreshserviceTicket[]> {
  const authHeader = getAuthHeader();
  const today = new Date().toISOString().split("T")[0];

  log(`Fetching tickets created today (${today})`);

  const allTickets: FreshserviceTicket[] = [];
  let currentPage = 1;
  let hasMore = true;

  while (hasMore) {
    const queryParts = [`created_at:>'${today}'`];

    if (CONFIG.groupId) {
      queryParts.push(`group_id:${CONFIG.groupId}`);
    }

    const query = `"${queryParts.join(" AND ")}"`;

    const params = new URLSearchParams({
      query: query,
      per_page: "100",
      page: currentPage.toString(),
    });

    const url = `https://${CONFIG.domain}/api/v2/tickets/filter?${params}`;

    try {
      log(`Sending request to: ${url}`);
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(10000),
      });

      log(`Response status: ${response.status}`);
      if (!response.ok) {
        const errorText = await response.text();
        log(`Error body: ${errorText}`);
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const tickets = data.tickets || [];

      allTickets.push(...tickets);

      if (tickets.length < 100) {
        hasMore = false;
      } else {
        currentPage++;
      }
    } catch (error) {
      log(`ERROR: ${(error as Error).message}`);
      throw error;
    }
  }

  return allTickets;
}

// API 2: Active tickets (status Open or Pending)
export async function fetchActiveTickets(): Promise<FreshserviceTicket[]> {
  const authHeader = getAuthHeader();

  log("Fetching active tickets (Open or Pending)");

  const allTickets: FreshserviceTicket[] = [];
  let currentPage = 1;
  let hasMore = true;

  while (hasMore) {
    const queryParts = [`(status:2 OR status:3)`];

    if (CONFIG.groupId) {
      queryParts.push(`group_id:${CONFIG.groupId}`);
    }

    const query = `"${queryParts.join(" AND ")}"`;

    const params = new URLSearchParams({
      query: query,
      per_page: "100",
      page: currentPage.toString(),
    });

    const url = `https://${CONFIG.domain}/api/v2/tickets/filter?${params}`;

    try {
      log(`Sending request to: ${url}`);
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(10000),
      });

      log(`Response status: ${response.status}`);
      if (!response.ok) {
        const errorText = await response.text();
        log(`Error body: ${errorText}`);
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const tickets = data.tickets || [];

      allTickets.push(...tickets);

      if (tickets.length < 100) {
        hasMore = false;
      } else {
        currentPage++;
      }
    } catch (error) {
      log(`ERROR: ${(error as Error).message}`);
      throw error;
    }
  }

  return allTickets;
}

// API 3: Tickets updated since (with datetime support)
export async function fetchTicketsUpdatedSince(
  days: number = 1
): Promise<FreshserviceTicket[]> {
  const authHeader = getAuthHeader();
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceDate = since.toISOString();

  log(`Fetching tickets updated since ${sinceDate}`);

  const allTickets: FreshserviceTicket[] = [];
  let currentPage = 1;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({
      updated_since: sinceDate,
      workspace_id: CONFIG.workspaceId.toString(),
      per_page: "100",
      page: currentPage.toString(),
      include: "stats,requester",
    });

    const url = `https://${CONFIG.domain}/api/v2/tickets?${params}`;

    try {
      log(`Sending request to: ${url}`);
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(10000),
      });

      log(`Response status: ${response.status}`);
      if (!response.ok) {
        const errorText = await response.text();
        log(`Error body: ${errorText}`);
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const tickets = data.tickets || [];

      const filteredTickets = tickets.filter(
        (t: FreshserviceTicket) =>
          !CONFIG.groupId || String(t.group_id) === String(CONFIG.groupId)
      );

      allTickets.push(...filteredTickets);

      if (tickets.length < 100) {
        hasMore = false;
      } else {
        currentPage++;
      }
    } catch (error) {
      log(`ERROR: ${(error as Error).message}`);
      throw error;
    }
  }

  return allTickets;
}

export async function testApiConnection(): Promise<{
  success: boolean;
  error?: string;
}> {
  log("Testing API connection...");

  try {
    const authHeader = getAuthHeader();
    const response = await fetch(
      `https://${CONFIG.domain}/api/v2/tickets?per_page=1`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.status === 401) {
      return { success: false, error: "Invalid API key" };
    }

    if (response.status === 403) {
      return {
        success: false,
        error: "Access denied - check API key permissions",
      };
    }

    if (response.ok) {
      return { success: true };
    }

    return { success: false, error: `HTTP ${response.status}` };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export function getConfig() {
  return {
    domain: CONFIG.domain,
    workspaceId: CONFIG.workspaceId,
    groupId: CONFIG.groupId,
    apiKeyConfigured: !!CONFIG.apiKey,
  };
}
