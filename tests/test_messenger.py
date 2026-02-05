import pytest
from fastapi.testclient import TestClient

from tests.conftest import test_engine
from app.main import app
from app.models.user import User
from app.models.chat import Chat, ChatMember
from app.models.message import Message

client = TestClient(app)


def create_user(email: str, password: str = "secret123"):
    """Helper to create and login a user"""
    client.post("/auth/register", json={"email": email, "password": password})
    response = client.post("/auth/login", json={"email": email, "password": password})
    return response.json()


def auth_header(tokens):
    """Helper to create auth header"""
    return {"Authorization": f"Bearer {tokens['access_token']}"}


# User tests
class TestUsers:
    def test_update_profile(self):
        tokens = create_user("user@example.com")
        r = client.put(
            "/api/users/me",
            json={"username": "testuser", "display_name": "Test User", "bio": "Hello!"},
            headers=auth_header(tokens)
        )
        assert r.status_code == 200
        assert r.json()["username"] == "testuser"
        assert r.json()["display_name"] == "Test User"

    def test_username_unique(self):
        tokens1 = create_user("user1@example.com")
        tokens2 = create_user("user2@example.com")

        client.put(
            "/api/users/me",
            json={"username": "taken"},
            headers=auth_header(tokens1)
        )

        r = client.put(
            "/api/users/me",
            json={"username": "taken"},
            headers=auth_header(tokens2)
        )
        assert r.status_code == 400

    def test_search_users(self):
        tokens = create_user("searcher@example.com")
        create_user("findme@example.com")

        r = client.get(
            "/api/users/search?q=findme",
            headers=auth_header(tokens)
        )
        assert r.status_code == 200
        assert r.json()["total"] >= 1

    def test_get_user_by_id(self):
        tokens1 = create_user("user1@example.com")
        tokens2 = create_user("user2@example.com")

        # Get user1's ID
        me = client.get("/auth/me", headers=auth_header(tokens1)).json()

        # User2 gets user1's profile
        r = client.get(f"/api/users/{me['id']}", headers=auth_header(tokens2))
        assert r.status_code == 200
        assert r.json()["id"] == me["id"]


# Chat tests
class TestChats:
    def test_create_direct_chat(self):
        tokens1 = create_user("chat1@example.com")
        tokens2 = create_user("chat2@example.com")

        me2 = client.get("/auth/me", headers=auth_header(tokens2)).json()

        r = client.post(
            "/api/chats",
            json={"type": "direct", "member_ids": [me2["id"]]},
            headers=auth_header(tokens1)
        )
        assert r.status_code == 201
        assert r.json()["type"] == "direct"
        assert len(r.json()["members"]) == 2

    def test_create_group_chat(self):
        tokens1 = create_user("group1@example.com")
        tokens2 = create_user("group2@example.com")
        tokens3 = create_user("group3@example.com")

        me2 = client.get("/auth/me", headers=auth_header(tokens2)).json()
        me3 = client.get("/auth/me", headers=auth_header(tokens3)).json()

        r = client.post(
            "/api/chats",
            json={"type": "group", "name": "Test Group", "member_ids": [me2["id"], me3["id"]]},
            headers=auth_header(tokens1)
        )
        assert r.status_code == 201
        assert r.json()["type"] == "group"
        assert r.json()["name"] == "Test Group"
        assert len(r.json()["members"]) == 3

    def test_list_chats(self):
        tokens1 = create_user("list1@example.com")
        tokens2 = create_user("list2@example.com")

        me2 = client.get("/auth/me", headers=auth_header(tokens2)).json()

        # Create a chat
        client.post(
            "/api/chats",
            json={"type": "direct", "member_ids": [me2["id"]]},
            headers=auth_header(tokens1)
        )

        # List chats
        r = client.get("/api/chats", headers=auth_header(tokens1))
        assert r.status_code == 200
        assert r.json()["total"] >= 1

    def test_get_chat(self):
        tokens1 = create_user("get1@example.com")
        tokens2 = create_user("get2@example.com")

        me2 = client.get("/auth/me", headers=auth_header(tokens2)).json()

        chat = client.post(
            "/api/chats",
            json={"type": "direct", "member_ids": [me2["id"]]},
            headers=auth_header(tokens1)
        ).json()

        r = client.get(f"/api/chats/{chat['id']}", headers=auth_header(tokens1))
        assert r.status_code == 200
        assert r.json()["id"] == chat["id"]

    def test_non_member_cannot_access_chat(self):
        tokens1 = create_user("access1@example.com")
        tokens2 = create_user("access2@example.com")
        tokens3 = create_user("access3@example.com")

        me2 = client.get("/auth/me", headers=auth_header(tokens2)).json()

        chat = client.post(
            "/api/chats",
            json={"type": "direct", "member_ids": [me2["id"]]},
            headers=auth_header(tokens1)
        ).json()

        # User3 tries to access
        r = client.get(f"/api/chats/{chat['id']}", headers=auth_header(tokens3))
        assert r.status_code == 403


# Message tests
class TestMessages:
    def test_send_message(self):
        tokens1 = create_user("msg1@example.com")
        tokens2 = create_user("msg2@example.com")

        me2 = client.get("/auth/me", headers=auth_header(tokens2)).json()

        chat = client.post(
            "/api/chats",
            json={"type": "direct", "member_ids": [me2["id"]]},
            headers=auth_header(tokens1)
        ).json()

        r = client.post(
            f"/api/chats/{chat['id']}/messages",
            json={"content": "Hello, World!"},
            headers=auth_header(tokens1)
        )
        assert r.status_code == 201
        assert r.json()["content"] == "Hello, World!"

    def test_get_messages(self):
        tokens1 = create_user("getmsg1@example.com")
        tokens2 = create_user("getmsg2@example.com")

        me2 = client.get("/auth/me", headers=auth_header(tokens2)).json()

        chat = client.post(
            "/api/chats",
            json={"type": "direct", "member_ids": [me2["id"]]},
            headers=auth_header(tokens1)
        ).json()

        # Send some messages
        client.post(
            f"/api/chats/{chat['id']}/messages",
            json={"content": "Message 1"},
            headers=auth_header(tokens1)
        )
        client.post(
            f"/api/chats/{chat['id']}/messages",
            json={"content": "Message 2"},
            headers=auth_header(tokens1)
        )

        r = client.get(f"/api/chats/{chat['id']}/messages", headers=auth_header(tokens1))
        assert r.status_code == 200
        assert len(r.json()["messages"]) == 2

    def test_edit_message(self):
        tokens1 = create_user("edit1@example.com")
        tokens2 = create_user("edit2@example.com")

        me2 = client.get("/auth/me", headers=auth_header(tokens2)).json()

        chat = client.post(
            "/api/chats",
            json={"type": "direct", "member_ids": [me2["id"]]},
            headers=auth_header(tokens1)
        ).json()

        msg = client.post(
            f"/api/chats/{chat['id']}/messages",
            json={"content": "Original"},
            headers=auth_header(tokens1)
        ).json()

        r = client.put(
            f"/api/messages/{msg['id']}",
            json={"content": "Edited"},
            headers=auth_header(tokens1)
        )
        assert r.status_code == 200
        assert r.json()["content"] == "Edited"
        assert r.json()["is_edited"] is True

    def test_delete_message(self):
        tokens1 = create_user("del1@example.com")
        tokens2 = create_user("del2@example.com")

        me2 = client.get("/auth/me", headers=auth_header(tokens2)).json()

        chat = client.post(
            "/api/chats",
            json={"type": "direct", "member_ids": [me2["id"]]},
            headers=auth_header(tokens1)
        ).json()

        msg = client.post(
            f"/api/chats/{chat['id']}/messages",
            json={"content": "To delete"},
            headers=auth_header(tokens1)
        ).json()

        r = client.delete(f"/api/messages/{msg['id']}", headers=auth_header(tokens1))
        assert r.status_code == 204

    def test_cannot_edit_others_message(self):
        tokens1 = create_user("noEdit1@example.com")
        tokens2 = create_user("noEdit2@example.com")

        me2 = client.get("/auth/me", headers=auth_header(tokens2)).json()

        chat = client.post(
            "/api/chats",
            json={"type": "direct", "member_ids": [me2["id"]]},
            headers=auth_header(tokens1)
        ).json()

        msg = client.post(
            f"/api/chats/{chat['id']}/messages",
            json={"content": "Original"},
            headers=auth_header(tokens1)
        ).json()

        # User2 tries to edit user1's message
        r = client.put(
            f"/api/messages/{msg['id']}",
            json={"content": "Hacked"},
            headers=auth_header(tokens2)
        )
        assert r.status_code == 403


# Search tests
class TestSearch:
    def test_search_messages(self):
        tokens1 = create_user("search1@example.com")
        tokens2 = create_user("search2@example.com")

        me2 = client.get("/auth/me", headers=auth_header(tokens2)).json()

        chat = client.post(
            "/api/chats",
            json={"type": "direct", "member_ids": [me2["id"]]},
            headers=auth_header(tokens1)
        ).json()

        client.post(
            f"/api/chats/{chat['id']}/messages",
            json={"content": "Find this unique message"},
            headers=auth_header(tokens1)
        )

        r = client.get(
            "/api/messages/search?q=unique",
            headers=auth_header(tokens1)
        )
        assert r.status_code == 200
        assert len(r.json()["messages"]) >= 1


# Group chat member management
class TestGroupMembers:
    def test_add_member_to_group(self):
        tokens1 = create_user("admin@example.com")
        tokens2 = create_user("member1@example.com")
        tokens3 = create_user("member2@example.com")

        me2 = client.get("/auth/me", headers=auth_header(tokens2)).json()
        me3 = client.get("/auth/me", headers=auth_header(tokens3)).json()

        chat = client.post(
            "/api/chats",
            json={"type": "group", "name": "Test", "member_ids": [me2["id"]]},
            headers=auth_header(tokens1)
        ).json()

        r = client.post(
            f"/api/chats/{chat['id']}/members",
            json={"user_ids": [me3["id"]]},
            headers=auth_header(tokens1)
        )
        assert r.status_code == 200
        assert len(r.json()) == 3

    def test_remove_member_from_group(self):
        tokens1 = create_user("remAdmin@example.com")
        tokens2 = create_user("remMember@example.com")

        me2 = client.get("/auth/me", headers=auth_header(tokens2)).json()

        chat = client.post(
            "/api/chats",
            json={"type": "group", "name": "Test", "member_ids": [me2["id"]]},
            headers=auth_header(tokens1)
        ).json()

        r = client.delete(
            f"/api/chats/{chat['id']}/members/{me2['id']}",
            headers=auth_header(tokens1)
        )
        assert r.status_code == 204

    def test_non_admin_cannot_add_members(self):
        tokens1 = create_user("nonAdmin1@example.com")
        tokens2 = create_user("nonAdmin2@example.com")
        tokens3 = create_user("nonAdmin3@example.com")

        me2 = client.get("/auth/me", headers=auth_header(tokens2)).json()
        me3 = client.get("/auth/me", headers=auth_header(tokens3)).json()

        chat = client.post(
            "/api/chats",
            json={"type": "group", "name": "Test", "member_ids": [me2["id"]]},
            headers=auth_header(tokens1)
        ).json()

        # Non-admin tries to add member
        r = client.post(
            f"/api/chats/{chat['id']}/members",
            json={"user_ids": [me3["id"]]},
            headers=auth_header(tokens2)
        )
        assert r.status_code == 403
