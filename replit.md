# Freshservice Ticket Analyzer API

## Overview

This is a lightweight Node.js REST API that integrates with Freshservice to fetch and analyze support tickets. The application provides various endpoints to retrieve ticket data with different filtering options (time-based, status-based) and summary statistics. It's designed for deployment on platforms like Render and uses API key authentication to connect to Freshservice.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Application Framework
- **Technology**: Express.js (Node.js web framework)
- **Rationale**: Express provides a minimal, unopinionated web framework ideal for building REST APIs. It offers excellent middleware support and is well-suited for this lightweight API service.
- **Key Features**: Simple routing, middleware support, minimal overhead

### Authentication & Security
- **Freshservice Authentication**: Basic Authentication using API Key
- **Implementation**: API key is base64-encoded with format `{API_KEY}:X` and sent in Authorization header
- **Environment-based Configuration**: Sensitive credentials stored in environment variables, never in code
- **Rationale**: Freshservice requires API key authentication (mandatory since May 2023), providing secure programmatic access to ticket data

### API Design
- **RESTful Endpoints**: Clean, resource-based URL structure
- **Flexible Filtering**: Query parameter support for time-based filtering (e.g., `?minutes=720`)
- **Multiple Views**: Different endpoints serve different use cases:
  - Full analysis with ticket details
  - Fresh/unattended tickets only
  - Summary statistics
  - Health check endpoint
- **Rationale**: Provides flexibility for different client needs while maintaining simple, predictable URL patterns

### Data Processing
- **In-Memory Processing**: Tickets are fetched from Freshservice API and analyzed on-the-fly
- **No Persistent Storage**: Application is stateless - no database required
- **Rationale**: For a lightweight analyzer that provides real-time data, in-memory processing eliminates infrastructure complexity while maintaining simplicity

### Configuration Management
- **Environment Variables**: All configuration externalized via environment variables
- **Defaults Provided**: Sensible defaults for optional configurations (domain, group ID, port)
- **Dotenv Integration**: Local development support via .env files
- **Rationale**: Follows 12-factor app principles, enabling easy deployment across different environments without code changes

### Ticket Analysis Logic
- **Fresh Ticket Detection**: Identifies unattended tickets based on agent response status and outbound count
- **Priority Mapping**: Converts Freshservice priority numbers to readable labels (P1-P4)
- **Response Time Calculation**: Converts seconds to minutes for human-readable metrics
- **Data Transformation**: Shapes raw Freshservice API responses into clean, consumable formats

## External Dependencies

### Third-Party Services
- **Freshservice API**: Primary data source for ticket information
  - Base URL pattern: `{domain}/api/v2/tickets`
  - Requires API key authentication
  - Provides ticket data including stats, requester info, priority, status
  - Default domain: `yondrgroup.freshservice.com`

### NPM Packages
- **express** (^4.22.1): Web framework for building the REST API
- **dotenv** (^16.6.1): Environment variable management for local development

### Runtime Environment
- **Node.js**: Version 20.x (specified in package.json engines)
- **Deployment Platform**: Designed for Render (or similar PaaS platforms)

### Environment Configuration
Required:
- `FRESHSERVICE_API_KEY`: API key for Freshservice authentication

Optional (with defaults):
- `FRESHSERVICE_DOMAIN`: Freshservice instance domain
- `FRESHSERVICE_GROUP_ID`: Target group ID for filtering
- `FRESHSERVICE_FILTER_ID`: Predefined filter ID
- `FRESHSERVICE_WORKSPACE_ID`: Workspace identifier
- `PORT`: Server port (default: 3000)