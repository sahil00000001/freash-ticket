// Freshservice Automation with Puppeteer Stealth + Puter.js AI
// Install: npm install puppeteer-extra puppeteer-extra-plugin-stealth dotenv
// Run: node freshservice-automation.js

require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

// Add stealth plugin to avoid bot detection
puppeteer.use(StealthPlugin());

const CONFIG = {
  domain: 'yondrgroup.freshservice.com',
  email: process.env.FRESHSERVICE_EMAIL,
  password: process.env.FRESHSERVICE_PASSWORD,
  cookiesPath: './freshservice-cookies.json',
  puterCookiesPath: './puter-cookies.json',
  outputPath: './tickets.json',
  analysisPath: './tickets-analysis.json',
  // Query params
  filterId: '27000160172',
  groupId: '27000189625',
  workspaceId: 2,
  createdWithinMinutes: 1440
};

if (!CONFIG.email || !CONFIG.password) {
  console.error('❌ Missing credentials! Create a .env file with:');
  console.error('   FRESHSERVICE_EMAIL=your_email');
  console.error('   FRESHSERVICE_PASSWORD=your_password');
  process.exit(1);
}

// ============ LOCAL FALLBACK ANALYSIS ============
function analyzeTicketsLocally(tickets) {
  console.log('\n📊 Running local analysis...');
  
  const priorityMap = { 1: 'P4', 2: 'P3', 3: 'P2', 4: 'P1' };
  
  const analyzedTickets = tickets.map(t => {
    const isFresh = !t.stats?.agent_responded_at && (t.stats?.outbound_count || 0) <= 1;
    const respTime = t.stats?.first_resp_time_in_secs 
      ? Math.round(t.stats.first_resp_time_in_secs / 60) 
      : null;
    
    return {
      ticket_id: t.human_display_id || `#${t.id}`,
      subject: t.subject?.substring(0, 80) || 'No subject',
      priority: priorityMap[t.priority] || 'P4',
      requester_name: t.requester?.name || 'Unknown',
      requester_location: t.requester?.location_name || 'Unknown',
      status: t.ticket_status?.name || 'Unknown',
      attendance_status: isFresh ? 'FRESH' : 'REPLIED',
      first_response_at: t.stats?.first_responded_at || null,
      response_time_minutes: respTime,
      urgency_assessment: isFresh ? 'Needs immediate attention' : 'Being handled',
      recommendation: isFresh ? 'Assign and respond ASAP' : 'Monitor progress'
    };
  });

  const summary = {
    fresh_tickets: analyzedTickets.filter(t => t.attendance_status === 'FRESH').length,
    replied_tickets: analyzedTickets.filter(t => t.attendance_status === 'REPLIED').length,
    p1_count: analyzedTickets.filter(t => t.priority === 'P1').length,
    p2_count: analyzedTickets.filter(t => t.priority === 'P2').length,
    p3_count: analyzedTickets.filter(t => t.priority === 'P3').length,
    p4_count: analyzedTickets.filter(t => t.priority === 'P4').length
  };

  return {
    analysis_timestamp: new Date().toISOString(),
    total_tickets: tickets.length,
    summary,
    tickets: analyzedTickets
  };
}

// ============ PUTER.JS AI ANALYSIS ============
async function analyzeTicketsWithPuter(browser, tickets) {
  console.log('\n🤖 Analyzing tickets with Puter.js AI...');

  const aiPage = await browser.newPage();
  
  // Set realistic viewport and user agent
  await aiPage.setViewport({ width: 1920, height: 1080 });
  await aiPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  try {
    // Load Puter cookies if they exist
    if (fs.existsSync(CONFIG.puterCookiesPath)) {
      const cookies = JSON.parse(fs.readFileSync(CONFIG.puterCookiesPath));
      await aiPage.setCookie(...cookies);
      console.log('✓ Puter cookies loaded');
    }

    // Navigate to puter.com first to establish session
    await aiPage.goto('https://puter.com', { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Wait a bit to seem human
    await new Promise(r => setTimeout(r, 2000));

    // Check if there's a captcha - if so, wait for manual solve
    const hasCaptcha = await aiPage.evaluate(() => {
      return document.body.innerText.includes('Verify you are human') || 
             document.querySelector('iframe[src*="challenges.cloudflare.com"]') !== null;
    });

    if (hasCaptcha) {
      console.log('⚠️  Captcha detected! Please solve it manually in the browser...');
      console.log('   Waiting up to 60 seconds...');
      
      // Wait for captcha to be solved (page will navigate or captcha disappears)
      await aiPage.waitForFunction(() => {
        return !document.body.innerText.includes('Verify you are human') &&
               !document.querySelector('iframe[src*="challenges.cloudflare.com"]');
      }, { timeout: 60000 });
      
      console.log('✓ Captcha solved!');
      
      // Save cookies for next time
      const cookies = await aiPage.cookies();
      fs.writeFileSync(CONFIG.puterCookiesPath, JSON.stringify(cookies, null, 2));
      console.log('✓ Puter cookies saved for future use');
    }

    // Now inject Puter.js and run analysis
    await aiPage.setContent(`
      <!DOCTYPE html>
      <html>
        <head>
          <script src="https://js.puter.com/v2/"></script>
        </head>
        <body>
          <div id="status">Loading Puter.js...</div>
        </body>
      </html>
    `);

    // Wait for Puter.js to load
    await aiPage.waitForFunction(() => typeof puter !== 'undefined', { timeout: 30000 });
    console.log('✓ Puter.js loaded');

    const prompt = `You are an IT Service Desk analyst. Analyze these Freshservice tickets and return ONLY valid JSON.

For each ticket:
- ticket_id: human_display_id
- subject: brief subject  
- priority: P1/P2/P3/P4 (map: 1=P4, 2=P3, 3=P2, 4=P1)
- requester_name: from requester.name
- requester_location: from requester.location_name
- status: from ticket_status.name
- attendance_status: "FRESH" if stats.agent_responded_at is null, else "REPLIED"
- response_time_minutes: stats.first_resp_time_in_secs / 60
- urgency_assessment: brief assessment
- recommendation: action item

JSON format:
{
  "analysis_timestamp": "ISO date",
  "total_tickets": number,
  "summary": {"fresh_tickets":0,"replied_tickets":0,"p1_count":0,"p2_count":0,"p3_count":0,"p4_count":0},
  "tickets": [...]
}

Tickets: ${JSON.stringify(tickets)}`;

    const result = await aiPage.evaluate(async (promptText) => {
      try {
        const response = await puter.ai.chat(promptText);
        // Return raw response for debugging
        return { raw: response, type: typeof response };
      } catch (err) {
        return { error: err.message };
      }
    }, prompt);

    if (result.error) throw new Error(result.error);

    // Log raw response for debugging
    console.log('📝 Raw Puter response type:', result.type);
    
    // Parse the response
    let analysis;
    try {
      let text = result.raw;
      
      // Handle different response formats
      if (typeof text === 'object') {
        text = text?.message?.content || text?.text || text?.response || JSON.stringify(text);
      }
      
      console.log('📝 Response preview:', String(text).substring(0, 200) + '...');
      
      // Clean markdown
      text = String(text).replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      
      analysis = JSON.parse(text);
    } catch (parseErr) {
      console.log('⚠️  Could not parse AI response, using local analysis');
      return null; // Will trigger fallback
    }

    console.log('✓ Puter.js analysis complete');
    return analysis;

  } catch (error) {
    console.error('❌ Puter.js analysis failed:', error.message);
    await aiPage.screenshot({ path: 'puter-error.png' });
    return null;
  } finally {
    await aiPage.close();
  }
}

function printAnalysisSummary(analysis) {
  if (!analysis) return;

  console.log('\n' + '='.repeat(60));
  console.log('📊 TICKET ANALYSIS SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Tickets: ${analysis.total_tickets}`);
  console.log(`🔴 Fresh (Unattended): ${analysis.summary?.fresh_tickets || 0}`);
  console.log(`✅ Replied: ${analysis.summary?.replied_tickets || 0}`);
  
  const s = analysis.summary || {};
  console.log(`\nBy Priority: P1:${s.p1_count || 0} | P2:${s.p2_count || 0} | P3:${s.p3_count || 0} | P4:${s.p4_count || 0}`);
  
  console.log('\n' + '-'.repeat(60));
  console.log('TICKET DETAILS:');
  console.log('-'.repeat(60));

  for (const t of (analysis.tickets || [])) {
    const icon = t.attendance_status === 'FRESH' ? '🔴 FRESH' : '✅ REPLIED';
    console.log(`\n[${t.ticket_id}] ${t.priority} - ${icon}`);
    console.log(`  Subject: ${t.subject}`);
    console.log(`  Requester: ${t.requester_name} (${t.requester_location})`);
    console.log(`  Status: ${t.status}`);
    if (t.response_time_minutes) console.log(`  Response Time: ${t.response_time_minutes} mins`);
    if (t.urgency_assessment) console.log(`  Assessment: ${t.urgency_assessment}`);
    if (t.recommendation) console.log(`  Recommendation: ${t.recommendation}`);
  }
  console.log('\n' + '='.repeat(60));
}

// ============ FRESHSERVICE FUNCTIONS ============
async function saveCookies(page) {
  const cookies = await page.cookies();
  fs.writeFileSync(CONFIG.cookiesPath, JSON.stringify(cookies, null, 2));
  console.log('✓ Cookies saved');
}

async function loadCookies(page) {
  if (fs.existsSync(CONFIG.cookiesPath)) {
    const cookies = JSON.parse(fs.readFileSync(CONFIG.cookiesPath));
    await page.setCookie(...cookies);
    console.log('✓ Cookies loaded');
    return true;
  }
  return false;
}

async function login(page) {
  console.log('Logging in to Freshservice...');
  await page.goto(`https://${CONFIG.domain}/login`, { waitUntil: 'networkidle2' });
  
  await page.waitForSelector('input[type="email"], input[name="email"], #user_email');
  await page.type('input[type="email"], input[name="email"], #user_email', CONFIG.email);
  await page.type('input[type="password"], input[name="password"], #user_password', CONFIG.password);
  await page.click('button[type="submit"], input[type="submit"], .login-btn');
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
  
  if (page.url().includes('/login')) throw new Error('Login failed! Check credentials.');
  
  console.log('✓ Login successful');
  await saveCookies(page);
}

async function isSessionValid(page) {
  try {
    await page.goto(`https://${CONFIG.domain}/a/tickets`, { waitUntil: 'networkidle2', timeout: 15000 });
    return !page.url().includes('/login');
  } catch { return false; }
}

async function fetchTickets(page) {
  const queryHash = JSON.stringify([
    { value: [{ id: CONFIG.workspaceId }], condition: 'workspace_id', operator: 'is_in', type: 'default' },
    { value: [CONFIG.groupId], condition: 'group_id', operator: 'is_in', type: 'default' },
    { value: String(CONFIG.createdWithinMinutes), condition: 'created_at', operator: 'is_greater_than', type: 'default' }
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
    console.log(`Fetching page ${currentPage}...`);

    const response = await page.evaluate(async (apiUrl) => {
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }, url);

    const tickets = response.tickets || [];
    allTickets.push(...tickets);
    console.log(`  ✓ Found ${tickets.length} tickets`);

    hasMore = tickets.length === 100;
    currentPage++;
  }

  return allTickets;
}

// ============ MAIN ============
async function main() {
  console.log('🚀 Starting Freshservice Ticket Analyzer (Stealth Mode)\n');

  const browser = await puppeteer.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--start-maximized'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  try {
    const hasCookies = await loadCookies(page);
    
    if (hasCookies && await isSessionValid(page)) {
      console.log('✓ Existing session valid');
    } else {
      await login(page);
    }

    console.log('\nFetching tickets...');
    const tickets = await fetchTickets(page);
    
    fs.writeFileSync(CONFIG.outputPath, JSON.stringify(tickets, null, 2));
    console.log(`✓ Saved ${tickets.length} tickets to ${CONFIG.outputPath}`);

    if (tickets.length > 0) {
      let analysis = await analyzeTicketsWithPuter(browser, tickets);
      
      // Fallback to local analysis if Puter fails
      if (!analysis || !analysis.total_tickets) {
        console.log('⚠️  Using local analysis fallback');
        analysis = analyzeTicketsLocally(tickets);
      }
      
      fs.writeFileSync(CONFIG.analysisPath, JSON.stringify(analysis, null, 2));
      console.log(`✓ Analysis saved to ${CONFIG.analysisPath}`);
      printAnalysisSummary(analysis);
    } else {
      console.log('No tickets to analyze');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    await page.screenshot({ path: 'error-screenshot.png' });
  } finally {
    await browser.close();
  }
}

main();