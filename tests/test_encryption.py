import pytest
from fastapi.testclient import TestClient

from tests.conftest import test_engine
from app.main import app

client = TestClient(app)


def create_user(email: str, password: str = "secret123"):
    """Helper to create and login a user"""
    client.post("/auth/register", json={"email": email, "password": password})
    response = client.post("/auth/login", json={"email": email, "password": password})
    return response.json()


def auth_header(tokens):
    """Helper to create auth header"""
    return {"Authorization": f"Bearer {tokens['access_token']}"}


class TestKeyRegistration:
    """Test encryption key registration and retrieval"""

    def test_register_public_key(self):
        """Test registering a new public key"""
        tokens = create_user("keyreg@example.com")

        r = client.post(
            "/api/keys/register",
            json={
                "public_key": "dGVzdF9wdWJsaWNfa2V5X2Jhc2U2NA==",  # base64 test key
                "signature_public_key": "dGVzdF9zaWduYXR1cmVfa2V5",
                "key_type": "identity"
            },
            headers=auth_header(tokens)
        )
        assert r.status_code == 201
        assert r.json()["key_type"] == "identity"
        assert r.json()["is_active"] is True
        assert r.json()["key_version"] == 1

    def test_register_second_key_deactivates_first(self):
        """Test that registering a new key deactivates the old one"""
        tokens = create_user("keyreg2@example.com")

        # Register first key
        r1 = client.post(
            "/api/keys/register",
            json={
                "public_key": "Zmlyc3Rfa2V5",
                "signature_public_key": "Zmlyc3Rfc2ln",
                "key_type": "identity"
            },
            headers=auth_header(tokens)
        )
        assert r1.status_code == 201
        assert r1.json()["key_version"] == 1

        # Register second key
        r2 = client.post(
            "/api/keys/register",
            json={
                "public_key": "c2Vjb25kX2tleQ==",
                "signature_public_key": "c2Vjb25kX3NpZw==",
                "key_type": "identity"
            },
            headers=auth_header(tokens)
        )
        assert r2.status_code == 201
        assert r2.json()["key_version"] == 2

    def test_get_my_keys(self):
        """Test retrieving own public keys"""
        tokens = create_user("mykeys@example.com")

        # Register a key
        client.post(
            "/api/keys/register",
            json={
                "public_key": "bXlfa2V5",
                "signature_public_key": "bXlfc2ln",
                "key_type": "identity"
            },
            headers=auth_header(tokens)
        )

        r = client.get("/api/keys/me", headers=auth_header(tokens))
        assert r.status_code == 200
        assert len(r.json()) >= 1

    def test_get_user_public_key(self):
        """Test retrieving another user's public key"""
        tokens1 = create_user("getkey1@example.com")
        tokens2 = create_user("getkey2@example.com")

        # User1 registers a key
        client.post(
            "/api/keys/register",
            json={
                "public_key": "dXNlcjFfa2V5",
                "signature_public_key": "dXNlcjFfc2ln",
                "key_type": "identity"
            },
            headers=auth_header(tokens1)
        )

        # Get user1's ID
        me1 = client.get("/auth/me", headers=auth_header(tokens1)).json()

        # User2 gets user1's public key
        r = client.get(
            f"/api/keys/user/{me1['id']}",
            headers=auth_header(tokens2)
        )
        assert r.status_code == 200
        assert r.json()["public_key"] == "dXNlcjFfa2V5"

    def test_get_nonexistent_user_key(self):
        """Test getting key for user without registered key"""
        tokens1 = create_user("nokey1@example.com")
        tokens2 = create_user("nokey2@example.com")

        me2 = client.get("/auth/me", headers=auth_header(tokens2)).json()

        # User1 tries to get user2's key (user2 hasn't registered one)
        r = client.get(
            f"/api/keys/user/{me2['id']}",
            headers=auth_header(tokens1)
        )
        assert r.status_code == 404


class TestKeyRotation:
    """Test key rotation functionality"""

    def test_rotate_session_key(self):
        """Test rotating session keys"""
        tokens = create_user("rotate@example.com")

        # Register identity key first
        client.post(
            "/api/keys/register",
            json={
                "public_key": "aWRlbnRpdHlfa2V5",
                "signature_public_key": "aWRlbnRpdHlfc2ln",
                "key_type": "identity"
            },
            headers=auth_header(tokens)
        )

        # Rotate session key
        r = client.post(
            "/api/keys/rotate",
            json={
                "new_public_key": "bmV3X3Nlc3Npb25fa2V5",
                "new_signature_public_key": "bmV3X3Nlc3Npb25fc2ln",
                "signature": "dGVzdF9zaWduYXR1cmU="
            },
            headers=auth_header(tokens)
        )
        assert r.status_code == 200
        assert r.json()["key_type"] == "session"


class TestKeyBackup:
    """Test encrypted key backup functionality"""

    def test_save_and_retrieve_backup(self):
        """Test saving and retrieving encrypted key backup"""
        tokens = create_user("backup@example.com")

        # Save backup
        r1 = client.post(
            "/api/keys/backup",
            json={
                "encrypted_blob": "ZW5jcnlwdGVkX3ByaXZhdGVfa2V5X2RhdGE=",
                "salt": "c2FsdF92YWx1ZQ=="
            },
            headers=auth_header(tokens)
        )
        assert r1.status_code == 201

        # Retrieve backup
        r2 = client.get("/api/keys/backup", headers=auth_header(tokens))
        assert r2.status_code == 200
        assert r2.json()["encrypted_blob"] == "ZW5jcnlwdGVkX3ByaXZhdGVfa2V5X2RhdGE="
        assert r2.json()["salt"] == "c2FsdF92YWx1ZQ=="

    def test_update_backup(self):
        """Test updating existing backup"""
        tokens = create_user("updatebackup@example.com")

        # Save initial backup
        client.post(
            "/api/keys/backup",
            json={
                "encrypted_blob": "b2xkX2RhdGE=",
                "salt": "b2xkX3NhbHQ="
            },
            headers=auth_header(tokens)
        )

        # Update backup
        client.post(
            "/api/keys/backup",
            json={
                "encrypted_blob": "bmV3X2RhdGE=",
                "salt": "bmV3X3NhbHQ="
            },
            headers=auth_header(tokens)
        )

        # Verify update
        r = client.get("/api/keys/backup", headers=auth_header(tokens))
        assert r.json()["encrypted_blob"] == "bmV3X2RhdGE="

    def test_get_backup_not_found(self):
        """Test getting backup when none exists"""
        tokens = create_user("nobackup@example.com")

        r = client.get("/api/keys/backup", headers=auth_header(tokens))
        assert r.status_code == 404


class TestChatEncryptionKeys:
    """Test chat encryption key management"""

    def test_set_chat_keys(self):
        """Test setting encryption keys for a group chat"""
        tokens1 = create_user("chatkey1@example.com")
        tokens2 = create_user("chatkey2@example.com")

        me1 = client.get("/auth/me", headers=auth_header(tokens1)).json()
        me2 = client.get("/auth/me", headers=auth_header(tokens2)).json()

        # Both users register public keys
        key1 = client.post(
            "/api/keys/register",
            json={
                "public_key": "dXNlcjFfa2V5",
                "signature_public_key": "dXNlcjFfc2ln",
                "key_type": "identity"
            },
            headers=auth_header(tokens1)
        ).json()

        key2 = client.post(
            "/api/keys/register",
            json={
                "public_key": "dXNlcjJfa2V5",
                "signature_public_key": "dXNlcjJfc2ln",
                "key_type": "identity"
            },
            headers=auth_header(tokens2)
        ).json()

        # Create group chat (user1 is admin)
        chat = client.post(
            "/api/chats",
            json={"type": "group", "name": "Encrypted Group", "member_ids": [me2["id"]]},
            headers=auth_header(tokens1)
        ).json()

        # Set chat encryption keys
        r = client.post(
            f"/api/keys/chat/{chat['id']}",
            json={
                "encrypted_keys": [
                    {
                        "user_id": me1["id"],
                        "encrypted_key": "ZW5jcnlwdGVkX2Zvcl91c2VyMQ==",
                        "user_key_id": key1["id"]
                    },
                    {
                        "user_id": me2["id"],
                        "encrypted_key": "ZW5jcnlwdGVkX2Zvcl91c2VyMg==",
                        "user_key_id": key2["id"]
                    }
                ]
            },
            headers=auth_header(tokens1)
        )
        assert r.status_code == 201
        assert r.json()["key_version"] == 1
        assert len(r.json()["keys"]) == 2

    def test_get_chat_key(self):
        """Test retrieving chat encryption key"""
        tokens1 = create_user("getchatkey1@example.com")
        tokens2 = create_user("getchatkey2@example.com")

        me1 = client.get("/auth/me", headers=auth_header(tokens1)).json()
        me2 = client.get("/auth/me", headers=auth_header(tokens2)).json()

        key1 = client.post(
            "/api/keys/register",
            json={
                "public_key": "a2V5MQ==",
                "signature_public_key": "c2lnMQ==",
                "key_type": "identity"
            },
            headers=auth_header(tokens1)
        ).json()

        key2 = client.post(
            "/api/keys/register",
            json={
                "public_key": "a2V5Mg==",
                "signature_public_key": "c2lnMg==",
                "key_type": "identity"
            },
            headers=auth_header(tokens2)
        ).json()

        chat = client.post(
            "/api/chats",
            json={"type": "group", "name": "Test", "member_ids": [me2["id"]]},
            headers=auth_header(tokens1)
        ).json()

        # Set keys
        client.post(
            f"/api/keys/chat/{chat['id']}",
            json={
                "encrypted_keys": [
                    {"user_id": me1["id"], "encrypted_key": "a2V5X2Zvcl8x", "user_key_id": key1["id"]},
                    {"user_id": me2["id"], "encrypted_key": "a2V5X2Zvcl8y", "user_key_id": key2["id"]}
                ]
            },
            headers=auth_header(tokens1)
        )

        # User2 gets their chat key
        r = client.get(f"/api/keys/chat/{chat['id']}", headers=auth_header(tokens2))
        assert r.status_code == 200
        assert r.json()["encrypted_key"] == "a2V5X2Zvcl8y"

    def test_non_admin_cannot_set_chat_keys(self):
        """Test that non-admin cannot set chat encryption keys"""
        tokens1 = create_user("nonadmin1@example.com")
        tokens2 = create_user("nonadmin2@example.com")

        me2 = client.get("/auth/me", headers=auth_header(tokens2)).json()

        key2 = client.post(
            "/api/keys/register",
            json={
                "public_key": "a2V5",
                "signature_public_key": "c2ln",
                "key_type": "identity"
            },
            headers=auth_header(tokens2)
        ).json()

        chat = client.post(
            "/api/chats",
            json={"type": "group", "name": "Test", "member_ids": [me2["id"]]},
            headers=auth_header(tokens1)
        ).json()

        # Non-admin tries to set keys
        r = client.post(
            f"/api/keys/chat/{chat['id']}",
            json={
                "encrypted_keys": [
                    {"user_id": me2["id"], "encrypted_key": "a2V5", "user_key_id": key2["id"]}
                ]
            },
            headers=auth_header(tokens2)
        )
        assert r.status_code == 403


class TestEncryptedMessages:
    """Test sending and receiving encrypted messages"""

    def test_send_encrypted_message(self):
        """Test sending an E2E encrypted message"""
        tokens1 = create_user("encmsg1@example.com")
        tokens2 = create_user("encmsg2@example.com")

        me2 = client.get("/auth/me", headers=auth_header(tokens2)).json()

        # Register keys
        key1 = client.post(
            "/api/keys/register",
            json={
                "public_key": "a2V5MQ==",
                "signature_public_key": "c2lnMQ==",
                "key_type": "identity"
            },
            headers=auth_header(tokens1)
        ).json()

        chat = client.post(
            "/api/chats",
            json={"type": "direct", "member_ids": [me2["id"]]},
            headers=auth_header(tokens1)
        ).json()

        # Send encrypted message
        r = client.post(
            f"/api/chats/{chat['id']}/messages",
            json={
                "content": None,
                "encrypted_content": "ZW5jcnlwdGVkX21lc3NhZ2VfY29udGVudA==",
                "encryption_version": 1,
                "sender_key_id": key1["id"],
                "ephemeral_public_key": "ZXBoZW1lcmFsX2tleQ=="
            },
            headers=auth_header(tokens1)
        )
        assert r.status_code == 201
        assert r.json()["encryption_version"] == 1
        assert r.json()["encrypted_content"] == "ZW5jcnlwdGVkX21lc3NhZ2VfY29udGVudA=="
        assert r.json()["ephemeral_public_key"] == "ZXBoZW1lcmFsX2tleQ=="

    def test_get_encrypted_messages(self):
        """Test retrieving encrypted messages includes encryption fields"""
        tokens1 = create_user("getenc1@example.com")
        tokens2 = create_user("getenc2@example.com")

        me2 = client.get("/auth/me", headers=auth_header(tokens2)).json()

        key1 = client.post(
            "/api/keys/register",
            json={
                "public_key": "a2V5",
                "signature_public_key": "c2ln",
                "key_type": "identity"
            },
            headers=auth_header(tokens1)
        ).json()

        chat = client.post(
            "/api/chats",
            json={"type": "direct", "member_ids": [me2["id"]]},
            headers=auth_header(tokens1)
        ).json()

        # Send encrypted message
        client.post(
            f"/api/chats/{chat['id']}/messages",
            json={
                "encrypted_content": "ZW5jcnlwdGVk",
                "encryption_version": 1,
                "sender_key_id": key1["id"]
            },
            headers=auth_header(tokens1)
        )

        # Get messages
        r = client.get(f"/api/chats/{chat['id']}/messages", headers=auth_header(tokens1))
        assert r.status_code == 200
        assert len(r.json()["messages"]) == 1
        msg = r.json()["messages"][0]
        assert msg["encryption_version"] == 1
        assert msg["encrypted_content"] == "ZW5jcnlwdGVk"


class TestUsernameSearch:
    """Test @username search functionality"""

    def test_search_by_at_username(self):
        """Test searching users by @username tag"""
        tokens1 = create_user("searcher@example.com")
        tokens2 = create_user("target@example.com")

        # Set username for user2
        client.put(
            "/api/users/me",
            json={"username": "uniquetarget"},
            headers=auth_header(tokens2)
        )

        # Search by @username
        r = client.get(
            "/api/users/search?q=@uniquetarget",
            headers=auth_header(tokens1)
        )
        assert r.status_code == 200
        assert r.json()["total"] == 1
        assert r.json()["users"][0]["username"] == "uniquetarget"

    def test_search_by_at_username_prefix(self):
        """Test @username search matches prefix"""
        tokens1 = create_user("prefixsearch@example.com")
        tokens2 = create_user("prefix2@example.com")

        client.put(
            "/api/users/me",
            json={"username": "testprefix123"},
            headers=auth_header(tokens2)
        )

        # Search with prefix
        r = client.get(
            "/api/users/search?q=@testpre",
            headers=auth_header(tokens1)
        )
        assert r.status_code == 200
        assert r.json()["total"] >= 1

    def test_search_by_at_empty(self):
        """Test @username search with just @ returns nothing"""
        tokens = create_user("emptyat@example.com")

        r = client.get(
            "/api/users/search?q=@",
            headers=auth_header(tokens)
        )
        assert r.status_code == 200
        assert r.json()["total"] == 0

    def test_regular_search_still_works(self):
        """Test that regular search (without @) still works"""
        tokens1 = create_user("regsearch@example.com")
        tokens2 = create_user("findbyemail@example.com")

        client.put(
            "/api/users/me",
            json={"display_name": "Find Me User"},
            headers=auth_header(tokens2)
        )

        # Search by display name
        r = client.get(
            "/api/users/search?q=Find Me",
            headers=auth_header(tokens1)
        )
        assert r.status_code == 200
        assert r.json()["total"] >= 1
