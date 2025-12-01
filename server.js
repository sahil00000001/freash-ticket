// server.js - Freshservice Ticket Analyzer API (Lightweight)
// No Puppeteer - uses direct HTTP requests

require('dotenv').config();
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// Store session cookies (set via /api/set-cookies endpoint)
let SESSION_COOKIES = process.env.FRESHSERVICE_COOKIES || '';

const CONFIG = {
  domain: 'yondrgroup.freshservice.com',
  filterId: '27000160172',
  groupId: '27000189625',
  workspaceId: 2,
  createdWithinMinutes: 1440
};

// ============ LOGGING HELPER ============
function log(message, data = null) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
  if (data) console.log(JSON.stringify(data, null, 2));
}

// ============ LOCAL ANALYSIS ============
function analyzeTickets(tickets) {
  log(`Analyzing ${tickets.length} tickets...`);
  
  const priorityMap = { 1: 'P4', 2: 'P3', 3: 'P2', 4: 'P1' };
  
  const analyzedTickets = tickets.map(t => {
    const isFresh = !t.stats?.agent_responded_at && (t.stats?.outbound_count || 0) <= 1;
    const respTime = t.stats?.first_resp_time_in_secs 
      ? Math.round(t.stats.first_resp_time_in_secs / 60) 
      : null;
    
    return {
      ticket_id: t.human_display_id || `#${t.id}`,
      subject: t.subject?.substring(0, 100) || 'No subject',
      priority: priorityMap[t.priority] || 'P4',
      requester_name: t.requester?.name || 'Unknown',
      requester_location: t.requester?.location_name || 'Unknown',
      status: t.ticket_status?.name || 'Unknown',
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

// ============ FETCH TICKETS (Direct HTTP) ============
async function fetchTicketsFromAPI(options = {}) {
  const { minutes = CONFIG.createdWithinMinutes } = options;
  
  log(`Starting ticket fetch (last ${minutes} minutes)`);
  
  if (!SESSION_COOKIES) {
    log('ERROR: No session cookies set!');
    throw new Error('No session cookies. Call POST /api/set-cookies first');
  }

  const queryHash = JSON.stringify([
    { value: [{ id: CONFIG.workspaceId }], condition: 'workspace_id', operator: 'is_in', type: 'default' },
    { value: [CONFIG.groupId], condition: 'group_id', operator: 'is_in', type: 'default' },
    { value: String(minutes), condition: 'created_at', operator: 'is_greater_than', type: 'default' }
  ]);

  log('Query hash built', { workspaceId: CONFIG.workspaceId, groupId: CONFIG.groupId });

  const allTickets = [];
  let currentPage = 1;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({
      filter: CONFIG.filterId,
      include: 'stats,responder,requester,ticket_states,ticket_status,group',
      order_by: 'created_at',
      order_type: 'desc',
      page: currentPage,
      per_page: 100,
      query_hash: queryHash,
      workspace_id: CONFIG.workspaceId,
      cache: 'true'
    });

    const url = `https://${CONFIG.domain}/api/_/tickets?${params}`;
    log(`Fetching page ${currentPage}...`);
    log(`URL: ${url.substring(0, 100)}...`);

    try {
      const startTime = Date.now();
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': '*/*',
          'Cookie': SESSION_COOKIES,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      const elapsed = Date.now() - startTime;
      log(`Response received in ${elapsed}ms - Status: ${response.status}`);

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          log('ERROR: Session expired or invalid cookies');
          throw new Error('Session expired. Update cookies via POST /api/set-cookies');
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const tickets = data.tickets || [];
      
      log(`Page ${currentPage}: Found ${tickets.length} tickets`);
      
      allTickets.push(...tickets);
      hasMore = tickets.length === 100;
      currentPage++;

    } catch (fetchError) {
      log(`ERROR on page ${currentPage}: ${fetchError.message}`);
      throw fetchError;
    }
  }

  log(`Total tickets fetched: ${allTickets.length}`);
  return allTickets;
}

// ============ API ROUTES ============

// Middleware to parse JSON
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  log('Health check called');
  res.json({ 
    status: 'ok', 
    service: 'Freshservice Ticket Analyzer',
    cookies_set: !!SESSION_COOKIES,
    endpoints: {
      'GET /': 'Health check',
      'POST /api/set-cookies': 'Set session cookies (body: { cookies: "..." })',
      'GET /api/tickets': 'Full ticket analysis',
      'GET /api/tickets?minutes=720': 'Tickets from last 12 hours',
      'GET /api/tickets/fresh': 'Only unattended tickets',
      'GET /api/tickets/summary': 'Summary counts only'
    }
  });
});

// Set cookies endpoint
app.post('/api/set-cookies', (req, res) => {
  log('Set cookies endpoint called');
  
  const { cookies } = req.body;
  
  if (!cookies) {
    log('ERROR: No cookies provided');
    return res.status(400).json({ error: 'Missing cookies in request body' });
  }

  SESSION_COOKIES = cookies;
  log('Cookies updated successfully', { length: cookies.length });
  
  res.json({ 
    success: true, 
    message: 'Cookies set successfully',
    cookies_length: cookies.length 
  });
});

// Get cookies status
app.get('/api/cookies-status', (req, res) => {
  log('Cookies status check');
  res.json({
    cookies_set: !!SESSION_COOKIES,
    cookies_length: SESSION_COOKIES.length
  });
});

// Get all tickets with analysis
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
      hint: error.message.includes('cookies') ? 'Set cookies via POST /api/set-cookies' : null
    });
  }
});

// Get only fresh/unattended tickets
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

// Get summary only
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

// Start server
app.listen(PORT, () => {
  log(`🚀 Freshservice API running on port ${PORT}`);
  log(`Cookies pre-set: ${!!SESSION_COOKIES}`);
  if (!SESSION_COOKIES) {
    log('⚠️  No cookies set. Use POST /api/set-cookies or set FRESHSERVICE_COOKIES env var');
  }
});