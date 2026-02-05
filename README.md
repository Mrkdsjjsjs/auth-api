<div align="center">

# Messenger API

<img src="https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI"/>
<img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL"/>
<img src="https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white" alt="Redis"/>
<img src="https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React"/>
<img src="https://img.shields.io/badge/WebSocket-010101?style=for-the-badge&logo=socketdotio&logoColor=white" alt="WebSocket"/>
<img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker"/>

**Real-time messenger with WebSocket, direct & group chats, file sharing**

[Features](#features) | [Quick Start](#quick-start) | [API](#api-reference) | [WebSocket](#websocket-events) | [Deploy](#deployment)

---

**Live Demo:** https://gayauth228gay.duckdns.org

</div>

## Features

### Messaging
- Real-time messaging via WebSocket
- Direct messages (1-on-1)
- Group chats with admin roles
- Message editing & deletion
- Reply to messages
- Typing indicators
- Read receipts
- File attachments (images, documents, voice)

### Authentication
- JWT access/refresh tokens
- Secure password hashing (bcrypt)
- Password reset flow
- User profiles with avatars

### Infrastructure
- PostgreSQL database
- Redis for caching & pub/sub
- Message queue for WebSocket scaling
- Rate limiting (slowapi)
- Docker Compose deployment
- GitHub Actions CI/CD
- HTTPS with Let's Encrypt

---

## Quick Start

### Docker (Recommended)

```bash
# Clone
git clone https://github.com/Mrkdsjjsjs/auth-api.git
cd auth-api

# Configure
cp deploy/.env.example deploy/.env
# Edit deploy/.env with your passwords

# Run
cd deploy
docker compose -f docker-compose.prod.yml up -d
```

### Local Development

```bash
# Backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Start PostgreSQL & Redis (via Docker)
docker compose up postgres redis -d

# Run backend
uvicorn app.main:app --reload

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

### Access

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| Swagger Docs | http://localhost:8000/docs |
| Health Check | http://localhost:8000/health |

---

## API Reference

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Create account |
| POST | `/auth/login` | Get tokens |
| POST | `/auth/refresh` | Refresh tokens |
| GET | `/auth/me` | Current user |
| POST | `/auth/forgot` | Request reset |
| POST | `/auth/reset` | Reset password |

### Users

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users/search` | Search users |
| GET | `/api/users/{id}` | Get user |
| PUT | `/api/users/me` | Update profile |
| PUT | `/api/users/me/avatar` | Update avatar |

### Chats

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/chats` | List chats |
| POST | `/api/chats` | Create chat |
| GET | `/api/chats/{id}` | Get chat |
| PUT | `/api/chats/{id}` | Update chat |
| DELETE | `/api/chats/{id}` | Delete chat |
| GET | `/api/chats/{id}/members` | List members |
| POST | `/api/chats/{id}/members` | Add member |
| DELETE | `/api/chats/{id}/members/{user_id}` | Remove member |

### Messages

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/chats/{id}/messages` | List messages (cursor pagination) |
| POST | `/api/chats/{id}/messages` | Send message |
| PUT | `/api/messages/{id}` | Edit message |
| DELETE | `/api/messages/{id}` | Delete message |
| POST | `/api/messages/{id}/read` | Mark as read |
| GET | `/api/messages/search` | Search messages |

### Files

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/upload` | Upload file |
| GET | `/api/files/{id}` | Get file info |

---

## WebSocket Events

Connect: `wss://your-domain/ws/{access_token}`

### Client -> Server

```json
// Send message
{"type": "send_message", "chat_id": "uuid", "content": "Hello!", "message_type": "text"}

// Typing indicator
{"type": "typing_start", "chat_id": "uuid"}
{"type": "typing_stop", "chat_id": "uuid"}

// Read receipt
{"type": "read_receipt", "chat_id": "uuid", "message_id": "uuid"}
```

### Server -> Client

```json
// New message
{"type": "new_message", "message": {...}}

// Typing indicators
{"type": "typing_start", "chat_id": "uuid", "user_id": "uuid", "username": "john"}
{"type": "typing_stop", "chat_id": "uuid", "user_id": "uuid"}

// Presence
{"type": "user_online", "user_id": "uuid"}
{"type": "user_offline", "user_id": "uuid"}

// Read receipt
{"type": "read_receipt", "chat_id": "uuid", "user_id": "uuid", "message_id": "uuid"}
```

---

## Architecture

```
                    +------------------+
                    |     NGINX        |
                    |   (SSL/Proxy)    |
                    +--------+---------+
                             |
              +--------------+--------------+
              |                             |
     +--------v--------+         +----------v---------+
     |    Frontend     |         |      Backend       |
     |   React + Vite  |         |      FastAPI       |
     |   Port 3000     |         |     Port 8000      |
     +-----------------+         +----+----------+----+
                                      |          |
                         +------------+          +------------+
                         |                                    |
                +--------v--------+                  +--------v--------+
                |   PostgreSQL    |                  |      Redis      |
                |   (Database)    |                  | (Cache/PubSub)  |
                +-----------------+                  +-----------------+
```

### Message Queue Flow

```
User A (Instance 1)                    User B (Instance 2)
      |                                      ^
      v                                      |
  [WebSocket]                            [WebSocket]
      |                                      |
      v                                      |
  [Backend 1] ---> [Redis Pub/Sub] ---> [Backend 2]
                   (message_queue)
```

---

## Deployment

### Docker Compose (Production)

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD}

  backend:
    build: ..
    environment:
      DATABASE_URL: postgresql://messenger:${POSTGRES_PASSWORD}@postgres:5432/messenger
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379/0
      SECRET_KEY: ${SECRET_KEY}

  frontend:
    build: ../frontend
    ports:
      - "3000:80"
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `SECRET_KEY` | JWT signing key (generate: `openssl rand -hex 32`) |
| `CORS_ORIGINS` | Allowed origins (comma-separated) |

### CI/CD

GitHub Actions automatically:
1. Runs tests with PostgreSQL & Redis
2. Deploys to server on push to main/claude-scaffold
3. Builds Docker images
4. Health check verification

---

## Project Structure

```
messenger/
+-- app/
|   +-- models/          # SQLModel models
|   +-- schemas/         # Pydantic schemas
|   +-- routes/          # API endpoints
|   +-- services/        # Business logic
|   +-- middleware/      # Rate limiting, security
|   +-- main.py          # FastAPI app
|   +-- config.py        # Configuration
|   +-- database.py      # DB connection
+-- frontend/
|   +-- src/
|       +-- pages/       # React pages
|       +-- components/  # UI components
|       +-- store/       # Zustand state
|       +-- services/    # API & WebSocket
+-- deploy/
|   +-- docker-compose.prod.yml
|   +-- nginx.conf
|   +-- .env.example
+-- tests/
    +-- test_auth.py
    +-- test_chats.py
    +-- test_messages.py
```

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| Login | 5/minute |
| Register | 3/minute |
| Messages | 60/minute |
| Upload | 10/minute |

---

## File Limits

| Type | Max Size | Extensions |
|------|----------|------------|
| Image | 10 MB | jpg, png, gif, webp |
| Document | 50 MB | pdf, doc, docx, zip |
| Voice | 5 MB | ogg, mp3, webm |

---

<div align="center">

MIT License

</div>
