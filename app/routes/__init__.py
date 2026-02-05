from fastapi import APIRouter
from app.routes.auth import router as auth_router
from app.routes.users import router as users_router
from app.routes.chats import router as chats_router
from app.routes.messages import router as messages_router
from app.routes.files import router as files_router
from app.routes.websocket import router as websocket_router
from app.routes.keys import router as keys_router

api_router = APIRouter()

api_router.include_router(auth_router)
api_router.include_router(users_router)
api_router.include_router(chats_router)
api_router.include_router(messages_router)
api_router.include_router(files_router)
api_router.include_router(websocket_router)
api_router.include_router(keys_router)
