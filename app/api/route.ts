// GET / - Health check with connection test
import { NextResponse } from "next/server";
import { testApiConnection, getConfig } from "@/lib/freshservice";

export async function GET() {
  const config = getConfig();

  let connectionStatus = null;
  if (config.apiKeyConfigured) {
    connectionStatus = await testApiConnection();
  }

  return NextResponse.json({
    status: "ok",
    service: "Freshservice Ticket API",
    version: "3.0.0",
    authentication: {
      method: "API Key (Basic Auth)",
      api_key_configured: config.apiKeyConfigured,
      connection_test: connectionStatus,
    },
    config: {
      domain: config.domain,
      workspace_id: config.workspaceId,
      group_id: config.groupId,
    },
    endpoints: {
      "GET /api": "Health check with connection test",
      "GET /api/tickets-created-today": "All tickets created today",
      "GET /api/active-tickets":
        "All active tickets (Open or Pending status)",
      "GET /api/tickets-updated-since?days=1":
        "Tickets updated in last N days (default: 1)",
    },
    setup: !config.apiKeyConfigured
      ? {
          required_env_vars: [
            "FRESHSERVICE_API_KEY - Your Freshservice API key (found in Profile Settings)",
          ],
          optional_env_vars: [
            "FRESHSERVICE_DOMAIN - Default: yondrgroup.freshservice.com",
            "FRESHSERVICE_GROUP_ID - Default: 27000189625",
            "FRESHSERVICE_WORKSPACE_ID - Default: 2",
          ],
          how_to_get_api_key: [
            "1. Log in to Freshservice",
            '2. Click your profile picture (top right)',
            '3. Select "Profile Settings"',
            '4. Find "Your API Key" on the right side',
            "5. Copy and set as FRESHSERVICE_API_KEY",
          ],
        }
      : null,
  });
}
