// GET /api/active-tickets - Active tickets (Open or Pending)
import { NextResponse } from "next/server";
import { fetchActiveTickets, analyzeTickets } from "@/lib/freshservice";

export async function GET() {
  try {
    const tickets = await fetchActiveTickets();
    const analysis = analyzeTickets(tickets);

    return NextResponse.json({
      endpoint: "Active Tickets (Open or Pending)",
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
