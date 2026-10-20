"""Create or update an administrator account.

Examples:
    python scripts/create_admin.py --email admin@example.com
    python scripts/create_admin.py --email admin@example.com --password-file .admin-password

The password is prompted securely when --password-file and ADMIN_PASSWORD are
not provided. Do not commit password files or place passwords in source code.
"""

import argparse
import getpass
import os
import sys
from pathlib import Path


# Allow this script to be run from backend/ without installing the app package.
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import text
from app.core.database import Base, SessionLocal, engine  # noqa: E402
from app.core.security import get_password_hash, validate_password_strength  # noqa: E402
from app.models.user import User, Role  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create or update an admin user")
    parser.add_argument(
        "--email",
        default=None,
        help="Admin email address (default: ADMIN_EMAIL or admin@enterprise-ops.com)",
    )
    parser.add_argument(
        "--full-name",
        default=os.getenv("ADMIN_FULL_NAME", "Operations System Administrator"),
        help="Admin display name",
    )
    parser.add_argument(
        "--password-file",
        type=Path,
        help="Read the password from a local file without echoing it",
    )
    parser.add_argument(
        "--if-not-exists",
        action="store_true",
        help="Create the admin only if it does not already exist; never change an existing account",
    )
    return parser.parse_args()


def read_password(password_file: Path | None, *, prompt: bool = True) -> str:
    if password_file:
        password = password_file.read_text(encoding="utf-8").strip()
    else:
        password = os.getenv("ADMIN_PASSWORD")
        if password is None:
            if not prompt:
                raise ValueError("ADMIN_PASSWORD is required to create the initial admin")
            password = getpass.getpass("Admin password: ")

    errors = validate_password_strength(password)
    if errors:
        raise ValueError(f"Admin password does not meet policy: {'; '.join(errors)}")
    return password


def main() -> int:
    args = parse_args()
    email = args.email or os.getenv("ADMIN_EMAIL") or "admin@enterprise-ops.com"

    if args.if_not_exists and not (args.email or os.getenv("ADMIN_EMAIL")):
        print("Error: ADMIN_EMAIL is required for deployment bootstrap", file=sys.stderr)
        return 2

    if "@" not in email or not email.strip():
        print("Error: provide a valid admin email address", file=sys.stderr)
        return 2

    Base.metadata.create_all(bind=engine)

    # Auto-add role_id, team_id, and manager_id columns to existing users table if not present
    try:
        with engine.connect() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES roles(id) ON DELETE SET NULL;"))
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL;"))
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES users(id) ON DELETE SET NULL;"))
            conn.commit()
    except Exception as e:
        print(f"Note: Column migration check returned: {e}")

    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.email == email.lower().strip()).first()
        if args.if_not_exists and admin is not None:
            print(f"Admin account already exists; leaving it unchanged: {admin.email}")
            return 0

        try:
            password = read_password(args.password_file, prompt=not args.if_not_exists)
        except (OSError, ValueError) as exc:
            print(f"Error: {exc}", file=sys.stderr)
            return 2

        # Ensure Admin role exists
        admin_role = db.query(Role).filter(Role.name == "Admin").first()
        if not admin_role:
            admin_role = Role(name="Admin", system_role="Admin", is_active=True)
            db.add(admin_role)
            db.flush()

        if admin is None:
            admin = User(email=email.lower().strip())
            db.add(admin)
            action = "Created"
        else:
            action = "Updated"

        admin.full_name = args.full_name.strip()
        admin.role = "Admin"
        admin.role_id = admin_role.id
        admin.is_active = True
        admin.hashed_password = get_password_hash(password)
        db.commit()
        print(f"{action} admin account: {admin.email}")
        return 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())