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

@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(data: UserCreate, session: Session = Depends(get_session)):
    existing = session.exec(select(User).where(User.email == data.email)).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")
    user = User(email=data.email, hashed_password=hash_password(data.password))
    session.add(user)
    session.commit()
    session.refresh(user)
    return user

@router.post("/login", response_model=TokenResponse)
def login(data: UserCreate, session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.email == data.email)).first()
    if not user or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return TokenResponse(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id)
    )

@router.post("/refresh", response_model=TokenResponse)
def refresh(data: RefreshRequest, session: Session = Depends(get_session)):
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

@router.get("/me", response_model=UserResponse)
def me(user: User = Depends(get_current_user)):
    return user

@router.post("/forgot", response_model=MessageResponse)
def forgot_password(data: ForgotPasswordRequest, session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.email == data.email)).first()
    if user:
        user.reset_token = generate_reset_token()
        user.reset_token_expires = datetime.utcnow() + timedelta(hours=1)
        session.add(user)
        session.commit()
    return MessageResponse(message="If email exists, reset instructions sent")

@router.post("/reset", response_model=MessageResponse)
def reset_password(data: ResetPasswordRequest, session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.reset_token == data.token)).first()
    if not user or not user.reset_token_expires or user.reset_token_expires < datetime.utcnow():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired token")
    user.hashed_password = hash_password(data.new_password)
    user.reset_token = None
    user.reset_token_expires = None
    session.add(user)
    session.commit()
    return MessageResponse(message="Password reset successful")
