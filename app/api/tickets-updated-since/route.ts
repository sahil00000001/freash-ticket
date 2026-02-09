// GET /api/tickets-updated-since?days=1 - Tickets updated since N days
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { fetchTicketsUpdatedSince, analyzeTickets } from "@/lib/freshservice";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const days = parseInt(searchParams.get("days") || "1") || 1;

  try {
    const tickets = await fetchTicketsUpdatedSince(days);
    const analysis = analyzeTickets(tickets);

    return NextResponse.json({
      endpoint: "Tickets Updated Since",
      days_lookback: days,
      analysis_timestamp: analysis.analysis_timestamp,
      total_tickets: analysis.total_tickets,
      summary: analysis.summary,
      tickets: analysis.tickets,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
