"""
Call Service - In-memory management of active calls
"""
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, Optional
import uuid
import secrets
import hashlib
import time


@dataclass
class ActiveCall:
    id: str
    chat_id: str
    caller_id: str
    callee_id: str
    caller_name: str
    status: str  # 'ringing', 'active', 'ended'
    created_at: datetime = field(default_factory=datetime.utcnow)
    answered_at: Optional[datetime] = None


class CallService:
    def __init__(self):
        self.active_calls: Dict[str, ActiveCall] = {}
        # User ID -> Call ID mapping for quick lookup
        self.user_calls: Dict[str, str] = {}

        # TURN server configuration
        self.turn_secret = secrets.token_hex(32)  # Shared secret for TURN auth
        self.turn_server = "85.239.52.213"
        self.turn_port = 3478
        self.turns_port = 5349  # TLS port

    def create_call(
        self,
        chat_id: str,
        caller_id: str,
        callee_id: str,
        caller_name: str
    ) -> ActiveCall:
        """Create a new call"""
        # Check if either user is already in a call
        if caller_id in self.user_calls:
            raise ValueError("Caller is already in a call")
        if callee_id in self.user_calls:
            raise ValueError("Callee is already in a call")

        call_id = str(uuid.uuid4())
        call = ActiveCall(
            id=call_id,
            chat_id=chat_id,
            caller_id=caller_id,
            callee_id=callee_id,
            caller_name=caller_name,
            status='ringing'
        )

        self.active_calls[call_id] = call
        self.user_calls[caller_id] = call_id
        self.user_calls[callee_id] = call_id

        return call

    def get_call(self, call_id: str) -> Optional[ActiveCall]:
        """Get call by ID"""
        return self.active_calls.get(call_id)

    def get_user_call(self, user_id: str) -> Optional[ActiveCall]:
        """Get active call for a user"""
        call_id = self.user_calls.get(user_id)
        if call_id:
            return self.active_calls.get(call_id)
        return None

    def accept_call(self, call_id: str) -> Optional[ActiveCall]:
        """Accept a call"""
        call = self.active_calls.get(call_id)
        if call and call.status == 'ringing':
            call.status = 'active'
            call.answered_at = datetime.utcnow()
            return call
        return None

    def end_call(self, call_id: str) -> Optional[ActiveCall]:
        """End a call and clean up"""
        call = self.active_calls.get(call_id)
        if call:
            call.status = 'ended'
            # Clean up user mappings
            self.user_calls.pop(call.caller_id, None)
            self.user_calls.pop(call.callee_id, None)
            # Remove from active calls
            del self.active_calls[call_id]
            return call
        return None

    def is_user_in_call(self, user_id: str, chat_id: str) -> bool:
        """Check if user is a member of a call in the given chat"""
        call = self.get_user_call(user_id)
        if call and call.chat_id == chat_id:
            return True
        return False

    def get_ice_servers(self, user_id: str) -> list:
        """
        Generate ICE servers configuration with time-limited TURN credentials.
        Uses TURN REST API authentication (shared secret with HMAC-SHA1).
        """
        import hmac
        import base64
        import os

        # Get shared secret from environment or use default
        turn_secret = os.getenv("TURN_SHARED_SECRET", self.turn_secret)

        # Credentials valid for 24 hours
        ttl = 86400
        timestamp = int(time.time()) + ttl
        username = f"{timestamp}:{user_id}"

        # Generate HMAC-SHA1 credential (base64 encoded)
        password = base64.b64encode(
            hmac.new(
                turn_secret.encode(),
                username.encode(),
                hashlib.sha1
            ).digest()
        ).decode()

        return [
            {
                "urls": [
                    f"stun:{self.turn_server}:{self.turn_port}",
                ],
            },
            {
                "urls": [
                    f"turn:{self.turn_server}:{self.turn_port}?transport=udp",
                    f"turn:{self.turn_server}:{self.turn_port}?transport=tcp",
                    f"turns:{self.turn_server}:{self.turns_port}?transport=tcp",
                ],
                "username": username,
                "credential": password,
            },
        ]


# Singleton instance
call_service = CallService()
