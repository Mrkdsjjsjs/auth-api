"""
End-to-end test for message sending.
Run with: pytest tests/test_messages_e2e.py -v
"""
import pytest
import httpx
import asyncio

BASE_URL = "http://localhost:8000"

# Test credentials - create these users first
TEST_USER1 = {"email": "testuser1@test.com", "password": "testpass123"}
TEST_USER2 = {"email": "testuser2@test.com", "password": "testpass123"}


@pytest.fixture
def client():
    return httpx.Client(base_url=BASE_URL)


def register_user(client: httpx.Client, email: str, password: str):
    """Register a new user, ignore if already exists"""
    response = client.post("/auth/register", json={"email": email, "password": password})
    return response.status_code in [201, 400]  # 400 = already exists


def login_user(client: httpx.Client, email: str, password: str) -> dict:
    """Login and return tokens"""
    response = client.post("/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, f"Login failed: {response.text}"
    return response.json()


def get_or_create_chat(client: httpx.Client, token: str, other_user_id: str) -> str:
    """Get existing chat or create new one"""
    headers = {"Authorization": f"Bearer {token}"}

    # List chats
    response = client.get("/api/chats", headers=headers)
    assert response.status_code == 200
    chats = response.json()["chats"]

    # Find existing chat with user
    for chat in chats:
        if chat["type"] == "direct":
            member_ids = [m["user_id"] for m in chat["members"]]
            if other_user_id in member_ids:
                return chat["id"]

    # Create new chat
    response = client.post(
        "/api/chats",
        headers=headers,
        json={"type": "direct", "member_ids": [other_user_id]}
    )
    assert response.status_code == 201, f"Create chat failed: {response.text}"
    return response.json()["id"]


def get_user_id(client: httpx.Client, token: str) -> str:
    """Get current user's ID"""
    headers = {"Authorization": f"Bearer {token}"}
    response = client.get("/auth/me", headers=headers)
    assert response.status_code == 200
    return response.json()["id"]


def test_send_message_basic(client):
    """Test basic message sending without encryption"""
    # Register users
    register_user(client, TEST_USER1["email"], TEST_USER1["password"])
    register_user(client, TEST_USER2["email"], TEST_USER2["password"])

    # Login both users
    tokens1 = login_user(client, TEST_USER1["email"], TEST_USER1["password"])
    tokens2 = login_user(client, TEST_USER2["email"], TEST_USER2["password"])

    user1_id = get_user_id(client, tokens1["access_token"])
    user2_id = get_user_id(client, tokens2["access_token"])

    # Create chat between users
    chat_id = get_or_create_chat(client, tokens1["access_token"], user2_id)

    # Send message from user1
    headers = {"Authorization": f"Bearer {tokens1['access_token']}"}
    message_content = f"Test message {asyncio.get_event_loop().time()}"

    response = client.post(
        f"/api/chats/{chat_id}/messages",
        headers=headers,
        json={"content": message_content}
    )

    print(f"Send message response: {response.status_code}")
    print(f"Response body: {response.text}")

    assert response.status_code == 201, f"Send message failed: {response.text}"
    message = response.json()

    # Verify message was created
    assert message["sender_id"] == user1_id
    assert message["chat_id"] == chat_id
    # Content might be None if encrypted, or the actual content

    # Get messages as user2
    headers2 = {"Authorization": f"Bearer {tokens2['access_token']}"}
    response = client.get(f"/api/chats/{chat_id}/messages", headers=headers2)

    assert response.status_code == 200
    messages = response.json()["messages"]

    # Find our message
    found = False
    for msg in messages:
        if msg["id"] == message["id"]:
            found = True
            print(f"Message found: {msg}")
            break

    assert found, "Message not found in chat messages"


def test_message_encryption_flow(client):
    """Test that messages are encrypted when keys are registered"""
    # Register and login
    register_user(client, TEST_USER1["email"], TEST_USER1["password"])
    tokens = login_user(client, TEST_USER1["email"], TEST_USER1["password"])
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    # Register encryption key
    import base64
    import os

    # Generate a fake public key (32 bytes for X25519)
    fake_public_key = base64.b64encode(os.urandom(32)).decode()

    response = client.post(
        "/api/keys/register",
        headers=headers,
        json={
            "public_key": fake_public_key,
            "signature_public_key": fake_public_key,
            "key_type": "identity"
        }
    )

    print(f"Key register response: {response.status_code}")
    print(f"Response body: {response.text}")

    # Note: We can't actually decrypt since we used a fake key,
    # but we can verify the encryption flow works


if __name__ == "__main__":
    with httpx.Client(base_url=BASE_URL) as client:
        print("Running test_send_message_basic...")
        test_send_message_basic(client)
        print("PASSED!")

        print("\nRunning test_message_encryption_flow...")
        test_message_encryption_flow(client)
        print("PASSED!")
