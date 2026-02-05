from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select
from datetime import datetime, timedelta
from app.database import get_session
from app.models import (
    User, UserCreate, UserResponse, TokenResponse,
    RefreshRequest, ForgotPasswordRequest, ResetPasswordRequest, MessageResponse
)
from app.auth import (
    hash_password, verify_password, create_access_token,
    create_refresh_token, decode_token, get_current_user, generate_reset_token
)

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED,
    summary="📝 Register new user",
    responses={
        201: {"description": "User created successfully"},
        400: {"description": "Email already registered"},
    })
def register(data: UserCreate, session: Session = Depends(get_session)):
    """
    **Create a new user account**

    Register a new user with email and password.
    Password will be securely hashed using bcrypt.

    - **email**: Valid email address (unique)
    - **password**: User password (min 6 characters recommended)

    ```python
    import requests
    response = requests.post("/auth/register", json={
        "email": "user@example.com",
        "password": "secretpassword"
    })
    ```
    """
    existing = session.exec(select(User).where(User.email == data.email)).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")
    user = User(email=data.email, hashed_password=hash_password(data.password))
    session.add(user)
    session.commit()
    session.refresh(user)
    return user

@router.post("/login", response_model=TokenResponse,
    summary="🔓 Login user",
    responses={
        200: {"description": "Login successful, tokens returned"},
        401: {"description": "Invalid credentials"},
    })
def login(data: UserCreate, session: Session = Depends(get_session)):
    """
    **Authenticate user and get tokens**

    Login with email and password to receive JWT tokens.

    **Token Lifetimes:**
    - 🔑 Access Token: **15 minutes**
    - 🔄 Refresh Token: **7 days**

    ```javascript
    // Store tokens securely
    localStorage.setItem('access_token', response.access_token);
    localStorage.setItem('refresh_token', response.refresh_token);
    ```
    """
    user = session.exec(select(User).where(User.email == data.email)).first()
    if not user or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return TokenResponse(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id)
    )

@router.post("/refresh", response_model=TokenResponse,
    summary="🔄 Refresh tokens",
    responses={
        200: {"description": "New tokens generated"},
        401: {"description": "Invalid or expired refresh token"},
    })
def refresh(data: RefreshRequest, session: Session = Depends(get_session)):
    """
    **Get new access & refresh tokens**

    Use refresh token to get new tokens when access token expires.

    ⚠️ **Important:** Both tokens are rotated on refresh for security.

    ```
    ┌─────────────────────────────────────────┐
    │  Access Token Expired (401)             │
    │           ↓                             │
    │  POST /auth/refresh                     │
    │           ↓                             │
    │  New Access + Refresh Tokens            │
    └─────────────────────────────────────────┘
    ```
    """
    user_id = decode_token(data.refresh_token, "refresh")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return TokenResponse(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id)
    )

@router.get("/me", response_model=UserResponse,
    summary="👤 Get current user",
    responses={
        200: {"description": "User data returned"},
        401: {"description": "Invalid or missing token"},
    })
def me(user: User = Depends(get_current_user)):
    """
    **Get authenticated user's profile**

    🔒 **Requires Authentication**

    Include the access token in the Authorization header:

    ```
    Authorization: Bearer <access_token>
    ```

    Returns the current user's profile information.
    """
    return user

@router.post("/forgot", response_model=MessageResponse,
    summary="📧 Forgot password",
    responses={
        200: {"description": "Reset email sent (if user exists)"},
    })
def forgot_password(data: ForgotPasswordRequest, session: Session = Depends(get_session)):
    """
    **Request password reset**

    Send a password reset token to the user's email.

    🛡️ **Security Note:** Response is always the same whether
    email exists or not (prevents email enumeration).

    **Token expires in 1 hour.**

    ```
    ┌──────────┐         ┌──────────┐
    │  Client  │         │  Server  │
    └────┬─────┘         └────┬─────┘
         │  POST /forgot      │
         │───────────────────>│
         │                    │──> Generate token
         │                    │──> Send email
         │  {message}         │
         │<───────────────────│
    ```
    """
    user = session.exec(select(User).where(User.email == data.email)).first()
    if user:
        user.reset_token = generate_reset_token()
        user.reset_token_expires = datetime.utcnow() + timedelta(hours=1)
        session.add(user)
        session.commit()
    return MessageResponse(message="If email exists, reset instructions sent")

@router.post("/reset", response_model=MessageResponse,
    summary="🔐 Reset password",
    responses={
        200: {"description": "Password reset successful"},
        400: {"description": "Invalid or expired token"},
    })
def reset_password(data: ResetPasswordRequest, session: Session = Depends(get_session)):
    """
    **Reset password with token**

    Use the token received via email to set a new password.

    - **token**: Reset token from email
    - **new_password**: New password to set

    ⏰ **Token expires after 1 hour**

    After successful reset:
    - Token is invalidated
    - User can login with new password
    """
    user = session.exec(select(User).where(User.reset_token == data.token)).first()
    if not user or not user.reset_token_expires or user.reset_token_expires < datetime.utcnow():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired token")
    user.hashed_password = hash_password(data.new_password)
    user.reset_token = None
    user.reset_token_expires = None
    session.add(user)
    session.commit()
    return MessageResponse(message="Password reset successful")
