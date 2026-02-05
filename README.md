<div align="center">

# 🔐 Auth API

<img src="https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI"/>
<img src="https://img.shields.io/badge/Python-3.11+-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python"/>
<img src="https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white" alt="SQLite"/>
<img src="https://img.shields.io/badge/JWT-000000?style=for-the-badge&logo=jsonwebtokens&logoColor=white" alt="JWT"/>
<img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker"/>

**Production-ready authentication API with JWT tokens, refresh flow, and password reset**

[Features](#-features) • [Quick Start](#-quick-start) • [API](#-api-reference) • [Architecture](#-architecture) • [Deploy](#-deployment)

---

</div>

## ✨ Features

<table>
<tr>
<td width="50%">

### 🔑 Authentication
- ✅ Email/Password registration
- ✅ JWT Access tokens (15 min)
- ✅ JWT Refresh tokens (7 days)
- ✅ Secure password hashing (bcrypt)

</td>
<td width="50%">

### 🛡️ Security
- ✅ Password reset flow
- ✅ Token expiration
- ✅ Protected endpoints
- ✅ SQL injection protection

</td>
</tr>
<tr>
<td width="50%">

### 🚀 Production Ready
- ✅ Docker support
- ✅ GitHub Actions CI/CD
- ✅ Health checks
- ✅ Auto-rollback

</td>
<td width="50%">

### 🧪 Testing
- ✅ 8 comprehensive tests
- ✅ In-memory test DB
- ✅ 100% endpoint coverage
- ✅ Pytest + TestClient

</td>
</tr>
</table>

---

## 🚀 Quick Start

### Local Development

```bash
# Clone & setup
git clone <your-repo>
cd auth-api

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run server
uvicorn app.main:app --reload
```

### Docker

```bash
# Build & run
docker build -t auth-api .
docker run -p 8000:8000 -e SECRET_KEY=your-secret auth-api
```

### Access API

```
🌐 API:     http://localhost:8000
📚 Docs:    http://localhost:8000/docs
📋 ReDoc:   http://localhost:8000/redoc
❤️ Health:  http://localhost:8000/health
```

---

## 📚 API Reference

### Endpoints Overview

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/auth/register` | Create new user | ❌ |
| `POST` | `/auth/login` | Get tokens | ❌ |
| `POST` | `/auth/refresh` | Refresh tokens | ❌ |
| `GET` | `/auth/me` | Get current user | ✅ |
| `POST` | `/auth/forgot` | Request password reset | ❌ |
| `POST` | `/auth/reset` | Reset password | ❌ |
| `GET` | `/health` | Health check | ❌ |

---

### 📝 Register User

```http
POST /auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

<details>
<summary>📤 Response <code>201 Created</code></summary>

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "created_at": "2024-01-15T10:30:00.000000"
}
```
</details>

---

### 🔓 Login

```http
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

<details>
<summary>📤 Response <code>200 OK</code></summary>

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer"
}
```
</details>

---

### 🔄 Refresh Tokens

```http
POST /auth/refresh
Content-Type: application/json

{
  "refresh_token": "eyJhbGciOiJIUzI1NiIs..."
}
```

<details>
<summary>📤 Response <code>200 OK</code></summary>

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer"
}
```
</details>

---

### 👤 Get Current User

```http
GET /auth/me
Authorization: Bearer <access_token>
```

<details>
<summary>📤 Response <code>200 OK</code></summary>

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "created_at": "2024-01-15T10:30:00.000000"
}
```
</details>

---

### 📧 Forgot Password

```http
POST /auth/forgot
Content-Type: application/json

{
  "email": "user@example.com"
}
```

<details>
<summary>📤 Response <code>200 OK</code></summary>

```json
{
  "message": "If email exists, reset instructions sent"
}
```
</details>

---

### 🔐 Reset Password

```http
POST /auth/reset
Content-Type: application/json

{
  "token": "reset-token-from-email",
  "new_password": "newsecurepassword123"
}
```

<details>
<summary>📤 Response <code>200 OK</code></summary>

```json
{
  "message": "Password reset successful"
}
```
</details>

---

## 🏗️ Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         NGINX (Reverse Proxy)                    │
│                          Port 80/443                             │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      FastAPI Application                         │
│                         Port 8000                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Routes    │──│    Auth     │──│       Models            │  │
│  │  /auth/*    │  │  JWT/Bcrypt │  │  User, Token, etc.      │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│                    ┌─────────────────┐                          │
│                    │    Database     │                          │
│                    │    SQLModel     │                          │
│                    └─────────────────┘                          │
└─────────────────────────────────────────────────────────────────┘
```

### Authentication Flow

```
┌──────────┐                                           ┌──────────┐
│  Client  │                                           │  Server  │
└────┬─────┘                                           └────┬─────┘
     │                                                      │
     │  1. POST /auth/login {email, password}               │
     │─────────────────────────────────────────────────────>│
     │                                                      │
     │                              ┌───────────────────────┤
     │                              │ Verify credentials    │
     │                              │ Generate JWT tokens   │
     │                              └───────────────────────┤
     │                                                      │
     │  2. {access_token, refresh_token}                    │
     │<─────────────────────────────────────────────────────│
     │                                                      │
     │  3. GET /auth/me                                     │
     │     Authorization: Bearer <access_token>             │
     │─────────────────────────────────────────────────────>│
     │                                                      │
     │                              ┌───────────────────────┤
     │                              │ Validate JWT          │
     │                              │ Extract user_id       │
     │                              └───────────────────────┤
     │                                                      │
     │  4. {user data}                                      │
     │<─────────────────────────────────────────────────────│
     │                                                      │
```

### Token Refresh Flow

```
┌──────────┐                                           ┌──────────┐
│  Client  │                                           │  Server  │
└────┬─────┘                                           └────┬─────┘
     │                                                      │
     │  Access token expired (401)                          │
     │<─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│
     │                                                      │
     │  POST /auth/refresh {refresh_token}                  │
     │─────────────────────────────────────────────────────>│
     │                                                      │
     │                              ┌───────────────────────┤
     │                              │ Validate refresh token│
     │                              │ Generate new tokens   │
     │                              └───────────────────────┤
     │                                                      │
     │  {new access_token, new refresh_token}               │
     │<─────────────────────────────────────────────────────│
     │                                                      │
```

### Password Reset Flow

```
┌──────────┐                    ┌──────────┐              ┌──────────┐
│  Client  │                    │  Server  │              │  Email   │
└────┬─────┘                    └────┬─────┘              └────┬─────┘
     │                               │                         │
     │  POST /auth/forgot            │                         │
     │  {email}                      │                         │
     │──────────────────────────────>│                         │
     │                               │                         │
     │                               │  Send reset token       │
     │                               │────────────────────────>│
     │                               │                         │
     │  {message: "If email..."}     │                         │
     │<──────────────────────────────│                         │
     │                               │                         │
     │                               │                         │
     │  User clicks email link       │                         │
     │<─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│
     │                               │                         │
     │  POST /auth/reset             │                         │
     │  {token, new_password}        │                         │
     │──────────────────────────────>│                         │
     │                               │                         │
     │                    ┌──────────┤                         │
     │                    │ Validate │                         │
     │                    │ & Update │                         │
     │                    └──────────┤                         │
     │                               │                         │
     │  {message: "Success"}         │                         │
     │<──────────────────────────────│                         │
     │                               │                         │
```

---

## 🗄️ Database Schema

```
┌─────────────────────────────────────────────────────────┐
│                         USER                             │
├─────────────────────────────────────────────────────────┤
│ id                  │ VARCHAR(36)  │ PK, UUID           │
│ email               │ VARCHAR      │ UNIQUE, INDEX      │
│ hashed_password     │ VARCHAR      │ bcrypt hash        │
│ created_at          │ DATETIME     │ auto               │
│ reset_token         │ VARCHAR      │ nullable           │
│ reset_token_expires │ DATETIME     │ nullable           │
└─────────────────────────────────────────────────────────┘
```

---

## 🚀 Deployment

### CI/CD Pipeline

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   GitHub    │     │   GitHub    │     │   Server    │     │  Production │
│    Push     │────>│   Actions   │────>│    SSH      │────>│   Running   │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  Run Tests  │
                    │  pytest -v  │
                    └──────┬──────┘
                           │
              ┌────────────┴────────────┐
              │                         │
              ▼                         ▼
       ┌─────────────┐          ┌─────────────┐
       │   ✅ Pass   │          │   ❌ Fail   │
       │   Deploy    │          │    Stop     │
       └─────────────┘          └─────────────┘
```

### GitHub Secrets Required

| Secret | Description |
|--------|-------------|
| `SERVER_HOST` | Server IP address |
| `SERVER_USER` | SSH username |
| `SERVER_PASSWORD` | SSH password |

### Server Structure

```
/opt/auth-api/
├── app/
│   ├── __init__.py
│   ├── main.py
│   ├── config.py
│   ├── database.py
│   ├── models.py
│   ├── auth.py
│   └── routes.py
├── venv/
├── requirements.txt
├── app.db
└── rollback.sh
```

### Systemd Service

```ini
# /etc/systemd/system/auth-api.service
[Unit]
Description=Auth API Service
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/auth-api
ExecStart=/opt/auth-api/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```

### Nginx Configuration

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 🧪 Testing

```bash
# Run all tests
pytest -v

# Run with coverage
pytest --cov=app --cov-report=html

# Run specific test
pytest tests/test_auth.py::test_login -v
```

### Test Coverage

| Module | Coverage |
|--------|----------|
| `app/routes.py` | 100% |
| `app/auth.py` | 100% |
| `app/models.py` | 100% |

---

## 📁 Project Structure

```
auth-api/
├── 📂 .github/
│   └── 📂 workflows/
│       └── 📄 deploy.yml        # CI/CD pipeline
├── 📂 app/
│   ├── 📄 __init__.py
│   ├── 📄 main.py               # FastAPI app entry
│   ├── 📄 config.py             # Configuration
│   ├── 📄 database.py           # DB connection
│   ├── 📄 models.py             # SQLModel schemas
│   ├── 📄 auth.py               # JWT & password utils
│   └── 📄 routes.py             # API endpoints
├── 📂 tests/
│   ├── 📄 __init__.py
│   └── 📄 test_auth.py          # Pytest tests
├── 📄 .env.example              # Environment template
├── 📄 Dockerfile                # Docker build
├── 📄 requirements.txt          # Dependencies
└── 📄 README.md                 # This file
```

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SECRET_KEY` | `dev-secret-key...` | JWT signing key |
| `DATABASE_URL` | `sqlite:///./app.db` | Database connection |
| `ACCESS_TOKEN_EXPIRE` | 15 min | Access token lifetime |
| `REFRESH_TOKEN_EXPIRE` | 7 days | Refresh token lifetime |

---

## 🔒 Security Considerations

- ⚠️ Change `SECRET_KEY` in production
- ⚠️ Use HTTPS in production
- ⚠️ Consider rate limiting
- ⚠️ Implement email verification
- ⚠️ Add password strength validation

---

<div align="center">

## 📄 License

MIT License © 2024

---

Made with ❤️ and ☕

**[⬆ Back to Top](#-auth-api)**

</div>
