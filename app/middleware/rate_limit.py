from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from starlette.requests import Request
from starlette.responses import JSONResponse

# Create limiter instance
limiter = Limiter(key_func=get_remote_address)


def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """Custom handler for rate limit exceeded"""
    return JSONResponse(
        status_code=429,
        content={
            "detail": "Rate limit exceeded",
            "retry_after": exc.detail
        }
    )


# Rate limit decorators for different endpoints
# Usage: @limiter.limit("5/minute")
#
# Common limits:
# - Login: 5/minute
# - Register: 3/minute
# - Messages: 60/minute
# - Upload: 10/minute
