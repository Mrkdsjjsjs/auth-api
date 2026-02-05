import os
from datetime import timedelta

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE = timedelta(minutes=15)
REFRESH_TOKEN_EXPIRE = timedelta(days=7)
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./app.db")
