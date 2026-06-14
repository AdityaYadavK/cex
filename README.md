# Central Exchange (CEX) - Production Ready Trading Platform

A high-performance, production-ready central exchange trading platform built with TypeScript, Express, PostgreSQL, and Prisma. Features real-time trading via WebSocket, order matching engine, user authentication, and comprehensive wallet management.

## Features

- **User Authentication**: Secure JWT-based authentication with bcrypt password hashing
- **Order Management**: Place, list, and cancel limit and market orders
- **Matching Engine**: In-memory order book with price-time priority matching
- **Real-time Updates**: WebSocket support for live orderbook and trade updates
- **Wallet System**: Deposit, withdraw, and balance tracking with ledger events
- **Market Data**: Multiple trading pairs with configurable tick sizes and fees
- **Trade History**: Comprehensive trade history and ledger event tracking
- **Security**: Helmet security headers, CORS, rate limiting, and secure cookies
- **Production Ready**: Health checks, graceful shutdown, proper logging, and error handling

## Technology Stack

- **Runtime**: Bun
- **Framework**: Express.js
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: JWT with bcrypt
- **Real-time**: WebSocket (ws)
- **Validation**: Zod
- **Security**: Helmet, CORS
- **Rate Limiting**: @joint-ops/hitlimit

## Prerequisites

- Node.js 18+ or Bun 1.0+
- PostgreSQL 14+
- npm or bun

## Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd cex
```

2. **Install dependencies**
```bash
bun install
```

3. **Configure environment variables**
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
```env
PORT=3000
NODE_ENV=production
DATABASE_URL=postgresql://username:password@localhost:5432/cex_db?schema=public
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=30d
COOKIE_SECURE=true
COOKIE_HTTP_ONLY=true
COOKIE_SAME_SITE=lax
RATE_LIMIT_WINDOW=1m
RATE_LIMIT_MAX_REQUESTS=10
CORS_ORIGIN=https://yourdomain.com
CORS_CREDENTIALS=true
WS_PATH=/ws
LOG_LEVEL=info
```

4. **Setup database**
```bash
# Generate Prisma client
bunx prisma generate

# Run migrations
bunx prisma migrate deploy

# (Optional) Seed database with test data
bun run seed
```

5. **Start the server**
```bash
# Development mode with hot reload
bun run dev

# Production mode
bun run start
```

## API Documentation

### Health Check
```http
GET /health
```

Returns server health status and database connectivity.

### Authentication

#### Signup
```http
POST /signup
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword"
}
```

#### Login
```http
POST /login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword"
}
```

#### Logout
```http
POST /logout
Cookie: token=<jwt_token>
```

### Wallet Operations

#### Get Balance
```http
GET /wallet/balance
Cookie: token=<jwt_token>
```

#### Deposit
```http
POST /wallet/deposit
Content-Type: application/json
Cookie: token=<jwt_token>

{
  "asset": "USDT",
  "amount": 1000
}
```

#### Withdraw
```http
POST /wallet/withdraw
Content-Type: application/json
Cookie: token=<jwt_token>

{
  "asset": "USDT",
  "amount": 500,
  "address": "0x..."
}
```

### Market Operations

#### Get Markets
```http
GET /market
Cookie: token=<jwt_token>
```

#### Get Orderbook
```http
GET /market/:pair
Cookie: token=<jwt_token>
```

Example: `GET /market/BTC-USDT`

### Order Operations

#### Place Order
```http
POST /order/place
Content-Type: application/json
Cookie: token=<jwt_token>

{
  "pair": "BTC/USDT",
  "side": "buy",
  "type": "limit",
  "price": 50000,
  "quantity": 0.1
}
```

#### List Orders
```http
GET /order/list?pair=BTC/USDT&status=OPEN
Cookie: token=<jwt_token>
```

#### Cancel Order
```http
DELETE /order/cancel/:id
Cookie: token=<jwt_token>
```

### Trade Operations

#### Get Trades
```http
GET /trade/list?pair=BTC/USDT&page=1&limit=20
Cookie: token=<jwt_token>
```

## WebSocket Connection

Connect to WebSocket for real-time updates:

```javascript
const ws = new WebSocket('ws://localhost:3000/ws/orderbook/BTC-USDT?token=<jwt_token>');
```

Available channels:
- `/ws/orderbook/:pair` - Orderbook updates
- `/ws/trade/:pair` - Trade executions

## Database Schema

The application uses the following main models:
- **User**: User accounts with email and password
- **Balance**: User balances for different assets (available/reserved)
- **Market**: Trading pairs with configuration
- **Order**: Buy/sell orders with status tracking
- **Trade**: Executed trades with price and quantity
- **Transaction**: Deposit/withdrawal transactions
- **LedgerEvent**: Complete audit trail of balance changes

## Security Considerations

- **JWT Secret**: Always use a strong, random JWT secret in production
- **HTTPS**: Use HTTPS in production with `COOKIE_SECURE=true`
- **Database**: Use strong database passwords and restrict access
- **Rate Limiting**: Configure appropriate rate limits for your use case
- **CORS**: Restrict CORS origins to your frontend domain
- **Input Validation**: All inputs are validated using Zod schemas
- **SQL Injection**: Prisma ORM prevents SQL injection
- **XSS Protection**: Helmet headers provide XSS protection

## Deployment

### Docker Deployment

Build and run with Docker:
```bash
docker build -t cex .
docker run -p 3000:3000 --env-file .env cex
```

### Environment Variables

Ensure all environment variables are properly configured for production:
- Set `NODE_ENV=production`
- Use strong `JWT_SECRET`
- Enable `COOKIE_SECURE=true`
- Restrict `CORS_ORIGIN`
- Configure appropriate `RATE_LIMIT_*` settings

### Database Backup

Regular database backups are recommended:
```bash
pg_dump cex_db > backup.sql
```

## Monitoring

- **Health Check**: Monitor `/health` endpoint
- **Logs**: Check application logs for errors and warnings
- **Database**: Monitor database connection pool and performance
- **WebSocket**: Monitor WebSocket connection counts

## Performance Optimization

- **Order Book**: In-memory order book for fast matching
- **Database Indexes**: Properly indexed for common queries
- **Connection Pooling**: Configure Prisma connection pool
- **Caching**: Consider Redis for session caching
- **Load Balancing**: Can be deployed behind a load balancer

## Troubleshooting

### Database Connection Issues
- Verify `DATABASE_URL` is correct
- Check PostgreSQL is running
- Ensure database migrations are applied

### Authentication Issues
- Verify JWT secret matches between services
- Check token expiration time
- Ensure cookies are being sent correctly

### WebSocket Connection Issues
- Verify token is valid and not expired
- Check WebSocket path is correct
- Ensure CORS allows WebSocket connections

## Development

### Running Tests
```bash
bun test
```

### Code Style
- Use TypeScript strict mode
- Follow existing code patterns
- Add logging for important operations
- Handle errors appropriately

### Adding New Features
1. Update database schema if needed
2. Create migration
3. Implement API endpoints
4. Add input validation
5. Update documentation
6. Add tests

## License

Proprietary - All rights reserved

## Support

For support and questions, please contact the development team.