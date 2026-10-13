#!/usr/bin/env python3
"""
=============================================================================
  OPS PLATFORM — PRESENTATION DEMO SEED SCRIPT
=============================================================================
  Populates the database with realistic enterprise training data for demos:
    • 4 Managers + 6 Coordinators + 6 Faculty members
    • 25 Batches across multiple clients, domains, statuses & cities
    • 80+ Training Sessions with realistic schedules
    • 80+ Faculty Utilization records with feedback ratings
    • NPS scores and finance status on completed batches

  USAGE (inside the backend container):
    docker exec -it ops_backend python scripts/seed_demo.py

  OR via WSL from project root:
    wsl -d Debian -- bash -c "docker exec ops_backend python scripts/seed_demo.py"

  SAFE TO RE-RUN: Checks for existing data before inserting.
=============================================================================
"""

import sys
import os
import uuid
import random
from datetime import datetime, timezone, timedelta, date, time
from decimal import Decimal

# ── Path setup ────────────────────────────────────────────────────────────────
sys.path.insert(0, "/app")

from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.core.config import settings
from app.models.user import User, Role, Team, UserManagerMapping
from app.models.batch import (
    Batch, BatchCategory, DeliveryMode, Accommodation, Entity, ApprovalConfiguration
)
from app.models.session import TrainingSession, FacultyUtilization

# ── Helpers ───────────────────────────────────────────────────────────────────

def uid():
    return uuid.uuid4()

def utc_dt(d: date, hour: int = 9) -> datetime:
    return datetime(d.year, d.month, d.day, hour, 0, 0, tzinfo=timezone.utc)

def past_date(days_ago: int) -> date:
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).date()

def future_date(days_ahead: int) -> date:
    return (datetime.now(timezone.utc) + timedelta(days=days_ahead)).date()

def rnd_feedback() -> Decimal:
    return Decimal(str(round(random.uniform(3.5, 5.0), 2)))

def rnd_nps() -> Decimal:
    return Decimal(str(round(random.uniform(30, 85), 1)))

def week_days_between(start: date, end: date):
    """Return all weekdays (Mon-Fri) between two dates inclusive."""
    result = []
    current = start
    while current <= end:
        if current.weekday() < 5:
            result.append(current)
        current += timedelta(days=1)
    return result

# Use strong password from environment or generate one
DEMO_PASSWORD = os.getenv("DEMO_PASSWORD") or "Demo@SecurePass2024!"

# ── Seed Data Definitions ─────────────────────────────────────────────────────

MANAGERS = [
    {"full_name": "Rajesh Kumar",     "email": "rajesh.kumar@enterprise.com"},
    {"full_name": "Priya Sharma",     "email": "priya.sharma@enterprise.com"},
    {"full_name": "Anand Mehta",      "email": "anand.mehta@enterprise.com"},
    {"full_name": "Sunita Verma",     "email": "sunita.verma@enterprise.com"},
]

COORDINATORS = [
    {"full_name": "Aditya Nair",      "email": "aditya.nair@enterprise.com"},
    {"full_name": "Deepika Rao",      "email": "deepika.rao@enterprise.com"},
    {"full_name": "Karthik Subbu",    "email": "karthik.subbu@enterprise.com"},
    {"full_name": "Neha Joshi",       "email": "neha.joshi@enterprise.com"},
    {"full_name": "Suresh Pillai",    "email": "suresh.pillai@enterprise.com"},
    {"full_name": "Meera Iyer",       "email": "meera.iyer@enterprise.com"},
]

FACULTY = [
    {"full_name": "Dr. Vikram Bose",  "email": "vikram.bose@faculty.com",    "domain": "IT/ITES"},
    {"full_name": "Sneha Patel",      "email": "sneha.patel@faculty.com",    "domain": "DS/ML"},
    {"full_name": "Rohan Dutta",      "email": "rohan.dutta@faculty.com",    "domain": "Cloud"},
    {"full_name": "Anjali Krishnan",  "email": "anjali.krishnan@faculty.com","domain": "BFSI"},
    {"full_name": "Mohan Reddy",      "email": "mohan.reddy@faculty.com",    "domain": "IT/ITES"},
    {"full_name": "Kavya Menon",      "email": "kavya.menon@faculty.com",    "domain": "CyberSecurity"},
]

# (client, domain, technology, category, mode, city, status, start_offset, duration_days, enrollments, hours)
BATCH_TEMPLATES = [
    # ── COMPLETED ──
    ("Infosys Ltd",        "IT/ITES",       "Java FullStack",    "Bootcamp",  "F2F",     "Bengaluru",  "Completed", -90, 30, 45, 120),
    ("Wipro Technologies", "DS/ML",         "PySpark & Scala",   "Bootcamp",  "Online",  "Remote",     "Completed", -80, 25, 38, 100),
    ("TCS Digital",        "Cloud",         "AWS Cloud Arch",    "RBT",       "Blended", "Hyderabad",  "Completed", -70, 20, 50, 80),
    ("HCL Technologies",   "BFSI",          "Core Banking APIs", "Workshop",  "F2F",     "Mumbai",     "Completed", -60, 15, 28, 60),
    ("Accenture India",    "IT/ITES",       "React & Node.js",   "Bootcamp",  "Online",  "Remote",     "Completed", -55, 22, 42, 88),
    ("Cognizant",          "CyberSecurity", "SIEM & SOC Ops",    "Workshop",  "F2F",     "Chennai",    "Completed", -45, 10, 20, 40),
    ("Capgemini",          "DS/ML",         "ML Engineering",    "RBT",       "Online",  "Remote",     "Completed", -40, 18, 35, 72),

    # ── ONGOING ──
    ("Tech Mahindra",      "IT/ITES",       "Microservices",     "Bootcamp",  "Blended", "Pune",       "Ongoing",   -15, 30, 40, 120),
    ("Infosys Ltd",        "Cloud",         "Azure DevOps",      "Bootcamp",  "Online",  "Remote",     "Ongoing",   -10, 25, 32, 100),
    ("Wipro Technologies", "DS/ML",         "Deep Learning",     "PJP",       "Online",  "Remote",     "Ongoing",    -8, 20, 28, 80),
    ("HCL Technologies",   "IT/ITES",       "Python Advanced",   "RBT",       "F2F",     "Noida",      "Ongoing",    -5, 15, 22, 60),
    ("TCS Digital",        "BFSI",          "FinTech Analytics", "Workshop",  "Online",  "Remote",     "Ongoing",    -3, 10, 18, 40),

    # ── UPCOMING ──
    ("Accenture India",    "Cloud",         "GCP Professional",  "Bootcamp",  "Online",  "Remote",     "Upcoming",   7, 25, 36, 100),
    ("Cognizant",          "IT/ITES",       "Kotlin Android",    "Bootcamp",  "F2F",     "Bengaluru",  "Upcoming",  10, 20, 30, 80),
    ("Capgemini",          "DS/ML",         "NLP & GenAI",       "PJP",       "Online",  "Remote",     "Upcoming",  14, 18, 25, 72),
    ("Tech Mahindra",      "CyberSecurity", "Ethical Hacking",   "Workshop",  "F2F",     "Hyderabad",  "Upcoming",  21, 10, 20, 40),

    # ── APPROVED ──
    ("Infosys Ltd",        "BFSI",          "RPA & Automation",  "Bootcamp",  "Blended", "Chennai",    "Approved",  30, 22, 40, 88),
    ("HCL Technologies",   "Cloud",         "Kubernetes & K8s",  "RBT",       "Online",  "Remote",     "Approved",  35, 20, 35, 80),

    # ── APPROVAL PENDING ──
    ("Wipro Technologies", "IT/ITES",       "Data Engineering",  "Bootcamp",  "Online",  "Remote",     "Approval 1 Pending", 45, 25, 42, 100),
    ("TCS Digital",        "DS/ML",         "Databricks + Spark","Bootcamp",  "F2F",     "Bengaluru",  "Approval 2 Pending", 50, 30, 48, 120),

    # ── REQUESTED ──
    ("Accenture India",    "IT/ITES",       "Golang Microsvcs",  "Bootcamp",  "Online",  "Remote",     "Requested", 60, 20, 30, 80),
    ("Cognizant",          "Cloud",         "Multi-Cloud Arch",  "Workshop",  "Blended", "Pune",       "Requested", 65, 15, 25, 60),

    # ── ON HOLD ──
    ("Capgemini",          "BFSI",          "Risk & Compliance", "Workshop",  "F2F",     "Mumbai",     "OnHold",    40, 10, 20, 40),
]

MODULES = {
    "IT/ITES":       ["Fundamentals & Setup", "Core Language Deep Dive", "OOP & Design Patterns", "Web Frameworks", "API Design & REST", "Database Integration", "Testing & QA", "CI/CD & DevOps", "Security Best Practices", "Capstone Project"],
    "DS/ML":         ["Data Exploration & EDA", "Statistical Foundations", "Feature Engineering", "ML Algorithms", "Model Training & Tuning", "Deep Learning Basics", "NLP Fundamentals", "Model Deployment", "MLOps & Monitoring", "Capstone Project"],
    "Cloud":         ["Cloud Fundamentals", "Compute & Networking", "Storage Solutions", "IAM & Security", "Managed Services", "Containerization", "Orchestration", "Monitoring & Logging", "Cost Optimization", "Architecture Review"],
    "BFSI":          ["Financial Markets Overview", "Core Banking Systems", "Risk Management", "Regulatory Compliance", "Payment Systems", "Fraud Detection", "API Integration", "Data Analytics in BFSI", "Capstone Workshop"],
    "CyberSecurity": ["Threat Landscape", "Network Security", "Vulnerability Assessment", "Penetration Testing", "SIEM Tools", "Incident Response", "Cloud Security", "Compliance & Governance", "Red Team Exercises"],
}


def main():
    db = SessionLocal()
    print("\n" + "="*60)
    print("  OPS PLATFORM — DEMO SEED SCRIPT")
    print("="*60)

    try:
        # ── 1. Fetch existing taxonomy ────────────────────────────────
        print("\n[1/6] Loading taxonomy options...")
        category_map = {c.name: c for c in db.query(BatchCategory).all()}
        mode_map     = {m.name: m for m in db.query(DeliveryMode).all()}
        entity_obj   = db.query(Entity).filter(Entity.name == "Unext").first()
        manager_role   = db.query(Role).filter(Role.system_role == "Manager").first()
        coord_role     = db.query(Role).filter(Role.system_role == "Coordinator").first()
        faculty_role   = db.query(Role).filter(Role.system_role == "Faculty").first()
        delivery_team  = db.query(Team).filter(Team.name == "Delivery").first()

        if not manager_role or not coord_role or not faculty_role:
            print("ERROR: Roles not found. Run the app once to seed base roles first.")
            return

        # ── 2. Create users ───────────────────────────────────────────
        print("[2/6] Creating managers, coordinators & faculty...")
        password = get_password_hash(DEMO_PASSWORD)

        def get_or_create_user(email, full_name, role_str, role_obj):
            u = db.query(User).filter(User.email == email).first()
            if not u:
                u = User(
                    id=uid(), email=email, full_name=full_name,
                    hashed_password=password, role=role_str,
                    role_id=role_obj.id if role_obj else None,
                    team_id=delivery_team.id if delivery_team else None,
                    is_active=True
                )
                db.add(u)
                db.flush()
                print(f"   ✓ Created {role_str}: {full_name}")
            return u

        mgrs   = [get_or_create_user(m["email"], m["full_name"], "Manager",     manager_role) for m in MANAGERS]
        coords = [get_or_create_user(c["email"], c["full_name"], "Coordinator", coord_role)   for c in COORDINATORS]
        facs   = [get_or_create_user(f["email"], f["full_name"], "Faculty",     faculty_role) for f in FACULTY]

        # Assign coordinators to managers
        for i, coord in enumerate(coords):
            mgr = mgrs[i % len(mgrs)]
            coord.manager_id = mgr.id
            exists = db.query(UserManagerMapping).filter(
                UserManagerMapping.coordinator_id == coord.id,
                UserManagerMapping.manager_id == mgr.id
            ).first()
            if not exists:
                db.add(UserManagerMapping(id=uid(), coordinator_id=coord.id, manager_id=mgr.id))

        db.flush()

        # ── 3. Create batches ─────────────────────────────────────────
        print("\n[3/6] Creating batches...")
        batch_counter = 1
        created_batches = []

        for (client, domain, tech, cat, mode, city, status,
             start_offset, dur_days, enroll, hours) in BATCH_TEMPLATES:

            batch_id_str = f"DTA_{tech.replace(' ','').replace('&','').replace('+','')[:8].upper()}_{batch_counter:03d}"

            exists = db.query(Batch).filter(Batch.batch_id == batch_id_str).first()
            if exists:
                print(f"   ~ Batch {batch_id_str} already exists, skipping.")
                created_batches.append(exists)
                batch_counter += 1
                continue

            mgr   = mgrs[batch_counter % len(mgrs)]
            coord = coords[batch_counter % len(coords)]
            fac   = facs[batch_counter % len(facs)]
            fac_name = next(f["full_name"] for f in FACULTY if f["email"] == fac.email)

            # Dates
            if status in ("Completed", "Ongoing"):
                start = past_date(abs(start_offset))
                end   = start + timedelta(days=dur_days)
            elif status in ("OnHold",):
                start = future_date(abs(start_offset) - 10)
                end   = start + timedelta(days=dur_days)
            else:
                start = future_date(abs(start_offset))
                end   = start + timedelta(days=dur_days)

            sow = f"SOW-{random.randint(1000,9999)}"
            approval_id = f"APR-{random.randint(100,999)}"

            # Finance & NPS for completed batches
            fin_status = "Cleared" if status == "Completed" else "Pending"
            fin_check_date = start + timedelta(days=dur_days + 10) if status == "Completed" else None
            avg_fb = rnd_feedback() if status == "Completed" else None
            batch_nps = rnd_nps() if status == "Completed" else None
            nps_total = random.randint(20, enroll) if status == "Completed" else None
            nps_promoters = int(nps_total * random.uniform(0.5, 0.75)) if nps_total else None
            nps_detractors = int(nps_total * random.uniform(0.05, 0.15)) if nps_total else None
            nps_passives = (nps_total - nps_promoters - nps_detractors) if nps_total else None

            training_days = max(1, len(week_days_between(start, end)))
            cat_obj  = category_map.get(cat)
            mode_obj = mode_map.get(mode)

            batch = Batch(
                id=uid(),
                batch_id=batch_id_str,
                sow_number=sow,
                approval_id=approval_id,
                category=cat,
                category_id=cat_obj.id if cat_obj else None,
                delivery_mode_id=mode_obj.id if mode_obj else None,
                entity_id=entity_obj.id if entity_obj else None,
                program_name=f"{tech} Training Program",
                technology=tech,
                domain=domain,
                client_name=client,
                location_city=city,
                start_date=utc_dt(start),
                end_date=utc_dt(end),
                training_days=training_days,
                calendar_days=dur_days,
                total_hours=Decimal(str(hours)),
                total_enrollments=enroll,
                status=status,
                is_schema_locked=(status in ("Completed", "Ongoing", "Upcoming", "Approved")),
                primary_manager_id=mgr.id,
                coordinator_id=coord.id,
                faculty_assigned_text=fac_name,
                finance_status=fin_status,
                finance_status_check_date=fin_check_date,
                batch_avg_feedback=avg_fb,
                batch_nps=batch_nps,
                nps_total_responses=nps_total,
                nps_promoters=nps_promoters,
                nps_passives=nps_passives,
                nps_detractors=nps_detractors,
                approver_1_id=mgrs[0].id,
                approver_2_id=mgrs[1].id,
                approver_1_status="Approved" if status not in ("Requested", "Approval 1 Pending") else "Pending",
                approver_2_status="Approved" if status not in ("Requested", "Approval 1 Pending", "Approval 2 Pending") else "Pending",
                remarks=f"Demo batch for {client} — {tech}. Created for presentation purposes." if status == "Completed" else None,
            )
            db.add(batch)
            db.flush()
            created_batches.append(batch)
            print(f"   ✓ Batch {batch_id_str}: {client} | {tech} | {status}")
            batch_counter += 1

        db.flush()

        # ── 4. Training Sessions ─────────────────────────────────────
        print("\n[4/6] Creating training sessions...")
        session_count = 0

        for batch in created_batches:
            # Only create sessions for batches with real dates and relevant statuses
            if batch.status in ("Requested", "Approval 1 Pending", "Approval 2 Pending"):
                continue
            if not batch.start_date or not batch.end_date:
                continue

            existing = db.query(TrainingSession).filter(TrainingSession.batch_id == batch.id).count()
            if existing > 0:
                print(f"   ~ Sessions already exist for {batch.batch_id}, skipping.")
                continue

            domain = batch.domain or "IT/ITES"
            mods = MODULES.get(domain, MODULES["IT/ITES"])
            start_d = batch.start_date.date()
            end_d   = batch.end_date.date()
            weekdays = week_days_between(start_d, end_d)

            # Chunk days into sessions (1-2 days per module topic)
            session_dates = weekdays[:min(len(weekdays), 20)]  # cap at 20 sessions

            for seq, sess_date in enumerate(session_dates, 1):
                module = mods[seq % len(mods)]

                # Determine status based on batch status and date
                today = date.today()
                if batch.status == "Completed":
                    sess_status = "Completed"
                elif batch.status == "Ongoing":
                    if sess_date <= today:
                        sess_status = "Completed"
                    else:
                        sess_status = "Scheduled"
                else:
                    sess_status = "Scheduled"

                ts = TrainingSession(
                    id=uid(),
                    batch_id=batch.id,
                    session_date=sess_date,
                    day_name=sess_date.strftime("%A"),
                    start_time=time(9, 0),
                    end_time=time(17, 0),
                    duration_hours=Decimal("8.0"),
                    module=module,
                    trainer_name=batch.faculty_assigned_text,
                    status=sess_status,
                )
                db.add(ts)
                session_count += 1

            if session_count % 20 == 0:
                db.flush()

        db.flush()
        print(f"   ✓ Created {session_count} training sessions")

        # ── 5. Faculty Utilization ────────────────────────────────────
        print("\n[5/6] Creating faculty utilization records...")
        util_count = 0

        # Reload sessions
        all_sessions = db.query(TrainingSession).all()
        session_by_batch = {}
        for s in all_sessions:
            session_by_batch.setdefault(str(s.batch_id), []).append(s)

        for batch in created_batches:
            if batch.status in ("Requested", "Approval 1 Pending", "Approval 2 Pending", "OnHold"):
                continue

            existing_util = db.query(FacultyUtilization).filter(FacultyUtilization.batch_id == batch.id).count()
            if existing_util > 0:
                print(f"   ~ Utilization already exists for {batch.batch_id}, skipping.")
                continue

            sessions = session_by_batch.get(str(batch.id), [])
            fac_name = batch.faculty_assigned_text or FACULTY[0]["full_name"]
            domain = batch.domain or "IT/ITES"
            mode = "Online"
            if batch.delivery_mode_id:
                for m_name, m_obj in mode_map.items():
                    if m_obj.id == batch.delivery_mode_id:
                        mode = m_name
                        break

            for sess in sessions:
                today = date.today()
                sess_d = sess.session_date

                if batch.status == "Completed":
                    util_status = "Completed"
                    fb_submitted = True
                    fb_rating = rnd_feedback()
                elif batch.status == "Ongoing":
                    if sess_d <= today:
                        util_status = "Completed"
                        fb_submitted = True
                        fb_rating = rnd_feedback()
                    else:
                        util_status = "Scheduled"
                        fb_submitted = False
                        fb_rating = None
                else:
                    util_status = "Scheduled"
                    fb_submitted = False
                    fb_rating = None

                fu = FacultyUtilization(
                    id=uid(),
                    batch_id=batch.id,
                    training_session_id=sess.id,
                    faculty_name=fac_name,
                    date_of_training=utc_dt(sess_d, 9),
                    start_time=time(9, 0),
                    end_time=time(17, 0),
                    topic=sess.module,
                    no_of_hours=Decimal("8.0"),
                    venue="Virtual Classroom" if mode == "Online" else f"{batch.location_city} Training Center",
                    location_city=batch.location_city or "Remote",
                    mode_of_delivery=mode,
                    status=util_status,
                    feedback_submitted=fb_submitted,
                    feedback_rating=fb_rating,
                    feedback_notes=f"Session delivered successfully. {sess.module} covered comprehensively." if fb_submitted else None,
                )
                db.add(fu)
                util_count += 1

            if util_count % 30 == 0:
                db.flush()

        db.flush()
        print(f"   ✓ Created {util_count} faculty utilization records")

        # ── 6. Commit ─────────────────────────────────────────────────
        print("\n[6/6] Committing all data to database...")
        db.commit()

        # ── Summary ───────────────────────────────────────────────────
        total_batches = db.query(Batch).count()
        total_sessions = db.query(TrainingSession).count()
        total_utils = db.query(FacultyUtilization).count()
        total_users = db.query(User).count()

        print("\n" + "="*60)
        print("  ✅  SEED COMPLETE — DATABASE SUMMARY")
        print("="*60)
        print(f"  Users           : {total_users}")
        print(f"  Batches         : {total_batches}")
        print(f"  Training Sessions: {total_sessions}")
        print(f"  Faculty Utilization: {total_utils}")
        print("="*60)
        print("\n  Credentials for all demo users: Demo@1234")
        print("  Admin user:  Check your existing admin account.")
        print("="*60 + "\n")

    except Exception as e:
        db.rollback()
        print(f"\n❌  ERROR: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()


if __name__ == "__main__":
    main()
