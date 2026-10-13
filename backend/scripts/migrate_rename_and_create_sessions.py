import sys
from sqlalchemy import text
from app.core.database import engine

def run_migration():
    print("Starting database migration: Renaming training_sessions to faculty_utilization and creating new training_sessions table...")
    with engine.begin() as conn:
        # 1. Check existing tables in public schema
        result = conn.execute(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public';"))
        tables = [row[0] for row in result.fetchall()]
        print("Existing tables:", tables)

        # 2. Rename existing training_sessions table to faculty_utilization if not already renamed
        if "training_sessions" in tables and "faculty_utilization" not in tables:
            print("Renaming table training_sessions -> faculty_utilization...")
            conn.execute(text("ALTER TABLE training_sessions RENAME TO faculty_utilization;"))
            # Rename primary key and indexes if standard
            conn.execute(text("ALTER TABLE faculty_utilization RENAME CONSTRAINT training_sessions_pkey TO faculty_utilization_pkey;"))
            print("Renamed table to faculty_utilization.")
        elif "faculty_utilization" in tables:
            print("Table faculty_utilization already exists.")

        # 3. Create new streamlined training_sessions table
        print("Creating new training_sessions table...")
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS training_sessions (
                id UUID PRIMARY KEY,
                batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
                session_date DATE NOT NULL,
                day_name VARCHAR(20) NULL,
                start_time TIME NULL,
                end_time TIME NULL,
                duration_hours NUMERIC(5, 2) NOT NULL DEFAULT 8.0,
                module VARCHAR(255) NOT NULL,
                trainer_name VARCHAR(255) NULL,
                status VARCHAR(30) NOT NULL DEFAULT 'Scheduled',
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_training_sessions_batch_id ON training_sessions(batch_id);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_training_sessions_session_date ON training_sessions(session_date);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_training_sessions_trainer_name ON training_sessions(trainer_name);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_training_sessions_status ON training_sessions(status);"))
        print("Table training_sessions created with indexes.")

        # 4. Add training_session_id to faculty_utilization if not exists
        conn.execute(text("""
            ALTER TABLE faculty_utilization 
            ADD COLUMN IF NOT EXISTS training_session_id UUID REFERENCES training_sessions(id) ON DELETE SET NULL;
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_faculty_utilization_training_session_id ON faculty_utilization(training_session_id);"))
        print("Added training_session_id column to faculty_utilization.")

        # Verify final state
        result = conn.execute(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public';"))
        updated_tables = [row[0] for row in result.fetchall()]
        print("Updated tables:", updated_tables)
        print("Migration completed successfully!")

if __name__ == "__main__":
    run_migration()
