// server.js - Freshservice Ticket Analyzer API
// Uses API Key authentication (required since May 2023)

require('dotenv').config();
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

const CONFIG = {
  domain: process.env.FRESHSERVICE_DOMAIN || 'yondrgroup.freshservice.com',
  apiKey: process.env.FRESHSERVICE_API_KEY || '',
  filterId: process.env.FRESHSERVICE_FILTER_ID || '27000160172',
  groupId: process.env.FRESHSERVICE_GROUP_ID || '27000189625',
  workspaceId: parseInt(process.env.FRESHSERVICE_WORKSPACE_ID) || 2,
  createdWithinMinutes: 1440
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

function analyzeTickets(tickets) {
  log(`Analyzing ${tickets.length} tickets...`);
  
  const priorityMap = { 1: 'P4', 2: 'P3', 3: 'P2', 4: 'P1' };
  const statusMap = { 2: 'Open', 3: 'Pending', 4: 'Resolved', 5: 'Closed' };
  
  const analyzedTickets = tickets.map(t => {
    const isFresh = !t.stats?.agent_responded_at && (t.stats?.outbound_count || 0) <= 1;
    const respTime = t.stats?.first_resp_time_in_secs 
      ? Math.round(t.stats.first_resp_time_in_secs / 60) 
      : null;
    
    return {
      ticket_id: `#${t.id}`,
      subject: t.subject?.substring(0, 100) || 'No subject',
      priority: priorityMap[t.priority] || 'P4',
      requester_id: t.requester_id,
      requester_name: t.requester?.name || 'Unknown',
      status: statusMap[t.status] || `Status ${t.status}`,
      attendance_status: isFresh ? 'FRESH' : 'REPLIED',
      response_time_minutes: respTime,
      created_at: t.created_at,
      updated_at: t.updated_at
    };
  });

  const analysis = {
    analysis_timestamp: new Date().toISOString(),
    total_tickets: tickets.length,
    summary: {
      fresh_tickets: analyzedTickets.filter(t => t.attendance_status === 'FRESH').length,
      replied_tickets: analyzedTickets.filter(t => t.attendance_status === 'REPLIED').length,
      p1_count: analyzedTickets.filter(t => t.priority === 'P1').length,
      p2_count: analyzedTickets.filter(t => t.priority === 'P2').length,
      p3_count: analyzedTickets.filter(t => t.priority === 'P3').length,
      p4_count: analyzedTickets.filter(t => t.priority === 'P4').length
    },
    tickets: analyzedTickets
  };

  log('Analysis complete', { total: analysis.total_tickets, summary: analysis.summary });
  return analysis;
}

async function fetchTicketsFromAPI(options = {}) {
  const { minutes = CONFIG.createdWithinMinutes } = options;
  
  log(`Starting ticket fetch (last ${minutes} minutes)`);

  const authHeader = getAuthHeader();
  
  const cutoffDate = new Date(Date.now() - minutes * 60 * 1000);
  const dateStr = cutoffDate.toISOString().split('.')[0] + 'Z';

  const allTickets = [];
  let currentPage = 1;
  let hasMore = true;

  while (hasMore) {
    let queryParts = [];
    queryParts.push(`created_at:>'${dateStr}'`);
    
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
    log(`Fetching page ${currentPage}... Query: ${query}`);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        }
      });

      if (response.status === 401) {
        throw new Error('Invalid API key. Please check your FRESHSERVICE_API_KEY.');
      }

      if (response.status === 403) {
        throw new Error('Access denied. Your API key may not have permission to access tickets.');
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const tickets = data.tickets || [];
      
      log(`Page ${currentPage}: Found ${tickets.length} tickets`);
      
      allTickets.push(...tickets);
      
      if (tickets.length < 100) {
        hasMore = false;
      } else {
        currentPage++;
      }

    } catch (error) {
      log(`ERROR on page ${currentPage}: ${error.message}`);
      throw error;
    }
  }

  log(`Total tickets fetched: ${allTickets.length}`);
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
    service: 'Freshservice Ticket Analyzer',
    version: '3.0.0-apikey',
    authentication: {
      method: 'API Key (Basic Auth)',
      api_key_configured: apiKeySet,
      connection_test: connectionStatus
    },
    config: {
      domain: CONFIG.domain,
      workspace_id: CONFIG.workspaceId,
      group_id: CONFIG.groupId,
      filter_id: CONFIG.filterId
    },
    endpoints: {
      'GET /': 'Health check with connection test',
      'GET /api/tickets': 'Full ticket analysis',
      'GET /api/tickets?minutes=720': 'Tickets from last 12 hours',
      'GET /api/tickets/fresh': 'Only unattended tickets',
      'GET /api/tickets/summary': 'Summary counts only'
    },
    setup: !apiKeySet ? {
      required_env_vars: [
        'FRESHSERVICE_API_KEY - Your Freshservice API key (found in Profile Settings)'
      ],
      optional_env_vars: [
        'FRESHSERVICE_DOMAIN - Default: yondrgroup.freshservice.com',
        'FRESHSERVICE_FILTER_ID - Default: 27000160172',
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

app.get('/api/tickets', async (req, res) => {
  const minutes = parseInt(req.query.minutes) || CONFIG.createdWithinMinutes;
  log(`=== GET /api/tickets called (minutes: ${minutes}) ===`);
  
  try {
    log('Step 1: Fetching tickets from Freshservice...');
    const tickets = await fetchTicketsFromAPI({ minutes });
    
    log('Step 2: Analyzing tickets...');
    const analysis = analyzeTickets(tickets);
    
    log('Step 3: Sending response...');
    res.json(analysis);
    
    log('=== Request completed successfully ===');
    
  } catch (error) {
    log(`ERROR: ${error.message}`);
    res.status(500).json({ 
      error: error.message,
      hint: error.message.includes('API key') ? 
        'Set FRESHSERVICE_API_KEY environment variable with your API key from Profile Settings' : null
    });
  }
});

app.get('/api/tickets/fresh', async (req, res) => {
  const minutes = parseInt(req.query.minutes) || CONFIG.createdWithinMinutes;
  log(`=== GET /api/tickets/fresh called (minutes: ${minutes}) ===`);
  
  try {
    const tickets = await fetchTicketsFromAPI({ minutes });
    const analysis = analyzeTickets(tickets);
    const freshTickets = analysis.tickets.filter(t => t.attendance_status === 'FRESH');
    
    log(`Found ${freshTickets.length} fresh tickets`);
    
    res.json({
      analysis_timestamp: analysis.analysis_timestamp,
      total_fresh: freshTickets.length,
      tickets: freshTickets
    });
    
  } catch (error) {
    log(`ERROR: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/tickets/summary', async (req, res) => {
  const minutes = parseInt(req.query.minutes) || CONFIG.createdWithinMinutes;
  log(`=== GET /api/tickets/summary called (minutes: ${minutes}) ===`);
  
  try {
    const tickets = await fetchTicketsFromAPI({ minutes });
    const analysis = analyzeTickets(tickets);
    
    res.json({
      analysis_timestamp: analysis.analysis_timestamp,
      total_tickets: analysis.total_tickets,
      summary: analysis.summary
    });
    
  } catch (error) {
    log(`ERROR: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  log(`Freshservice API running on 0.0.0.0:${PORT}`);
  log('Version: 3.0.0-apikey (API Key authentication)');
  
  if (CONFIG.apiKey) {
    log('API key configured. Ready to fetch tickets.');
  } else {
    log('WARNING: No API key configured.');
    log('Set FRESHSERVICE_API_KEY environment variable.');
  }
});
