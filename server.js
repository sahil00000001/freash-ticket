// server.js - Freshservice Ticket Analyzer API
// Three main endpoints for ticket retrieval

require('dotenv').config();
const express = require('express');

const app = express();
const PORT = process.env.PORT || 5000;

const CONFIG = {
  domain: process.env.FRESHSERVICE_DOMAIN || 'yondrgroup.freshservice.com',
  apiKey: process.env.FRESHSERVICE_API_KEY || '',
  groupId: process.env.FRESHSERVICE_GROUP_ID || '27000189625',
  workspaceId: parseInt(process.env.FRESHSERVICE_WORKSPACE_ID) || 2
};

function log(message, data = null) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
  if (data) console.log(JSON.stringify(data, null, 2));
}

function getAuthHeader() {
  if (!CONFIG.apiKey) {
    throw new Error('Missing FRESHSERVICE_API_KEY environment variable');
  }
  const authString = Buffer.from(`${CONFIG.apiKey}:X`).toString('base64');
  return `Basic ${authString}`;
}

function formatDate(isoString) {
  if (!isoString) return null;
  const date = new Date(isoString);
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

function analyzeTickets(tickets) {
  log(`Analyzing ${tickets.length} tickets...`);
  
  const priorityMap = { 1: 'P4', 2: 'P3', 3: 'P2', 4: 'P1' };
  const statusMap = { 2: 'Open', 3: 'Pending', 4: 'Resolved', 5: 'Closed' };
  
  const getUpdateStatus = (ticket) => {
    const stats = ticket.stats;
    if (!stats) return 'Unknown';
    
    // Check if resolved or closed
    if (stats.resolved_at) return 'Resolved - Work Complete';
    if (stats.closed_at) return 'Closed';
    
    // Check communication flow
    const agentResponded = !!stats.agent_responded_at;
    const requesterResponded = !!stats.requester_responded_at;
    const inboundCount = stats.inbound_count || 0;
    
    if (agentResponded && requesterResponded && inboundCount > 1) {
      return 'Active Discussion - Team & Client Communicating';
    }
    
    if (agentResponded && inboundCount > 1) {
      return 'Client Replied - Team Reviewing';
    }
    
    if (agentResponded && !requesterResponded) {
      return 'Awaiting Client Response - Team Replied';
    }
    
    if (agentResponded) {
      return 'Team Working On It - In Progress';
    }
    
    return 'New/Fresh - Not Yet Addressed';
  };
  
  const analyzedTickets = tickets.map(t => {
    const isFresh = !t.stats?.agent_responded_at && (t.stats?.outbound_count || 0) <= 1;
    const respTime = t.stats?.first_resp_time_in_secs 
      ? Math.round(t.stats.first_resp_time_in_secs / 60) 
      : null;
    
    // Extract name from subject if requester name is unknown
    let requesterName = t.requester?.name;
    if (!requesterName || requesterName === 'Unknown') {
      const subject = t.subject || '';
      // Regex to match "for [Name] :" or "for [Name] -"
      const match = subject.match(/for\s+(.*?)\s*[:|-]/i);
      if (match && match[1]) {
        requesterName = match[1].trim();
      } else {
        requesterName = 'Unknown';
      }
    }

    return {
      ticket_id: `#${t.id}`,
      subject: t.subject?.substring(0, 100) || 'No subject',
      priority_value: t.priority,
      priority_label: priorityMap[t.priority] || 'Unknown',
      requester_id: t.requester_id,
      requester_name: requesterName,
      status: statusMap[t.status] || `Status ${t.status}`,
      attendance_status: isFresh ? 'FRESH' : 'REPLIED',
      update_status: getUpdateStatus(t),
      response_time_minutes: respTime,
      created_at: formatDate(t.created_at),
      updated_at: formatDate(t.updated_at)
    };
  });

  const analysis = {
    analysis_timestamp: new Date().toISOString(),
    total_tickets: tickets.length,
    summary: {
      fresh_tickets: analyzedTickets.filter(t => t.attendance_status === 'FRESH').length,
      replied_tickets: analyzedTickets.filter(t => t.attendance_status === 'REPLIED').length,
      p1_count: analyzedTickets.filter(t => t.priority_label === 'P1').length,
      p2_count: analyzedTickets.filter(t => t.priority_label === 'P2').length,
      p3_count: analyzedTickets.filter(t => t.priority_label === 'P3').length,
      p4_count: analyzedTickets.filter(t => t.priority_label === 'P4').length
    },
    tickets: analyzedTickets
  };

  log('Analysis complete', { total: analysis.total_tickets, summary: analysis.summary });
  return analysis;
}

// API 1: Tickets created today
async function fetchTicketsCreatedToday() {
  const authHeader = getAuthHeader();
  const today = new Date().toISOString().split('T')[0];
  
  log(`Fetching tickets created today (${today})`);
  
  const allTickets = [];
  let currentPage = 1;
  let hasMore = true;

  while (hasMore) {
    let queryParts = [`created_at:>'${today}'`];
    
    if (CONFIG.groupId) {
      queryParts.push(`group_id:${CONFIG.groupId}`);
    }
    
    const query = `"${queryParts.join(' AND ')}"`;
    
    const params = new URLSearchParams({
      query: query,
      per_page: '100',
      page: currentPage.toString()
    });

    const url = `https://${CONFIG.domain}/api/v2/tickets/filter?${params}`;

    try {
      log(`Sending request to: ${url}`);
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(10000)
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
      log(`ERROR: ${error.message}`);
      throw error;
    }
  }

  return allTickets;
}

// API 2: Active tickets (status Open or Pending)
async function fetchActiveTickets() {
  const authHeader = getAuthHeader();
  
  log('Fetching active tickets (Open or Pending)');
  
  const allTickets = [];
  let currentPage = 1;
  let hasMore = true;

  while (hasMore) {
    let queryParts = [`(status:2 OR status:3)`];
    
    if (CONFIG.groupId) {
      queryParts.push(`group_id:${CONFIG.groupId}`);
    }
    
    const query = `"${queryParts.join(' AND ')}"`;
    
    const params = new URLSearchParams({
      query: query,
      per_page: '100',
      page: currentPage.toString()
    });

    const url = `https://${CONFIG.domain}/api/v2/tickets/filter?${params}`;

    try {
      log(`Sending request to: ${url}`);
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(10000)
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
      log(`ERROR: ${error.message}`);
      throw error;
    }
  }

  return allTickets;
}

// API 3: Tickets updated since (with datetime support)
async function fetchTicketsUpdatedSince(days = 1) {
  const authHeader = getAuthHeader();
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceDate = since.toISOString();
  
  log(`Fetching tickets updated since ${sinceDate}`);
  
  const allTickets = [];
  let currentPage = 1;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({
      updated_since: sinceDate,
      workspace_id: CONFIG.workspaceId.toString(),
      per_page: '100',
      page: currentPage.toString(),
      include: 'stats,requester'
    });

    const url = `https://${CONFIG.domain}/api/v2/tickets?${params}`;

    try {
      log(`Sending request to: ${url}`);
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(10000)
      });

      log(`Response status: ${response.status}`);
      if (!response.ok) {
        const errorText = await response.text();
        log(`Error body: ${errorText}`);
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const tickets = data.tickets || [];
      
      // Filter by group_id client-side
      const filteredTickets = tickets.filter(t => !CONFIG.groupId || t.group_id == CONFIG.groupId);
      
      allTickets.push(...filteredTickets);
      
      if (tickets.length < 100) {
        hasMore = false;
      } else {
        currentPage++;
      }
    } catch (error) {
      log(`ERROR: ${error.message}`);
      throw error;
    }
  }

  return allTickets;
}

async function testApiConnection() {
  log('Testing API connection...');
  
  try {
    const authHeader = getAuthHeader();
    const response = await fetch(`https://${CONFIG.domain}/api/v2/tickets?per_page=1`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 401) {
      return { success: false, error: 'Invalid API key' };
    }

    if (response.status === 403) {
      return { success: false, error: 'Access denied - check API key permissions' };
    }

    if (response.ok) {
      return { success: true };
    }

    return { success: false, error: `HTTP ${response.status}` };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

app.use(express.json());

app.get('/', async (req, res) => {
  log('Health check called');
  const apiKeySet = !!CONFIG.apiKey;
  
  let connectionStatus = null;
  if (apiKeySet) {
    connectionStatus = await testApiConnection();
  }
  
  res.json({ 
    status: 'ok', 
    service: 'Freshservice Ticket API',
    version: '3.0.0',
    authentication: {
      method: 'API Key (Basic Auth)',
      api_key_configured: apiKeySet,
      connection_test: connectionStatus
    },
    config: {
      domain: CONFIG.domain,
      workspace_id: CONFIG.workspaceId,
      group_id: CONFIG.groupId
    },
    endpoints: {
      'GET /': 'Health check with connection test',
      'GET /api/tickets-created-today': 'All tickets created today',
      'GET /api/active-tickets': 'All active tickets (Open or Pending status)',
      'GET /api/tickets-updated-since?days=1': 'Tickets updated in last N days (default: 1)'
    },
    setup: !apiKeySet ? {
      required_env_vars: [
        'FRESHSERVICE_API_KEY - Your Freshservice API key (found in Profile Settings)'
      ],
      optional_env_vars: [
        'FRESHSERVICE_DOMAIN - Default: yondrgroup.freshservice.com',
        'FRESHSERVICE_GROUP_ID - Default: 27000189625',
        'FRESHSERVICE_WORKSPACE_ID - Default: 2'
      ],
      how_to_get_api_key: [
        '1. Log in to Freshservice',
        '2. Click your profile picture (top right)',
        '3. Select "Profile Settings"',
        '4. Find "Your API Key" on the right side',
        '5. Copy and set as FRESHSERVICE_API_KEY'
      ]
    } : null
  });
});

// API 1: Tickets created today
app.get('/api/tickets-created-today', async (req, res) => {
  log('=== GET /api/tickets-created-today called ===');
  
  try {
    const tickets = await fetchTicketsCreatedToday();
    const analysis = analyzeTickets(tickets);
    
    res.json({
      endpoint: 'Tickets Created Today',
      analysis_timestamp: analysis.analysis_timestamp,
      total_tickets: analysis.total_tickets,
      summary: analysis.summary,
      tickets: analysis.tickets
    });
    
    log('=== Request completed successfully ===');
  } catch (error) {
    log(`ERROR: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// API 2: Active tickets (Open or Pending)
app.get('/api/active-tickets', async (req, res) => {
  log('=== GET /api/active-tickets called ===');
  
  try {
    const tickets = await fetchActiveTickets();
    const analysis = analyzeTickets(tickets);
    
    res.json({
      endpoint: 'Active Tickets (Open or Pending)',
      analysis_timestamp: analysis.analysis_timestamp,
      total_tickets: analysis.total_tickets,
      summary: analysis.summary,
      tickets: analysis.tickets
    });
    
    log('=== Request completed successfully ===');
  } catch (error) {
    log(`ERROR: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// API 3: Tickets updated since
app.get('/api/tickets-updated-since', async (req, res) => {
  const days = parseInt(req.query.days) || 1;
  log(`=== GET /api/tickets-updated-since called (days: ${days}) ===`);
  
  try {
    const tickets = await fetchTicketsUpdatedSince(days);
    const analysis = analyzeTickets(tickets);
    
    res.json({
      endpoint: 'Tickets Updated Since',
      days_lookback: days,
      analysis_timestamp: analysis.analysis_timestamp,
      total_tickets: analysis.total_tickets,
      summary: analysis.summary,
      tickets: analysis.tickets
    });
    
    log('=== Request completed successfully ===');
  } catch (error) {
    log(`ERROR: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  log(`Freshservice API running on 0.0.0.0:${PORT}`);
  log('Version: 3.0.0');
  
  if (CONFIG.apiKey) {
    log('API key configured. Ready to fetch tickets.');
  } else {
    log('WARNING: No API key configured.');
    log('Set FRESHSERVICE_API_KEY environment variable.');
  }
});
