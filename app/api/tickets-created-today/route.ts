// GET /api/tickets-created-today - Tickets created today
import { NextResponse } from "next/server";
import { fetchTicketsCreatedToday, analyzeTickets } from "@/lib/freshservice";

export async function GET() {
  try {
    const tickets = await fetchTicketsCreatedToday();
    const analysis = analyzeTickets(tickets);

    return NextResponse.json({
      endpoint: "Tickets Created Today",
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
