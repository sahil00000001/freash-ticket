// server.js - Freshservice Ticket Analyzer API
// Deploy on Render.com

require('dotenv').config();
const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

const CONFIG = {
  domain: 'yondrgroup.freshservice.com',
  email: process.env.FRESHSERVICE_EMAIL,
  password: process.env.FRESHSERVICE_PASSWORD,
  cookiesPath: '/tmp/freshservice-cookies.json',
  filterId: '27000160172',
  groupId: '27000189625',
  workspaceId: 2,
  createdWithinMinutes: 1440
};

// ============ LOCAL ANALYSIS ============
function analyzeTickets(tickets) {
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

  return {
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
}

// ============ FRESHSERVICE FUNCTIONS ============
async function saveCookies(page) {
  const cookies = await page.cookies();
  fs.writeFileSync(CONFIG.cookiesPath, JSON.stringify(cookies, null, 2));
}

async function loadCookies(page) {
  try {
    if (fs.existsSync(CONFIG.cookiesPath)) {
      const cookies = JSON.parse(fs.readFileSync(CONFIG.cookiesPath));
      await page.setCookie(...cookies);
      return true;
    }
  } catch (e) {}
  return false;
}

async function login(page) {
  await page.goto(`https://${CONFIG.domain}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[type="email"], input[name="email"], #user_email');
  await page.type('input[type="email"], input[name="email"], #user_email', CONFIG.email);
  await page.type('input[type="password"], input[name="password"], #user_password', CONFIG.password);
  await page.click('button[type="submit"], input[type="submit"], .login-btn');
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
  
  if (page.url().includes('/login')) {
    throw new Error('Login failed');
  }
  await saveCookies(page);
}

async function isSessionValid(page) {
  try {
    await page.goto(`https://${CONFIG.domain}/a/tickets`, { waitUntil: 'networkidle2', timeout: 15000 });
    return !page.url().includes('/login');
  } catch { return false; }
}

async function fetchTickets(page, options = {}) {
  const { minutes = CONFIG.createdWithinMinutes } = options;
  
  const queryHash = JSON.stringify([
    { value: [{ id: CONFIG.workspaceId }], condition: 'workspace_id', operator: 'is_in', type: 'default' },
    { value: [CONFIG.groupId], condition: 'group_id', operator: 'is_in', type: 'default' },
    { value: String(minutes), condition: 'created_at', operator: 'is_greater_than', type: 'default' }
  ]);

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
    
    const response = await page.evaluate(async (apiUrl) => {
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }, url);

    const tickets = response.tickets || [];
    allTickets.push(...tickets);
    hasMore = tickets.length === 100;
    currentPage++;
  }

  return allTickets;
}

// ============ MAIN FETCH FUNCTION ============
async function getTicketAnalysis(options = {}) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  try {
    const hasCookies = await loadCookies(page);
    
    if (!hasCookies || !(await isSessionValid(page))) {
      await login(page);
    }

    const tickets = await fetchTickets(page, options);
    const analysis = analyzeTickets(tickets);
    
    return { success: true, data: analysis };

  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    await browser.close();
  }
}

// ============ API ROUTES ============

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'Freshservice Ticket Analyzer',
    endpoints: {
      '/': 'Health check',
      '/api/tickets': 'Get ticket analysis (query: ?minutes=1440)',
      '/api/tickets/fresh': 'Get only fresh/unattended tickets',
      '/api/tickets/summary': 'Get summary only'
    }
  });
});

// Get all tickets with analysis
app.get('/api/tickets', async (req, res) => {
  const minutes = parseInt(req.query.minutes) || CONFIG.createdWithinMinutes;
  
  console.log(`[${new Date().toISOString()}] Fetching tickets (last ${minutes} mins)...`);
  
  const result = await getTicketAnalysis({ minutes });
  
  if (result.success) {
    console.log(`[${new Date().toISOString()}] Found ${result.data.total_tickets} tickets`);
    res.json(result.data);
  } else {
    console.error(`[${new Date().toISOString()}] Error: ${result.error}`);
    res.status(500).json({ error: result.error });
  }
});

// Get only fresh/unattended tickets
app.get('/api/tickets/fresh', async (req, res) => {
  const minutes = parseInt(req.query.minutes) || CONFIG.createdWithinMinutes;
  
  const result = await getTicketAnalysis({ minutes });
  
  if (result.success) {
    const freshTickets = result.data.tickets.filter(t => t.attendance_status === 'FRESH');
    res.json({
      analysis_timestamp: result.data.analysis_timestamp,
      total_fresh: freshTickets.length,
      tickets: freshTickets
    });
  } else {
    res.status(500).json({ error: result.error });
  }
});

// Get summary only
app.get('/api/tickets/summary', async (req, res) => {
  const minutes = parseInt(req.query.minutes) || CONFIG.createdWithinMinutes;
  
  const result = await getTicketAnalysis({ minutes });
  
  if (result.success) {
    res.json({
      analysis_timestamp: result.data.analysis_timestamp,
      total_tickets: result.data.total_tickets,
      summary: result.data.summary
    });
  } else {
    res.status(500).json({ error: result.error });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Freshservice API running on port ${PORT}`);
  console.log(`   GET /api/tickets - Full analysis`);
  console.log(`   GET /api/tickets/fresh - Fresh tickets only`);
  console.log(`   GET /api/tickets/summary - Summary only`);
});