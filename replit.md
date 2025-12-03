# Freshservice Ticket Analyzer API

## Overview
This is a Node.js backend API service that analyzes Freshservice tickets. The application uses automated browser-based login to authenticate with Freshservice and fetch tickets via the internal API.

**Status**: Backend API (no frontend)
**Language**: Node.js 20.x
**Framework**: Express.js
**Port**: 3000 (binds to 0.0.0.0)

## Project Structure
```
.
├── server.js           # Main Express API server with Puppeteer login
├── package.json        # Node.js dependencies
├── render.yaml         # Render.com deployment config
├── .env                # Environment variables (not committed)
└── replit.md           # Project documentation
```

## Recent Changes
- **2024-12-03**: Implemented serverless-compatible Puppeteer login
  - Uses puppeteer-core with @sparticuz/chromium (lightweight, serverless-optimized)
  - Automatic browser-based login with email/password
  - Session caching to minimize login frequency
  - Auto re-login when session expires

## Configuration

### Required Environment Variables
- `FRESHSERVICE_EMAIL` - Your Freshservice login email
- `FRESHSERVICE_PASSWORD` - Your Freshservice password

### Optional Environment Variables
- `FRESHSERVICE_DOMAIN` - Default: yondrgroup.freshservice.com
- `FRESHSERVICE_FILTER_ID` - Default: 27000160172
- `FRESHSERVICE_GROUP_ID` - Default: 27000189625
- `FRESHSERVICE_WORKSPACE_ID` - Default: 2
- `PORT` - Server port (default: 3000)

## API Endpoints

### Health Check
- `GET /` - Service status and configuration

### Authentication
- `POST /api/login` - Force re-login (usually not needed)

### Ticket Analysis
- `GET /api/tickets` - Full ticket analysis with all details
  - Query param: `?minutes=720` (optional, default: 1440)
- `GET /api/tickets/fresh` - Only unattended/fresh tickets
  - Query param: `?minutes=720` (optional)
- `GET /api/tickets/summary` - Summary statistics only
  - Query param: `?minutes=720` (optional)

## Dependencies
- **express**: Web framework
- **dotenv**: Environment variable management
- **puppeteer-core**: Headless browser (no bundled Chromium)
- **@sparticuz/chromium**: Serverless-optimized Chromium binary

## How It Works
1. On first API request, launches lightweight headless browser
2. Navigates to Freshservice login page
3. Enters credentials and submits form
4. Captures session cookies after successful login
5. Uses cookies for subsequent API calls
6. Re-logs in automatically when session expires (every 30 minutes)

## Deployment on Render
1. Connect your GitHub repository to Render
2. Set environment variables:
   - `FRESHSERVICE_EMAIL` - Your login email
   - `FRESHSERVICE_PASSWORD` - Your password
3. Deploy - the render.yaml configures everything else

## User Preferences
None specified yet.
