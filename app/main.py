from fastapi import FastAPI
from app.database import init_db
from app.routes import router

app = FastAPI(title="Auth API")
app.include_router(router)

@app.on_event("startup")
def on_startup():
    init_db()

@app.get("/health")
def health():
    return {"status": "ok"}
