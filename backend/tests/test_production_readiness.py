import pytest
from pydantic import ValidationError
from sqlalchemy.engine import make_url

from app.core.config import Settings
from app.core.email import EmailService


def production_settings(**overrides):
    values = {
        "ENVIRONMENT": "production",
        "DATABASE_URL": "",
        "SECRET_KEY": "generated-production-signing-key-with-entropy",
        "POSTGRES_SERVER": "db.example.com",
        "POSTGRES_USER": "ops",
        "POSTGRES_PASSWORD": "p@ss:/%#word-with-strong-length",
        "POSTGRES_DB": "ops",
        "BACKEND_CORS_ORIGINS": [],
        "REDIS_PASSWORD": "redis-secret-with-more-entropy",
        "GRAPH_TENANT_ID": "tenant-id",
        "GRAPH_CLIENT_ID": "client-id",
        "GRAPH_CLIENT_SECRET": "graph-client-secret",
        "GRAPH_SENDER_EMAIL": "ops@example.com",
        "FRONTEND_URL": "https://ops.example.com",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def test_database_url_encodes_postgres_password():
    settings = production_settings()

    database_url = make_url(settings.DATABASE_URL)
    assert database_url.password == "p@ss:/%#word-with-strong-length"
    assert "%40" in settings.DATABASE_URL


@pytest.mark.parametrize(
    ("override", "value"),
    [
        ("SECRET_KEY", "your-secret-key-here-min-32-chars"),
        ("DEBUG", True),
        ("FRONTEND_URL", "http://ops.example.com"),
        ("FRONTEND_URL", "https://localhost"),
        ("POSTGRES_PASSWORD", "postgres"),
        ("REDIS_PASSWORD", ""),
        ("REDIS_PASSWORD", "short"),
        ("GRAPH_TENANT_ID", ""),
        ("GRAPH_CLIENT_ID", ""),
        ("GRAPH_CLIENT_SECRET", ""),
        ("GRAPH_SENDER_EMAIL", ""),
        ("BACKEND_CORS_ORIGINS", ["*"]),
        ("BACKEND_CORS_ORIGINS", ["http://ops.example.com"]),
        ("BACKEND_CORS_ORIGINS", ["https://localhost"]),
    ],
)
def test_rejects_insecure_production_configuration(override, value):
    with pytest.raises(ValidationError):
        production_settings(**{override: value})


@pytest.mark.asyncio
async def test_unconfigured_welcome_email_does_not_log_credentials(caplog):
    service = EmailService()
    service.graph_tenant_id = ""
    service.graph_client_id = ""
    service.graph_client_secret = ""
    service.graph_sender_email = ""
    temporary_password = "one-time-secret-password"
    recipient = "private.user@example.com"

    await service.send_welcome_email(
        recipient,
        "Private User",
        temporary_password,
    )

    assert temporary_password not in caplog.text
    assert recipient not in caplog.text


@pytest.mark.asyncio
async def test_graph_email_requests_token_and_sends_message(monkeypatch):
    import json

    import httpx

    requests = []

    async def handle_request(request):
        requests.append(request)
        if request.url.host == "login.microsoftonline.com":
            return httpx.Response(
                200,
                json={"access_token": "test-access-token", "expires_in": 3600},
            )
        return httpx.Response(202)

    transport = httpx.MockTransport(handle_request)
    real_async_client = httpx.AsyncClient
    monkeypatch.setattr(
        "app.core.email.httpx.AsyncClient",
        lambda **kwargs: real_async_client(transport=transport, **kwargs),
    )

    service = EmailService()
    service.graph_tenant_id = "tenant-id"
    service.graph_client_id = "client-id"
    service.graph_client_secret = "graph-secret"
    service.graph_sender_email = "ops@example.com"

    sent = await service.send_email(
        "recipient@example.com",
        "Subject",
        "<p>Hello</p>",
        "Hello",
    )

    assert sent is True
    assert len(requests) == 2
    assert requests[0].url.path.endswith("/oauth2/v2.0/token")
    assert requests[1].url.host == "graph.microsoft.com"
    assert requests[1].headers["Authorization"] == "Bearer test-access-token"
    message = json.loads(requests[1].content)["message"]
    assert message["body"] == {"contentType": "HTML", "content": "<p>Hello</p>"}
    assert message["toRecipients"] == [
        {"emailAddress": {"address": "recipient@example.com"}}
    ]
