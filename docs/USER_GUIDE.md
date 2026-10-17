# Enterprise Operations Hub — User Guide

This guide explains how staff use the Operations Hub to request and approve
training batches, add timetables, record delivery and feedback, and review
operational reporting. It is written for coordinators, managers, approvers,
finance users, administrators, and people preparing a product walkthrough.

For system architecture and endpoint details, see the repository
[README](../README.md), [workflow reference](../WORKFLOWS_COMPLETE.md), and
[workflow documents](../workflows/). This guide describes the user-facing
application; permissions and available controls depend on the account
configuration.

## 1. What the system is for

The Operations Hub replaces disconnected batch and session tracking with one
workflow for:

1. **Batch lifecycle** — record a training engagement, route it for approval,
   track delivery status, and close it when delivery and quality steps are done.
2. **Schedule management** — upload a timetable for a batch or create schedule
   entries manually, then review and apply the entries.
3. **Faculty utilization and quality** — record the sessions that were
   delivered, capture session feedback, and make delivery status and hours
   visible to the teams responsible for operations.

The batch is the overall engagement (client, program, dates, ownership,
headcount, commercial reference). A session is one training delivery
appointment within that batch (date, time, topic, faculty, hours, status, and
feedback).

### System overview

| Component | Responsibility |
|---|---|
| Web application | Next.js/React interface used to manage batches, schedules, governance, and reporting. |
| API service | FastAPI backend applies workflow rules, permissions, validation, and calculations. |
| Database | PostgreSQL stores users, batches, sessions, feedback, and related records. |
| Supporting services | Redis supports backend caching/rate limiting; Docker Compose runs the application services. Nginx is the default combined entry point in the local stack. |
| Optional integration | The Admin portal exposes FMS sync actions; verify the deployment's actual integration configuration before representing it as a live external connection. |

In the default local setup, the combined entry point is
`http://localhost:8080`; deployments may use a different URL. End users should
use the address supplied by their administrator rather than configure services
themselves.

## 2. Access and getting started

### Sign in

1. Open the Operations Hub URL provided by your administrator.
2. Enter your corporate email address and password on the **Operations Hub
   Login** page.
3. Select **Sign in**. Your available dashboard views are based on your role,
   team, reporting relationships, and configured approver status.
4. To change your password, select **Change My Password** in the dashboard
   navigation. Select **Sign Out** when finished on a shared device.

The application does not publish a shared end-user password. If you cannot
sign in, ask an administrator to verify that your account is active and reset
your password if needed. Repeated failed attempts can temporarily lock an
account.

### Navigation

The dashboard navigation can include:

| View | Typical purpose |
|---|---|
| **My Batches** | Review batches assigned to you and open the batch workspace. Delivery staff use this view to start a batch request and manage its schedule. |
| **Active Batches** | See batches in the operational pipeline and open their details. |
| **Approval Queue** | Review batch requests assigned to you as an approver. |
| **Manager Board** | Review manager work and pending operational items within your scope. |
| **All Batches** | Review the broader batch list and finance fields when your account has access. |
| **Faculty Utilization** | Review recorded delivery sessions, faculty, hours, status, and available feedback. |
| **Team Analytics** | Review scoped operational summary and trends when your account has manager-level access. |

Not every account sees every view. Administrators also have an **Admin &
Governance** destination in the header.

## 3. End-to-end batch workflow

### Step 1 — Create a batch request

Users who have batch-creation access (Delivery team users; an administrator
must provision the required account/team setup) select **Add New Batch** and
complete **Create New Batch Request**.

Complete the sections:

**Program & Client**

- Batch Identifier / Code — enter the agreed unique operational code.
- Client Account Name and Curriculum / Program Title.
- Operating Entity and Training Category.
- Technology Domain and Technology Stack & Modules.

**Schedule & Delivery**

- Delivery Mode, Training Venue / City when the selected mode requires a
  physical location, and Faculty Accommodation.
- Commencement Date and Conclusion Date.
- Active Training Days and Total Training Hours.

**Headcount & Faculty**

- Total Candidate Headcount.
- At least one Proposed Faculty Member.
- Sales Account SPOC, Operations Coordinator, and Delivery Manager where
  applicable.

**Commercial & Review**

- Client SOW / PO Number.
- Optional Operational Remarks.
- Review the **Pre-Flight Submission Summary** before submitting.

Select **Submit Batch Request**. The service validates required information,
unique batch identifiers, dates, training days/hours, candidate count, faculty
and approval configuration. Correct any validation messages and submit again.

> **Before submitting:** confirm the client spelling, batch code, dates,
> ownership, faculty, and SOW/PO reference with the relevant teams. These
> details affect downstream scheduling and reporting.

### Step 2 — Approve or return the request

The configured approver opens **Approval Queue**, selects the batch, reviews
the details, and chooses an approval or rejection action available to them.
The normal route is two-level approval:

1. Approver 1 reviews the submitted request.
2. If approved, the request moves to Approver 2.
3. After the required approvals, the batch becomes eligible for delivery.
4. If rejected, the requester should read the rejection feedback, correct the
   request in the batch details, and resubmit it for review.

Depending on configuration, a manager may have a direct approval action after
the first approval. Users only see approval actions when they are authorized
for that request. Approval locks governed batch details; later changes to
approval-sensitive fields may send the batch through reapproval.

### Step 3 — Add the timetable

Open the batch from **My Batches**, **Active Batches**, or an authorized batch
list. In the batch detail drawer, choose **Sessions & Timetable**.

There are two ways to add schedule entries:

**Upload a timetable**

1. Choose the schedule upload/ingestion action and select an `.xlsx`, `.xls`,
   or `.csv` timetable.
2. Review the extracted rows, including date, time, topic/module, faculty, and
   hours.
3. Correct or remove invalid rows in the preview where the interface allows.
4. Resolve reported row errors and schedule conflicts.
5. Apply the reviewed timetable to save it to the batch.

The importer recognizes common column names such as `date`, `date of
training`, `session date`; `topic`, `module`, `subject`; `start time`,
`end time`; `faculty`, `trainer`; and `hours`, `duration`. The original
spreadsheet is parsed in memory and is not retained as an uploaded file.

**Add a session manually**

Use the add-session action to enter the training date, start and end times,
topic, faculty, and duration. Save the entry and confirm that it appears in
the batch timetable.

**Review schedule completeness**

The batch list shows schedule coverage, including **Not scheduled** when there
are no scheduled days. Compare the number of schedule entries with the
batch's Active Training Days, and resolve any placeholder or missing-day
records before delivery.

> **Important validation limit:** schedule ingestion checks extracted data and
> applicable batch/date and duplicate/overlap rules, but it does not detect a
> faculty member double-booked across different batches. Coordinators should
> independently check faculty availability across the full schedule.

### Step 4 — Record delivery and session feedback

After a scheduled class, open the batch and use the session/utilization action
to record the actual delivery. Verify the session date, faculty, topic, hours,
mode, location/venue, and status. Mark a session **Completed** only after
delivery has taken place.

To complete a session through **Quality Checkpoint 1 (Gate 1)**:

1. Open the session's completion/feedback form.
2. Enter a rating from **1 to 5**.
3. Enter topic feedback (at least three characters).
4. Enter the number of students present; add observations where requested.
5. Submit the form.

The system records feedback and marks the session completed. A batch average
is calculated from rated completed delivery records. Completed sessions are
not editable through normal session updates.

For sessions that will not run, use the appropriate **Cancel** or **Not
Conducted** action and provide the required reason. If a session needs a new
date/time, use **Reschedule** instead of leaving the old appointment marked
as delivered.

### Step 5 — Close the batch (Gate 2)

When delivery is finished, open the batch's **Quality Checkpoints** tab and
choose the NPS closure action.

Before closing:

- Every scheduled and logged session must have a terminal outcome: Completed,
  Cancelled, or Not Conducted.
- At least one rated completed delivery must exist so the batch average
  feedback is available.

If NPS feedback is available, enter the number of **Promoters**, **Passives**,
and **Detractors**. Use the actual response counts; the system calculates NPS
from these counts. When NPS is unavailable, select the unavailable option and
provide a reason. Submit the closure and confirm that the batch status becomes
**Completed**.

The application rejects closure when quality or session prerequisites are
missing. Use the error message to find the outstanding session or missing
feedback, complete that work, and try closure again.

### Batch status at a glance

Typical statuses include **Approval 1 Pending**, **Approval 2 Pending**,
**Upcoming**, **Ongoing**, **Pending for Closure**, **Completed**, **OnHold**,
**Cancelled**, and **Rejected**. Exact transitions are controlled by the
workflow and authorization rules; a status change is not simply a label edit.

| Status / stage | What it means for the user |
|---|---|
| Approval pending | One of the configured approvers still needs to act. |
| Upcoming / Ongoing | Approved batch awaiting or undergoing delivery. |
| Pending for Closure | Delivery window has ended; finish quality and closure steps. |
| OnHold | Delivery is paused; coordinate the reason and resume action. |
| Rejected | Read the reviewer feedback, correct the request, and resubmit if permitted. |
| Completed | Closure was recorded; retain the batch as the final operational record. |
| Cancelled | Delivery was terminated; the system treats this as a terminal batch state. |

## 4. Reviewing utilization and reporting

### Faculty Utilization

Open **Faculty Utilization** to review the delivery ledger. Common fields
include training date, faculty, batch, topic, hours, status, mode, rating,
client, coordinator, venue, and module feedback. Use the table's search,
filters, sorting, column chooser, pagination, and CSV export to focus the
review.

Use this view to answer operational questions such as:

- Which sessions were delivered in a selected period?
- Which faculty member delivered a session?
- Which batch or topic is associated with the hours?
- Was feedback submitted and what rating was recorded?

### Manager Board and Team Analytics

Managers use **Manager Board** for scoped operational monitoring and
**Team Analytics** for available summary views. Review pending approvals,
batch status, schedule readiness, delivery progress, and quality indicators.
Choose the period or filters shown in the view before comparing results.

### All Batches and finance review

Authorized finance users and configured approvers may see **All Batches**.
Finance users can review batch commercial and finance information, including
approval reference, finance status, and check date. Save edited finance fields
using the save action shown in the row or **Save All**. Review unsaved-row
indicators before leaving the view.

### Exporting data

Where an **Export CSV** action is available:

1. Apply the intended filters and search terms.
2. Confirm the visible rows and selected columns are appropriate.
3. Export the data and store it only in an approved location.

CSV exports are operational data; handle client and faculty information
according to your organization's data-handling policy.

## 5. Administrator and governance workflows

Administrators use **Admin & Governance**. Available sections include:

| Section | Administrator task |
|---|---|
| **Ops Teams** | Create, update, or retire teams and review membership counts. |
| **Roles & Titles** | Maintain roles/titles used to control access and assignment. |
| **Batch Taxonomy** | Maintain controlled batch options such as entities, categories, delivery modes, or accommodation types. |
| **Staff Directory** | Create/update user records, assign roles/teams/manager, activate or deactivate access, and reset passwords. |
| **FMS External Sync** | Dispatch a supported sync event for a faculty identifier and inspect the returned status/log. |
| **Hierarchy Tree** | Review the configured manager/reporting hierarchy. |
| **Coordinator Mappings** | Maintain coordinator-to-manager mappings used for operational scope. |
| **Audit Logs** | Review recorded administrative and application activity where available. |

Administrators should configure teams, users, roles, manager hierarchy,
coordinator mappings, approvers, and taxonomy before asking users to create
production batches. After changing access configuration, ask the affected
user to sign out and sign in again if their visible permissions have not
updated.

FMS actions are external-integration operations, not a routine substitute for
recording delivery in the Hub. Confirm the integration environment and
expected impact before dispatching a test or production event.

## 6. Common problems and what to do

| What you see | What to check / do |
|---|---|
| Login fails or account is locked | Recheck the corporate email; contact an administrator to verify account status or reset the password. Wait for any temporary lockout to expire. |
| A navigation item is missing | Access is role-, team-, scope-, or approver-dependent. Ask an administrator to verify your assignments. |
| Batch creation is rejected | Check required fields, unique batch code, future/valid dates, training days/hours, headcount, proposed faculty, and configured approval setup. |
| Cannot approve a batch | Confirm you are the configured approver for that level and that the batch is in the matching pending state. |
| Timetable has extraction errors | Check date/topic headers and date/time values. Use a supported spreadsheet/CSV file and correct the listed row errors. |
| Schedule says Not scheduled or incomplete | Open the batch's timetable and apply valid schedule entries; compare days against the batch request. |
| Faculty conflict is not shown | The importer does not check cross-batch faculty double-booking. Check faculty availability separately and adjust the schedule. |
| Cannot mark session complete | Enter valid Gate 1 feedback, a rating from 1–5, topic feedback, and student attendance. |
| Cannot close batch | Finish or record an outcome for every session and ensure at least one rated completed delivery exists; then provide valid NPS counts or a reason NPS is unavailable. |
| Finance edits are not saved | Save the row or use **Save All** and check the visible success/error message and unsaved-row count. |
| Unexpected error or stale data | Use the view's refresh action if available. If the issue remains, report the batch/session identifier, action attempted, time, and the exact error to support; do not include passwords. |

## 7. Good operating practices

- Use the agreed batch identifier and client/SOW naming conventions.
- Review batch details before submitting and timetable rows before applying.
- Keep session outcomes current; do not mark a class completed before delivery.
- Enter factual feedback and response counts; do not invent ratings or NPS data.
- Record a reason when an appointment is cancelled, not conducted, or NPS is
  unavailable.
- Check the whole faculty timetable for cross-batch conflicts.
- Use batch/session IDs and exact error messages when asking for support.
- Export only the minimum data needed and handle it under organization policy.

## 8. Presentation-ready walkthrough

Suggested **10-slide** presentation for users and stakeholders:

1. **Title and purpose** — Enterprise Operations Hub; replace fragmented
   tracking with one governed workflow.
2. **The operational challenge** — batch details, timetables, delivery, and
   feedback need a shared source of truth.
3. **The three workflows** — Batch Lifecycle, Schedule Management, Faculty
   Utilization & Quality.
4. **Roles and visibility** — coordinator creates/updates, approvers review,
   manager monitors, finance reviews, administrator configures; screens vary
   by access.
5. **Batch request demonstration** — show Add New Batch, required sections,
   pre-flight summary, and submission.
6. **Approvals and lifecycle** — illustrate the two-level approval route and
   upcoming/ongoing/closure statuses.
7. **Schedule demonstration** — show upload, preview, corrections, apply, and
   manual session addition; mention checking faculty conflicts across batches.
8. **Delivery and Gate 1** — log actual delivery and enter session rating,
   topic feedback, and attendance.
9. **Close and report** — show Gate 2 NPS response counts, closure checks,
   utilization and analytics views, and CSV export.
10. **Takeaways and next steps** — request access, follow the workflow, keep
    records accurate, and contact support with the batch/session identifier.

### Suggested live demo script

Use a non-production/demo account and sample data:

1. Sign in as a coordinator and open **My Batches**.
2. Create a sample batch request and point out the pre-flight summary.
3. Switch to an authorized approver account and demonstrate approval review.
4. Return to the coordinator account, preview and apply a sample timetable.
5. Open a scheduled session, record a sample delivery and Gate 1 feedback.
6. Show how a missing session outcome or feedback blocks Gate 2.
7. Complete the sample closure with fictional NPS counts.
8. Open **Faculty Utilization** and show table filtering/export.

Do not use real client or learner information in presentation screenshots.
Ensure the demo data is clearly identified as fictional.

## 9. Technical references and scope notes

- [Repository overview and developer quickstart](../README.md)
- [Complete workflow/API reference](../WORKFLOWS_COMPLETE.md)
- [Authentication and authorization](../workflows/01-authentication-authorization.md)
- [Batch lifecycle](../workflows/02-batch-lifecycle-state-machine.md)
- [Session management](../workflows/03-session-management-state-machine.md)
- [Quality gates](../workflows/04-quality-gates.md)
- [Schedule ingestion](../workflows/05-schedule-ingestion.md)
- [Notifications](../workflows/07-notifications.md)
- [Scheduler](../workflows/09-scheduler.md)
- [Data models](../workflows/10-data-models.md)

This application includes both a user interface and a backend API. User-facing
controls are subject to backend authorization and business validation. Check
the technical workflow references or ask the system owner before promising an
integration, notification, dashboard metric, or validation behavior not
described here.
