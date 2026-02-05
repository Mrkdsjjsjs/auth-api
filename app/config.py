import os
from datetime import timedelta

# JWT
SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE = timedelta(minutes=15)
REFRESH_TOKEN_EXPIRE = timedelta(days=7)

# Database - PostgreSQL
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://messenger:messenger@localhost:5432/messenger"
)

# Redis
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# File uploads
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "static/uploads")
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB
MAX_FILE_SIZE = 50 * 1024 * 1024   # 50MB
MAX_VOICE_SIZE = 5 * 1024 * 1024   # 5MB

# CORS
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173").split(",")
