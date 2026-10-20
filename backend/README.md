# Backend setup

Run the commands below from the repository root unless stated otherwise.

## Start the database and backend

Copy the repository `.env.example` to `.env` and configure the required
production secrets and Microsoft Graph values before starting the default production
stack. For local development, set `ENVIRONMENT=development` and `DEBUG=True`
in `.env`.

```powershell
docker compose up -d db backend
```

The backend builds its PostgreSQL URL from `POSTGRES_SERVER`, `POSTGRES_PORT`,
`POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB`, safely encoding
credentials that contain URL-reserved characters.

If startup logs show `Permission denied` for `/root/.local/bin/uvicorn`,
rebuild the backend image so it uses the shared, non-root-readable virtual
environment:

```powershell
docker compose build --no-cache backend
docker compose up -d --force-recreate backend
docker compose logs --tail=100 backend
```

## Initialize or update the database

The backend creates tables and applies required schema columns automatically when it starts:

```powershell
docker compose restart backend
```

The retained Alembic script is only for importing the 2026 Excel batches. Run it
manually when that import is required.

## Populate default teams

The team seed is idempotent and synchronizes the default Delivery, Sales, and Finance teams:

```powershell
docker compose exec backend python scripts/seed_teams.py
```

## Create or update the administrator

Run the admin script after applying migrations. It prompts for the password securely:

```powershell
docker compose exec backend python scripts/create_admin.py --email admin@example.com
```

Optional administrator name:

```powershell
docker compose exec backend python scripts/create_admin.py `
  --email admin@enterprise-ops.com `
  --full-name "Operations System Administrator"
```

The script creates the account if it does not exist, or updates the existing account. Passwords must contain at least 8 characters.

For non-interactive environments, provide the password through an environment variable. Do not commit it to source control:

```powershell
$env:ADMIN_PASSWORD = "use-a-secure-password"
docker compose exec -e ADMIN_PASSWORD=$env:ADMIN_PASSWORD backend python scripts/create_admin.py --email admin@enterprise-ops.com
Remove-Item Env:ADMIN_PASSWORD
```

The script also accepts `ADMIN_EMAIL` and `ADMIN_FULL_NAME` environment variables.

## Populate default users

The default-user seed creates the Ravish manager hierarchy, assigns the Delivery
and Finance teams, and is safe to run again. Existing users keep their current
passwords. Set a temporary password for newly created users through the
environment:

```powershell
$env:DEFAULT_USER_PASSWORD = "use-a-secure-temporary-password"
docker compose exec -e DEFAULT_USER_PASSWORD=$env:DEFAULT_USER_PASSWORD backend python scripts/seed_default_users.py
Remove-Item Env:DEFAULT_USER_PASSWORD
```

## Recommended initialization order

```powershell
docker compose up -d db backend
docker compose exec backend alembic upgrade head
docker compose exec backend python scripts/seed_teams.py
$env:DEFAULT_USER_PASSWORD = "use-a-secure-temporary-password"
docker compose exec -e DEFAULT_USER_PASSWORD=$env:DEFAULT_USER_PASSWORD backend python scripts/seed_default_users.py
Remove-Item Env:DEFAULT_USER_PASSWORD
docker compose exec backend python scripts/create_admin.py --email admin@enterprise-ops.com
```

Create the Manager, Sales, and Coordinator users before running `alembic upgrade head`
if imported batch ownership should be linked automatically.

## Run commands without Docker

From the `backend` directory, with the virtual environment activated and PostgreSQL available:

```powershell
cd backend
python -m pip install -r requirements-dev.txt
alembic upgrade head
python scripts/seed_teams.py
python scripts/create_admin.py --email admin@enterprise-ops.com
```

For local execution, set `DATABASE_URL` to the PostgreSQL instance before running Alembic or either seed script.
