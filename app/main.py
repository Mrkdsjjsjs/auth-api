from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_html, get_redoc_html
from pathlib import Path
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.database import init_db
from app.routes import api_router
from app.middleware.rate_limit import limiter
from app.config import CORS_ORIGINS

STATIC_DIR = Path(__file__).parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events"""
    # Startup
    init_db()

    # Connect Redis
    from app.services.redis_service import redis_service
    from app.services.message_queue import message_queue, setup_queue_handlers
    try:
        await redis_service.connect()
        print("✅ Redis connected")

        # Start message queue
        await setup_queue_handlers()
        await message_queue.start()
        print("✅ Message queue started")
    except Exception as e:
        print(f"⚠️ Redis connection failed: {e}")

    yield

    # Stop message queue
    try:
        await message_queue.stop()
    except Exception:
        pass

    # Shutdown
    try:
        await redis_service.disconnect()
        print("✅ Redis disconnected")
    except Exception:
        pass


DESCRIPTION = """
## 🌑 Shadowlum API - Secure Real-time Messenger

### Features
- **JWT Access & Refresh Tokens** - Secure token-based auth
- **End-to-End Encryption** - X25519/Ed25519/AES-256-GCM encryption
- **Real-time WebSocket** - Instant message delivery
- **Direct & Group Chats** - Private and group conversations
- **File Sharing** - Images, documents, voice messages
- **Message Search** - Full-text search across chats
- **Typing Indicators** - Real-time typing status
- **Read Receipts** - Message delivery confirmation
- **User Profiles** - @username tags, avatars, bios

### Tech Stack
- **Database:** PostgreSQL
- **Cache:** Redis
- **Real-time:** WebSocket + Redis Pub/Sub
- **Encryption:** X25519 (ECDH), Ed25519 (signatures), AES-256-GCM

### WebSocket Events
```
Client → Server: send_message, typing_start, typing_stop, read_receipt
Server → Client: new_message, message_edited, message_deleted, user_online/offline
```

### E2E Encryption Flow
```
Registration: Password → PBKDF2 → Derived Key → Encrypts Private Key (IndexedDB)
Direct Chat: X25519(ephemeral, recipient_pub) → shared_secret → AES-256-GCM
Group Chat: AES-256 group_key encrypted for each member
```
"""

TAGS_METADATA = [
    {"name": "auth", "description": "🔑 **Authentication** - Register, login, token refresh"},
    {"name": "users", "description": "👤 **Users** - Profile management, @username search"},
    {"name": "chats", "description": "💬 **Chats** - Direct and group chat management"},
    {"name": "messages", "description": "✉️ **Messages** - Send, edit, delete (E2E encrypted)"},
    {"name": "encryption", "description": "🔐 **Encryption** - Key management, E2E encryption"},
    {"name": "files", "description": "📁 **Files** - Upload images, documents, voice messages"},
    {"name": "websocket", "description": "🔌 **WebSocket** - Real-time messaging connection"},
    {"name": "health", "description": "💚 **Health** - Service status monitoring"},
]

app = FastAPI(
    title="🌑 Shadowlum API",
    description=DESCRIPTION,
    version="2.0.0",
    openapi_tags=TAGS_METADATA,
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)

# CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rate limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Include all routers
app.include_router(api_router)

# Mount static files
STATIC_DIR.mkdir(parents=True, exist_ok=True)
(STATIC_DIR / "uploads").mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


# Custom dark theme CSS for Swagger
CUSTOM_CSS = """
:root {
    --bg-primary: #0d1117;
    --bg-secondary: #161b22;
    --text-primary: #f0f6fc;
    --accent: #58a6ff;
    --success: #3fb950;
    --border: #30363d;
}
body { background: var(--bg-primary) !important; }
.swagger-ui { background: var(--bg-primary); }
.swagger-ui .topbar { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important; }
.swagger-ui .info .title { color: var(--text-primary) !important; }
.swagger-ui .opblock { background: var(--bg-secondary) !important; border: 1px solid var(--border) !important; }
.swagger-ui .opblock.opblock-post { border-color: var(--success) !important; }
.swagger-ui .opblock.opblock-get { border-color: var(--accent) !important; }
"""

LANDING_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🌑 Shadowlum API</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #0d1117 0%, #161b22 100%);
            min-height: 100vh;
            color: #f0f6fc;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .container { text-align: center; padding: 40px; }
        .logo { font-size: 80px; margin-bottom: 20px; }
        h1 {
            font-size: 48px;
            background: linear-gradient(135deg, #58a6ff, #a855f7, #ec4899);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 16px;
        }
        .subtitle { color: #8b949e; font-size: 20px; margin-bottom: 40px; }
        .buttons { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; }
        .btn {
            padding: 14px 28px;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            text-decoration: none;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .btn:hover { transform: translateY(-2px); }
        .btn-primary {
            background: linear-gradient(135deg, #58a6ff, #764ba2);
            color: white;
            box-shadow: 0 4px 20px rgba(88,166,255,0.3);
        }
        .btn-secondary {
            background: #21262d;
            color: #f0f6fc;
            border: 2px solid #30363d;
        }
        .features {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-top: 60px;
            max-width: 800px;
        }
        .feature {
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 12px;
            padding: 24px;
        }
        .feature-icon { font-size: 32px; margin-bottom: 12px; }
        .feature h3 { font-size: 16px; margin-bottom: 8px; }
        .feature p { color: #8b949e; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">💬</div>
        <h1>Shadowlum API</h1>
        <p class="subtitle">Real-time messaging with PostgreSQL, Redis & WebSocket</p>
        <div class="buttons">
            <a href="/docs" class="btn btn-primary">📚 API Docs</a>
            <a href="/redoc" class="btn btn-secondary">📖 ReDoc</a>
        </div>
        <div class="features">
            <div class="feature">
                <div class="feature-icon">🔌</div>
                <h3>WebSocket</h3>
                <p>Real-time messaging</p>
            </div>
            <div class="feature">
                <div class="feature-icon">🐘</div>
                <h3>PostgreSQL</h3>
                <p>Reliable database</p>
            </div>
            <div class="feature">
                <div class="feature-icon">⚡</div>
                <h3>Redis</h3>
                <p>Fast caching & pub/sub</p>
            </div>
            <div class="feature">
                <div class="feature-icon">🔐</div>
                <h3>JWT Auth</h3>
                <p>Secure tokens</p>
            </div>
        </div>
    </div>
</body>
</html>
"""


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
def landing():
    return LANDING_HTML


@app.get("/docs", include_in_schema=False)
def custom_swagger_ui():
    html = get_swagger_ui_html(
        openapi_url="/openapi.json",
        title="🌑 Shadowlum API",
        swagger_ui_parameters={"persistAuthorization": True, "tryItOutEnabled": True},
    )
    return HTMLResponse(html.body.decode().replace("</head>", f"<style>{CUSTOM_CSS}</style></head>"))


@app.get("/redoc", include_in_schema=False)
def custom_redoc():
    return get_redoc_html(openapi_url="/openapi.json", title="🌑 Shadowlum API")


@app.get("/health", tags=["health"])
async def health():
    """Health check with Redis status"""
    from app.services.redis_service import redis_service

    redis_ok = False
    try:
        if redis_service.redis:
            await redis_service.redis.ping()
            redis_ok = True
    except Exception:
        pass

    return {
        "status": "ok",
        "service": "messenger-api",
        "version": "2.0.0",
        "redis": "connected" if redis_ok else "disconnected"
    }
