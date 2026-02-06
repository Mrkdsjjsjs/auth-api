"""
Calls API - ICE servers configuration
"""
from fastapi import APIRouter, Depends
from app.auth import get_current_user
from app.models.user import User
from app.services.call_service import call_service

router = APIRouter(prefix="/api", tags=["calls"])


@router.get("/ice-servers")
async def get_ice_servers(current_user: User = Depends(get_current_user)):
    """
    Get ICE servers configuration for WebRTC.
    Returns STUN/TURN servers with time-limited credentials.
    """
    ice_servers = call_service.get_ice_servers(current_user.id)
    return {"ice_servers": ice_servers}
