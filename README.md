# Freshservice Ticket Analyzer API

A lightweight Node.js API that fetches and analyzes tickets from Freshservice.

## Quick Start

### 1. Get Your API Key
1. Log in to Freshservice
2. Click your profile picture (top right)
3. Select "Profile Settings"
4. Copy your API key

### 2. Deploy to Render
1. Fork/clone this repository
2. Connect to Render
3. Add environment variable: `FRESHSERVICE_API_KEY` = your API key
4. Deploy

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Health check with connection test |
| `GET /api/tickets` | Full ticket analysis (last 24 hours) |
| `GET /api/tickets?minutes=720` | Tickets from last 12 hours |
| `GET /api/tickets/fresh` | Only unattended tickets |
| `GET /api/tickets/summary` | Summary statistics only |

## Environment Variables

| Variable | Required | Default |
|----------|----------|---------|
| `FRESHSERVICE_API_KEY` | Yes | - |
| `FRESHSERVICE_DOMAIN` | No | yondrgroup.freshservice.com |
| `FRESHSERVICE_GROUP_ID` | No | 27000189625 |
| `PORT` | No | 3000 |

## Example Response

```json
{
  "analysis_timestamp": "2025-12-03T18:17:38Z",
  "total_tickets": 4,
  "summary": {
    "fresh_tickets": 4,
    "replied_tickets": 0,
    "p1_count": 0,
    "p2_count": 0,
    "p3_count": 3,
    "p4_count": 1
  },
  "tickets": [...]
}
```

## License

MIT
