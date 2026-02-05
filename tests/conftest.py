import pytest
from sqlmodel import SQLModel, create_engine, Session
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

# Import all models FIRST to register them with SQLModel metadata
from app.models.user import User
from app.models.chat import Chat, ChatMember
from app.models.message import Message
from app.models.file import File

from app.main import app
from app.database import get_session

# Use StaticPool to share the in-memory database across connections
# Create engine at module level
test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


def override_get_session():
    with Session(test_engine) as session:
        yield session


# Apply the override once
app.dependency_overrides[get_session] = override_get_session


@pytest.fixture(autouse=True)
def setup_db():
    """Create all tables before each test and drop after"""
    SQLModel.metadata.create_all(test_engine)
    yield
    SQLModel.metadata.drop_all(test_engine)


@pytest.fixture
def client():
    """Test client fixture"""
    return TestClient(app)
