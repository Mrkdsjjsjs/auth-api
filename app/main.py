from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.openapi.docs import get_swagger_ui_html, get_redoc_html
from fastapi.openapi.utils import get_openapi
from pathlib import Path
from app.database import init_db
from app.routes import router

STATIC_DIR = Path(__file__).parent / "static"

DESCRIPTION = """
## 🔐 Auth API - Production-Ready Authentication

### Features
- **JWT Access & Refresh Tokens** - Secure token-based auth
- **Password Hashing** - bcrypt encryption
- **Password Reset Flow** - Secure reset via token
- **SQLModel ORM** - Type-safe database operations

### Authentication Flow
```
┌─────────┐          ┌─────────┐
│ Client  │──login──▶│ Server  │
└─────────┘◀─tokens──└─────────┘
     │                    │
     │──access_token─────▶│
     │◀────user_data──────│
```

### Quick Start
```bash
curl -X POST /auth/register -H "Content-Type: application/json" \\
  -d '{"email":"user@example.com","password":"secret123"}'
```
"""

TAGS_METADATA = [
    {
        "name": "auth",
        "description": "🔑 **Authentication endpoints** - Register, login, token refresh, password reset",
    },
    {
        "name": "health",
        "description": "💚 **Health checks** - Service status monitoring",
    },
]

app = FastAPI(
    title="🔐 Auth API",
    description=DESCRIPTION,
    version="1.0.0",
    contact={
        "name": "API Support",
        "email": "support@example.com",
    },
    license_info={
        "name": "MIT",
        "url": "https://opensource.org/licenses/MIT",
    },
    openapi_tags=TAGS_METADATA,
    docs_url=None,
    redoc_url=None,
)

app.include_router(router)

# Mount static files
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

CUSTOM_CSS = """
:root {
    --bg-primary: #0d1117;
    --bg-secondary: #161b22;
    --bg-tertiary: #21262d;
    --text-primary: #f0f6fc;
    --text-secondary: #8b949e;
    --accent: #58a6ff;
    --accent-hover: #79c0ff;
    --success: #3fb950;
    --warning: #d29922;
    --error: #f85149;
    --border: #30363d;
}

body {
    background: var(--bg-primary) !important;
}

.swagger-ui {
    background: var(--bg-primary);
}

.swagger-ui .topbar {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
    padding: 15px 0;
}

.swagger-ui .topbar .download-url-wrapper .select-label select {
    border: 2px solid var(--accent);
    background: var(--bg-secondary);
    color: var(--text-primary);
}

.swagger-ui .info {
    margin: 30px 0;
}

.swagger-ui .info .title {
    color: var(--text-primary) !important;
    font-size: 42px !important;
    font-weight: 700 !important;
    text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
}

.swagger-ui .info .description {
    background: var(--bg-secondary);
    border-radius: 12px;
    padding: 20px;
    border-left: 4px solid var(--accent);
}

.swagger-ui .info .description p,
.swagger-ui .info .description li {
    color: var(--text-secondary) !important;
}

.swagger-ui .info .description h2,
.swagger-ui .info .description h3 {
    color: var(--text-primary) !important;
}

.swagger-ui .info .description code {
    background: var(--bg-tertiary) !important;
    color: var(--accent) !important;
    padding: 2px 6px;
    border-radius: 4px;
}

.swagger-ui .info .description pre {
    background: var(--bg-tertiary) !important;
    border-radius: 8px;
    padding: 15px;
    border: 1px solid var(--border);
}

.swagger-ui .scheme-container {
    background: var(--bg-secondary) !important;
    box-shadow: 0 4px 6px rgba(0,0,0,0.3);
    border-radius: 8px;
    padding: 15px;
}

.swagger-ui .opblock-tag {
    background: var(--bg-secondary) !important;
    border-radius: 8px !important;
    border: 1px solid var(--border) !important;
    margin: 10px 0 !important;
    transition: all 0.3s ease !important;
}

.swagger-ui .opblock-tag:hover {
    border-color: var(--accent) !important;
    transform: translateX(5px);
}

.swagger-ui .opblock-tag small {
    color: var(--text-secondary) !important;
}

.swagger-ui .opblock {
    background: var(--bg-secondary) !important;
    border-radius: 8px !important;
    margin: 10px 0 !important;
    border: 1px solid var(--border) !important;
    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    transition: all 0.3s ease !important;
}

.swagger-ui .opblock:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
}

.swagger-ui .opblock.opblock-post {
    border-color: var(--success) !important;
    background: linear-gradient(90deg, rgba(63,185,80,0.1) 0%, var(--bg-secondary) 100%) !important;
}

.swagger-ui .opblock.opblock-post .opblock-summary {
    border-color: var(--success) !important;
}

.swagger-ui .opblock.opblock-get {
    border-color: var(--accent) !important;
    background: linear-gradient(90deg, rgba(88,166,255,0.1) 0%, var(--bg-secondary) 100%) !important;
}

.swagger-ui .opblock.opblock-get .opblock-summary {
    border-color: var(--accent) !important;
}

.swagger-ui .opblock.opblock-delete {
    border-color: var(--error) !important;
    background: linear-gradient(90deg, rgba(248,81,73,0.1) 0%, var(--bg-secondary) 100%) !important;
}

.swagger-ui .opblock.opblock-put {
    border-color: var(--warning) !important;
    background: linear-gradient(90deg, rgba(210,153,34,0.1) 0%, var(--bg-secondary) 100%) !important;
}

.swagger-ui .opblock .opblock-summary-method {
    border-radius: 6px !important;
    font-weight: 700 !important;
    min-width: 80px !important;
    text-shadow: 1px 1px 2px rgba(0,0,0,0.3);
}

.swagger-ui .opblock .opblock-summary-path {
    color: var(--text-primary) !important;
    font-weight: 600 !important;
}

.swagger-ui .opblock .opblock-summary-description {
    color: var(--text-secondary) !important;
}

.swagger-ui .opblock-body {
    background: var(--bg-tertiary) !important;
}

.swagger-ui .opblock-section-header {
    background: var(--bg-tertiary) !important;
    border-radius: 6px;
}

.swagger-ui .opblock-section-header h4 {
    color: var(--text-primary) !important;
}

.swagger-ui table thead tr th {
    color: var(--text-primary) !important;
    background: var(--bg-tertiary) !important;
    border-bottom: 2px solid var(--accent) !important;
}

.swagger-ui table tbody tr td {
    color: var(--text-secondary) !important;
    border-color: var(--border) !important;
}

.swagger-ui .parameter__name {
    color: var(--accent) !important;
    font-weight: 600 !important;
}

.swagger-ui .parameter__type {
    color: var(--success) !important;
}

.swagger-ui .btn {
    border-radius: 6px !important;
    font-weight: 600 !important;
    transition: all 0.2s ease !important;
}

.swagger-ui .btn.execute {
    background: linear-gradient(135deg, var(--accent) 0%, #764ba2 100%) !important;
    border: none !important;
}

.swagger-ui .btn.execute:hover {
    transform: scale(1.05);
    box-shadow: 0 4px 12px rgba(88,166,255,0.4);
}

.swagger-ui .btn.cancel {
    background: var(--error) !important;
    border: none !important;
}

.swagger-ui .responses-inner {
    background: var(--bg-secondary) !important;
    border-radius: 8px;
    padding: 10px;
}

.swagger-ui .response-col_status {
    color: var(--text-primary) !important;
    font-weight: 700 !important;
}

.swagger-ui .response-col_description {
    color: var(--text-secondary) !important;
}

.swagger-ui .model-box {
    background: var(--bg-tertiary) !important;
    border-radius: 8px;
}

.swagger-ui .model {
    color: var(--text-secondary) !important;
}

.swagger-ui .model-title {
    color: var(--text-primary) !important;
}

.swagger-ui .prop-type {
    color: var(--success) !important;
}

.swagger-ui .prop-format {
    color: var(--warning) !important;
}

.swagger-ui select,
.swagger-ui input[type=text],
.swagger-ui textarea {
    background: var(--bg-tertiary) !important;
    color: var(--text-primary) !important;
    border: 1px solid var(--border) !important;
    border-radius: 6px !important;
}

.swagger-ui select:focus,
.swagger-ui input[type=text]:focus,
.swagger-ui textarea:focus {
    border-color: var(--accent) !important;
    box-shadow: 0 0 0 3px rgba(88,166,255,0.2) !important;
}

.swagger-ui .highlight-code {
    background: var(--bg-tertiary) !important;
    border-radius: 8px;
}

.swagger-ui .microlight {
    background: var(--bg-tertiary) !important;
    color: var(--text-primary) !important;
    border-radius: 8px;
    padding: 15px !important;
}

.swagger-ui .copy-to-clipboard {
    background: var(--accent) !important;
    border-radius: 4px;
}

.swagger-ui .copy-to-clipboard button {
    background: transparent !important;
}

/* Scrollbar */
.swagger-ui ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
}

.swagger-ui ::-webkit-scrollbar-track {
    background: var(--bg-tertiary);
    border-radius: 4px;
}

.swagger-ui ::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 4px;
}

.swagger-ui ::-webkit-scrollbar-thumb:hover {
    background: var(--accent);
}

/* Animations */
@keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
}

.swagger-ui .opblock {
    animation: fadeIn 0.3s ease;
}

/* Auth lock icon */
.swagger-ui .authorization__btn {
    background: linear-gradient(135deg, var(--warning) 0%, #f85149 100%) !important;
    border-radius: 50% !important;
    padding: 8px !important;
}

.swagger-ui .authorization__btn.unlocked {
    background: linear-gradient(135deg, var(--success) 0%, #2ea043 100%) !important;
}

/* Try it out section */
.swagger-ui .try-out__btn {
    background: var(--accent) !important;
    border: none !important;
    color: white !important;
}

.swagger-ui .try-out__btn:hover {
    background: var(--accent-hover) !important;
}
"""

LANDING_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🔐 Auth API</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Inter', sans-serif;
            background: linear-gradient(135deg, #0d1117 0%, #161b22 50%, #0d1117 100%);
            min-height: 100vh;
            color: #f0f6fc;
            overflow-x: hidden;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 40px 20px;
        }

        .hero {
            text-align: center;
            padding: 80px 0;
            position: relative;
        }

        .hero::before {
            content: '';
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 600px;
            height: 600px;
            background: radial-gradient(circle, rgba(88,166,255,0.1) 0%, transparent 70%);
            pointer-events: none;
        }

        .logo {
            font-size: 80px;
            margin-bottom: 20px;
            animation: float 3s ease-in-out infinite;
        }

        @keyframes float {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
        }

        h1 {
            font-size: 56px;
            font-weight: 800;
            background: linear-gradient(135deg, #58a6ff 0%, #a855f7 50%, #ec4899 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 20px;
        }

        .subtitle {
            font-size: 22px;
            color: #8b949e;
            margin-bottom: 40px;
            max-width: 600px;
            margin-left: auto;
            margin-right: auto;
        }

        .buttons {
            display: flex;
            gap: 20px;
            justify-content: center;
            flex-wrap: wrap;
        }

        .btn {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            padding: 16px 32px;
            border-radius: 12px;
            font-size: 18px;
            font-weight: 600;
            text-decoration: none;
            transition: all 0.3s ease;
        }

        .btn-primary {
            background: linear-gradient(135deg, #58a6ff 0%, #764ba2 100%);
            color: white;
            box-shadow: 0 4px 20px rgba(88,166,255,0.3);
        }

        .btn-primary:hover {
            transform: translateY(-3px);
            box-shadow: 0 8px 30px rgba(88,166,255,0.4);
        }

        .btn-secondary {
            background: #21262d;
            color: #f0f6fc;
            border: 2px solid #30363d;
        }

        .btn-secondary:hover {
            border-color: #58a6ff;
            background: #30363d;
        }

        .features {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 24px;
            margin-top: 80px;
        }

        .feature {
            background: linear-gradient(135deg, #161b22 0%, #21262d 100%);
            border: 1px solid #30363d;
            border-radius: 16px;
            padding: 32px;
            transition: all 0.3s ease;
        }

        .feature:hover {
            transform: translateY(-5px);
            border-color: #58a6ff;
            box-shadow: 0 10px 40px rgba(0,0,0,0.3);
        }

        .feature-icon {
            font-size: 40px;
            margin-bottom: 16px;
        }

        .feature h3 {
            font-size: 20px;
            font-weight: 700;
            margin-bottom: 12px;
            color: #f0f6fc;
        }

        .feature p {
            color: #8b949e;
            line-height: 1.6;
        }

        .endpoints {
            margin-top: 80px;
        }

        .endpoints h2 {
            font-size: 36px;
            text-align: center;
            margin-bottom: 40px;
            color: #f0f6fc;
        }

        .endpoint-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .endpoint {
            display: flex;
            align-items: center;
            gap: 16px;
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 12px;
            padding: 20px 24px;
            transition: all 0.3s ease;
        }

        .endpoint:hover {
            border-color: #58a6ff;
            transform: translateX(10px);
        }

        .method {
            padding: 6px 12px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 700;
            min-width: 70px;
            text-align: center;
        }

        .method-post { background: #238636; color: white; }
        .method-get { background: #1f6feb; color: white; }

        .endpoint-path {
            font-family: 'SF Mono', Monaco, monospace;
            color: #58a6ff;
            font-weight: 600;
        }

        .endpoint-desc {
            color: #8b949e;
            margin-left: auto;
        }

        .stats {
            display: flex;
            justify-content: center;
            gap: 60px;
            margin-top: 80px;
            flex-wrap: wrap;
        }

        .stat {
            text-align: center;
        }

        .stat-value {
            font-size: 48px;
            font-weight: 800;
            background: linear-gradient(135deg, #3fb950 0%, #58a6ff 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .stat-label {
            color: #8b949e;
            font-size: 16px;
            margin-top: 8px;
        }

        footer {
            text-align: center;
            margin-top: 80px;
            padding: 40px 0;
            border-top: 1px solid #30363d;
            color: #8b949e;
        }

        footer a {
            color: #58a6ff;
            text-decoration: none;
        }

        footer a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="hero">
            <div class="logo">🔐</div>
            <h1>Auth API</h1>
            <p class="subtitle">Production-ready authentication API with JWT tokens, secure password hashing, and complete auth flow</p>
            <div class="buttons">
                <a href="/demo" class="btn btn-primary">
                    <span>🎬</span> Watch Demo
                </a>
                <a href="/docs" class="btn btn-primary">
                    <span>📚</span> Interactive Docs
                </a>
                <a href="/redoc" class="btn btn-secondary">
                    <span>📖</span> ReDoc
                </a>
            </div>
        </div>

        <div class="features">
            <div class="feature">
                <div class="feature-icon">🔑</div>
                <h3>JWT Authentication</h3>
                <p>Access tokens (15 min) and refresh tokens (7 days) with secure HS256 signing</p>
            </div>
            <div class="feature">
                <div class="feature-icon">🛡️</div>
                <h3>Secure Passwords</h3>
                <p>bcrypt hashing with automatic salt generation for maximum security</p>
            </div>
            <div class="feature">
                <div class="feature-icon">📧</div>
                <h3>Password Reset</h3>
                <p>Complete forgot/reset password flow with secure tokens</p>
            </div>
            <div class="feature">
                <div class="feature-icon">⚡</div>
                <h3>High Performance</h3>
                <p>Built on FastAPI with async support and automatic OpenAPI docs</p>
            </div>
        </div>

        <div class="endpoints">
            <h2>🚀 API Endpoints</h2>
            <div class="endpoint-list">
                <div class="endpoint">
                    <span class="method method-post">POST</span>
                    <span class="endpoint-path">/auth/register</span>
                    <span class="endpoint-desc">Create new user account</span>
                </div>
                <div class="endpoint">
                    <span class="method method-post">POST</span>
                    <span class="endpoint-path">/auth/login</span>
                    <span class="endpoint-desc">Get access & refresh tokens</span>
                </div>
                <div class="endpoint">
                    <span class="method method-post">POST</span>
                    <span class="endpoint-path">/auth/refresh</span>
                    <span class="endpoint-desc">Refresh expired tokens</span>
                </div>
                <div class="endpoint">
                    <span class="method method-get">GET</span>
                    <span class="endpoint-path">/auth/me</span>
                    <span class="endpoint-desc">Get current user info</span>
                </div>
                <div class="endpoint">
                    <span class="method method-post">POST</span>
                    <span class="endpoint-path">/auth/forgot</span>
                    <span class="endpoint-desc">Request password reset</span>
                </div>
                <div class="endpoint">
                    <span class="method method-post">POST</span>
                    <span class="endpoint-path">/auth/reset</span>
                    <span class="endpoint-desc">Reset password with token</span>
                </div>
            </div>
        </div>

        <div class="stats">
            <div class="stat">
                <div class="stat-value">8</div>
                <div class="stat-label">Tests Passing</div>
            </div>
            <div class="stat">
                <div class="stat-value">100%</div>
                <div class="stat-label">Coverage</div>
            </div>
            <div class="stat">
                <div class="stat-value">&lt;50ms</div>
                <div class="stat-label">Avg Response</div>
            </div>
        </div>

        <footer>
            <p>Made with ❤️ using <a href="https://fastapi.tiangolo.com" target="_blank">FastAPI</a></p>
            <p style="margin-top: 10px;">
                <a href="https://github.com/Mrkdsjjsjs/auth-api" target="_blank">GitHub</a> ·
                <a href="/docs">Swagger</a> ·
                <a href="/redoc">ReDoc</a>
            </p>
        </footer>
    </div>
</body>
</html>
"""

@app.on_event("startup")
def on_startup():
    init_db()

@app.get("/", response_class=HTMLResponse, include_in_schema=False)
def landing():
    return LANDING_HTML

@app.get("/docs", include_in_schema=False)
def custom_swagger_ui():
    html_response = get_swagger_ui_html(
        openapi_url="/openapi.json",
        title="🔐 Auth API - Swagger",
        swagger_css_url="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css",
        swagger_ui_parameters={
            "syntaxHighlight.theme": "monokai",
            "tryItOutEnabled": True,
            "displayRequestDuration": True,
            "filter": True,
            "showExtensions": True,
            "showCommonExtensions": True,
            "docExpansion": "list",
            "deepLinking": True,
            "defaultModelsExpandDepth": 3,
            "defaultModelExpandDepth": 3,
            "persistAuthorization": True,
        },
    )
    html_content = html_response.body.decode()
    html_with_css = html_content.replace("</head>", f"<style>{CUSTOM_CSS}</style></head>")
    return HTMLResponse(content=html_with_css)

@app.get("/redoc", include_in_schema=False)
def custom_redoc():
    return get_redoc_html(
        openapi_url="/openapi.json",
        title="🔐 Auth API - ReDoc",
        redoc_js_url="https://cdn.jsdelivr.net/npm/redoc@latest/bundles/redoc.standalone.js",
    )

@app.get("/demo", response_class=HTMLResponse, include_in_schema=False)
def demo():
    """Interactive API Demo"""
    demo_file = STATIC_DIR / "demo.html"
    if demo_file.exists():
        return HTMLResponse(content=demo_file.read_text())
    return HTMLResponse(content="<h1>Demo not found</h1>", status_code=404)

@app.get("/health", tags=["health"])
def health():
    """
    🏥 **Health Check Endpoint**

    Returns the current status of the API service.
    Use this endpoint for monitoring and load balancer health checks.

    **Response:**
    - `status`: Service health status
    """
    return {"status": "ok", "service": "auth-api", "version": "1.0.0"}
