// server.js - Freshservice Ticket Analyzer API
// Uses puppeteer-core with @sparticuz/chromium (serverless-optimized)

require('dotenv').config();
const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();
const PORT = process.env.PORT || 3000;

const CONFIG = {
  domain: process.env.FRESHSERVICE_DOMAIN || 'yondrgroup.freshservice.com',
  email: process.env.FRESHSERVICE_EMAIL || '',
  password: process.env.FRESHSERVICE_PASSWORD || '',
  filterId: process.env.FRESHSERVICE_FILTER_ID || '27000160172',
  groupId: process.env.FRESHSERVICE_GROUP_ID || '27000189625',
  workspaceId: parseInt(process.env.FRESHSERVICE_WORKSPACE_ID) || 2,
  createdWithinMinutes: 1440
};

let sessionCookies = null;
let lastLoginTime = 0;
const SESSION_VALIDITY = 30 * 60 * 1000;

function log(message, data = null) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
  if (data) console.log(JSON.stringify(data, null, 2));
}

async function getBrowser() {
  log('Launching browser...');
  
  const isLocal = process.env.NODE_ENV !== 'production' && !process.env.RENDER;
  
  if (isLocal) {
    const puppeteerFull = require('puppeteer');
    return await puppeteerFull.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }
  
  return await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless
  });
}

async function loginAndGetCookies() {
  if (!CONFIG.email || !CONFIG.password) {
    throw new Error('Missing FRESHSERVICE_EMAIL or FRESHSERVICE_PASSWORD environment variables');
  }

  log('Starting browser-based login...');
  let browser;
  
  try {
    browser = await getBrowser();
    const page = await browser.newPage();
    
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    log(`Navigating to login page: https://${CONFIG.domain}/support/login`);
    await page.goto(`https://${CONFIG.domain}/support/login`, { 
      waitUntil: 'networkidle2',
      timeout: 60000 
    });

    await page.waitForSelector('input[type="email"], input[name="email"], #user_email, input[placeholder*="email" i]', { timeout: 30000 });
    log('Login form detected');

    const emailSelector = await page.$('input[type="email"]') || 
                          await page.$('input[name="email"]') || 
                          await page.$('#user_email') ||
                          await page.$('input[placeholder*="email" i]');
    
    if (emailSelector) {
      await emailSelector.type(CONFIG.email, { delay: 50 });
    }

    const passwordSelector = await page.$('input[type="password"]') || 
                             await page.$('input[name="password"]') || 
                             await page.$('#user_password');
    
    if (passwordSelector) {
      await passwordSelector.type(CONFIG.password, { delay: 50 });
    }

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
      page.click('button[type="submit"], input[type="submit"], .login-btn, button:has-text("Log in"), button:has-text("Sign in")')
    ]);

    await new Promise(r => setTimeout(r, 3000));

    const currentUrl = page.url();
    log(`Current URL after login: ${currentUrl}`);

    if (currentUrl.includes('/login')) {
      const errorText = await page.evaluate(() => {
        const errorEl = document.querySelector('.error, .alert-danger, [class*="error"]');
        return errorEl ? errorEl.textContent : null;
      });
      throw new Error(`Login failed: ${errorText || 'Invalid credentials'}`);
    }

    const cookies = await page.cookies();
    log(`Login successful! Got ${cookies.length} cookies`);

    sessionCookies = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    lastLoginTime = Date.now();

    return sessionCookies;

  } catch (error) {
    log(`Login error: ${error.message}`);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
      log('Browser closed');
    }
  }
}

async function ensureValidSession() {
  const now = Date.now();
  const sessionExpired = !sessionCookies || (now - lastLoginTime > SESSION_VALIDITY);
  
  if (sessionExpired) {
    log('Session expired or missing, logging in...');
    await loginAndGetCookies();
  }
}

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

async function fetchTicketsFromAPI(options = {}, retryOnAuth = true) {
  const { minutes = CONFIG.createdWithinMinutes } = options;
  
  log(`Starting ticket fetch (last ${minutes} minutes)`);

  if (!sessionCookies) {
    throw new Error('No session. Login required.');
  }

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
    log(`Fetching page ${currentPage}...`);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'Cookie': sessionCookies,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'X-Requested-With': 'XMLHttpRequest'
        }
      });

      if (response.status === 401 || response.status === 403) {
        if (retryOnAuth) {
          log('Session expired, re-logging in...');
          sessionCookies = null;
          await loginAndGetCookies();
          return fetchTicketsFromAPI(options, false);
        }
        throw new Error('Session expired and re-login failed');
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const tickets = data.tickets || [];
      log(`Page ${currentPage}: Found ${tickets.length} tickets`);
      
      allTickets.push(...tickets);
      hasMore = tickets.length === 100;
      currentPage++;

    } catch (error) {
      log(`ERROR on page ${currentPage}: ${error.message}`);
      throw error;
    }
  }

  log(`Total tickets fetched: ${allTickets.length}`);
  return allTickets;
}

app.use(express.json());

app.get('/', (req, res) => {
  log('Health check called');
  const credentialsSet = !!(CONFIG.email && CONFIG.password);
  
  res.json({ 
    status: 'ok', 
    service: 'Freshservice Ticket Analyzer',
    authentication: {
      method: 'Browser-based login (automatic)',
      credentials_configured: credentialsSet,
      session_active: !!sessionCookies,
      session_age_minutes: sessionCookies ? Math.round((Date.now() - lastLoginTime) / 60000) : null
    },
    config: {
      domain: CONFIG.domain,
      workspace_id: CONFIG.workspaceId,
      group_id: CONFIG.groupId,
      filter_id: CONFIG.filterId
    },
    endpoints: {
      'GET /': 'Health check',
      'POST /api/login': 'Force re-login',
      'GET /api/tickets': 'Full ticket analysis',
      'GET /api/tickets?minutes=720': 'Tickets from last 12 hours',
      'GET /api/tickets/fresh': 'Only unattended tickets',
      'GET /api/tickets/summary': 'Summary counts only'
    },
    setup: !credentialsSet ? {
      required_env_vars: [
        'FRESHSERVICE_EMAIL - Your Freshservice login email',
        'FRESHSERVICE_PASSWORD - Your Freshservice password'
      ],
      optional_env_vars: [
        'FRESHSERVICE_DOMAIN - Default: yondrgroup.freshservice.com',
        'FRESHSERVICE_FILTER_ID - Default: 27000160172',
        'FRESHSERVICE_GROUP_ID - Default: 27000189625',
        'FRESHSERVICE_WORKSPACE_ID - Default: 2'
      ]
    } : null
  });
});

app.post('/api/login', async (req, res) => {
  log('Manual login requested');
  
  try {
    await loginAndGetCookies();
    res.json({ 
      success: true, 
      message: 'Login successful',
      session_active: !!sessionCookies
    });
  } catch (error) {
    log(`Login error: ${error.message}`);
    res.status(401).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.get('/api/tickets', async (req, res) => {
  const minutes = parseInt(req.query.minutes) || CONFIG.createdWithinMinutes;
  log(`=== GET /api/tickets called (minutes: ${minutes}) ===`);
  
  try {
    await ensureValidSession();
    
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
      hint: error.message.includes('credentials') ? 
        'Set FRESHSERVICE_EMAIL and FRESHSERVICE_PASSWORD environment variables' : null
    });
  }
});

app.get('/api/tickets/fresh', async (req, res) => {
  const minutes = parseInt(req.query.minutes) || CONFIG.createdWithinMinutes;
  log(`=== GET /api/tickets/fresh called (minutes: ${minutes}) ===`);
  
  try {
    await ensureValidSession();
    
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
    await ensureValidSession();
    
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
  
  if (CONFIG.email && CONFIG.password) {
    log('Credentials configured. Login will occur on first API request.');
  } else {
    log('WARNING: No credentials configured.');
    log('Set FRESHSERVICE_EMAIL and FRESHSERVICE_PASSWORD environment variables.');
  }
});
