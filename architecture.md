Kisan Flow — Phase 1 Architecture &
Implementation Blueprint
Smart Farmer Procurement & Queue Management System
Target repo: kisanflow (GitHub) — designed to be implemented as a Next.js +
Supabase modular monolith.
1. Executive Summary
Kisan Flow digitizes agricultural procurement so farmers book a slot, receive a token,
and track their position in a live queue instead of waiting physically at a procurement
centre. Officers manage verification, queue progression, and quality checks; admins
manage centres, officers, and system-wide analytics.
Core design commitments:
Server-side authorization everywhere — no role or permission decision is ever
trusted from the client.
Transactional integrity for slot booking and token issuance (no overbooking, no
duplicate tokens, race-safe under concurrency).
Auditable state machines for queue and procurement status — every transition is
logged with actor, timestamp, and reason.
Modular monolith — one Next.js codebase, cleanly layered, deployable to Vercel,
backed by a single Supabase/PostgreSQL instance. Microservices are explicitly
out of scope for the foreseeable roadmap.
Demo-safe by construction — payments, document verification, and AI responses
are clearly synthetic/mocked and labeled as such; nothing claims real financial,
government, or identity-verification integration.
2. System Architecture
Style: Modular monolith, layered architecture, single deployable Next.js app.
Layers (top to bottom):
1. Presentation — Next.js App Router pages/components (Farmer, Officer, Admin,
Public surfaces) 2. Application/Service layer — Server Actions + Route Handlers encapsulating
business rules ( /lib/services/* )
3. Data access layer — typed Supabase client wrappers ( /lib/db/* ), no raw queries
scattered in UI code
4. Database layer — PostgreSQL via Supabase, enforcing constraints, RLS, and
(where needed) stored procedures/RPC for atomic operations
5. Cross-cutting — auth, logging/audit, notifications, localization, AI assistant
gateway
Why monolith-first: procurement volume per hackathon/pilot scope is modest, team
size is small, and a monolith avoids distributed-transaction complexity for the slot-
booking/token/queue chain, which must be atomic. Section 23 describes the scaling
path.
3. High-Level Architecture Diagram (conceptual)
 ┌─────────────────────────────┐
 │ Farmer / Officer / Admin │
 │ (Browser / Mobile) │
 └──────────────┬───────────────┘
 │ HTTPS
 ┌──────────────▼───────────────┐
 │ Next.js App │
 │ (App Router, RSC + Client) │
 ├────────────────────────────────┤
 │ Server Actions / Route Handlers│
 │ - Auth guard │
 │ - Role/permission check │
 │ - Input validation (zod) │
 └──────────────┬───────────────┘
 │
 ┌──────────────▼───────────────┐
 │ Service / Business Layer │
 │ SlotService TokenService │
 │ QueueService ProcurementService │
 │ PaymentService NotifyService │
 │ AuditService AssistantGateway │
 └──────────────┬───────────────┘
 │
 ┌──────────────▼───────────────┐
 │ Supabase Platform │
 │ ┌─────────┐ ┌───────────────┐ │
 │ │Postgres │ │ Auth (JWT/RLS)│ │
 │ │ + RLS │ └───────────────┘ │
 │ │ + RPC │ ┌───────────────┐ │ │ └─────────┘ │Storage (docs) │ │
 │ └───────────────┘ │
 └────────────────────────────────┘
Deployment: GitHub → Vercel (frontend/serverless functions) → Supabase (managed
Postgres/Auth/Storage).
4. Frontend Architecture
Next.js (App Router) + TypeScript + Tailwind + shadcn/ui + Lucide icons.
Principles:
Server Components by default; Client Components only where interactivity is
required (forms, live queue widgets, dashboards with polling/subscriptions).
Route groups separate audiences: (public) , (farmer) , (officer) , (admin) ,
each with its own layout enforcing auth/role at the layout level in addition to
server-side checks.
No business logic in components — components call service functions/Server
Actions; components never talk to Supabase directly for writes.
Shared design system in /components/ui (shadcn primitives) and
/components/shared (composed, app-specific).
Data fetching for read-heavy dashboards uses server components; live queue
status uses Supabase Realtime subscriptions or short-interval polling (see §8).
5. Backend Architecture
Backend logic lives inside the Next.js app as:
Server Actions for form-style mutations (create crop, book slot, update profile).
Route Handlers ( /app/api/* ) for anything needing to be called from external
clients, webhooks, or the AI assistant gateway, and for endpoints requiring custom
HTTP semantics (e.g., pagination, status codes for polling).
Both call into a shared service layer so business rules aren't duplicated between the
two entry points. Services are plain TypeScript modules, framework-agnostic, easily
unit-tested.
Cross-cutting middleware (applied at Server Action/Route Handler entry):
1. Resolve authenticated user from Supabase session (server-side, never trust client-
sent user/role).
2. Load the user's role/permissions from the database (not from JWT claims alone,
unless claims are set via a trusted server-side hook and re-verified periodically). 3. Validate input with zod schemas shared between client (for UX) and server (for
enforcement) — server validation is authoritative.
4. Execute service logic inside a transaction where multi-row consistency matters.
5. Write audit log entry for state-changing actions.
6. Trigger notifications where applicable.
6. Database Architecture
PostgreSQL via Supabase. Fully normalized (3NF) with explicit foreign keys, check
constraints for enums/state machines, and RLS policies on every table containing
user-scoped data.
6.1 Entity list and design
profiles
PK: id (uuid, = auth.users.id )
Columns: full_name , phone , role ( enum: farmer|officer|admin ),
preferred_language , created_at , updated_at
Unique: phone
RLS: user can read/update own row; officers/admins can read rows relevant to
their scope (see §7/§8); role column is never writable by the user themself —
only via an admin-only server action/RPC ( set_user_role ) using the service role
key.
farmers
PK: id (uuid) FK → profiles.id
Columns: district , state , village , land_document_id (FK → documents),
identity_document_id (FK → documents), verification_status ( enum:
unverified|pending|verified|rejected ), created_at
RLS: farmer reads/updates own row only; officers/admins read all (or centre-
scoped for officers, see §8).
officers
PK: id (uuid) FK → profiles.id
Columns: assigned_centre_id (FK → procurement_centres), employee_code
(unique), active (bool)
RLS: officer reads own row; admin full access.
admins
PK: id (uuid) FK → profiles.id
Columns: access_level ( enum: standard|super ) RLS: admin-only read/write via service checks; no self-elevation possible from
client.
crops
PK: id (uuid)
FK: farmer_id → farmers
Columns: crop_type , variety , estimated_quantity_kg (numeric),
harvest_date , created_at
RLS: farmer CRUD on own rows; officers/admins read.
procurement_centres
PK: id (uuid)
Columns: name , district , state , address , operating_hours_start (time),
operating_hours_end (time), daily_capacity , active (bool), created_at
Index: (district, state) , active
RLS: public read (for slot selection); write restricted to admin.
procurement_slots
PK: id (uuid)
FK: centre_id → procurement_centres
Columns: slot_date (date), start_time , end_time , capacity (int),
booked_count (int, maintained by trigger/RPC — never trusted from client),
active (bool)
Unique: (centre_id, slot_date, start_time)
Check: booked_count <= capacity
Index: (centre_id, slot_date) , active
RLS: public read of open slots; write restricted to admin/officer (officer limited to
own centre).
procurement_requests
PK: id (uuid), human-readable booking_id (text, e.g. KF-2026-000123 ,
generated — see §7)
FK: farmer_id , crop_id , slot_id , centre_id
Columns: status ( enum — the workflow states in §9), token_code (text, unique
per centre/day — see §7), quantity_kg , remarks , created_at , updated_at
Unique: (slot_id, farmer_id) — prevents duplicate booking of same slot by
same farmer
Index: status , (centre_id, created_at) RLS: farmer reads/creates own; officer reads/updates rows scoped to their centre;
admin full access.
queue_entries
PK: id (uuid)
FK: procurement_request_id (unique — 1:1), slot_id
Columns: queue_state ( enum — §8 states), position (int, assigned at creation,
immutable), called_at , arrived_at , completed_at , skip_reason
Index: (slot_id, queue_state, position)
RLS: farmer reads own; officer reads/updates centre-scoped; admin full.
procurement_status_history
PK: id (uuid)
FK: procurement_request_id
Columns: from_status , to_status , changed_by (FK profiles), remarks ,
created_at
Append-only (no update/delete allowed by RLS — insert-only for the service role).
payments
PK: id (uuid)
FK: procurement_request_id (unique — 1:1), farmer_id
Columns: amount (numeric), status ( enum: pending|processing|completed ),
reference_number (text, unique, synthetic), payment_date , is_demo_data (bool,
default true)
RLS: farmer reads own; officer/admin update status within centre scope.
notifications
PK: id (uuid)
FK: recipient_id (profiles)
Columns: type , title , body , is_read (bool), related_entity_type ,
related_entity_id , created_at
Index: (recipient_id, is_read, created_at)
RLS: user reads/updates (mark read) own rows only; inserts performed by service
role only.
documents
PK: id (uuid)
FK: owner_id (farmers)
Columns: document_type ( enum: identity|land|payment ), storage_path ,
status ( enum: uploaded|pending_verification|verified|rejected ), verified_by , verified_at , created_at
RLS: owner uploads/reads own; officer/admin verify (update status) within scope.
audit_logs
PK: id (uuid)
Columns: actor_id , action , entity_type , entity_id , metadata (jsonb),
ip_address (nullable, only where legally appropriate), created_at
Insert-only, no update/delete via RLS; readable only by admin.
6.2 Key relationships
farmers 1—N crops
farmers 1—N procurement_requests
procurement_centres 1—N procurement_slots
procurement_slots 1—N procurement_requests (bounded by capacity)
procurement_requests 1—1 queue_entries
procurement_requests 1—N procurement_status_history
procurement_requests 1—1 payments
profiles 1—N notifications
profiles 1—N audit_logs (as actor)
6.3 RLS design principle
Every table's RLS policy is written against auth.uid() joined through
profiles / officers / farmers , never against a client-supplied role field. Officer-
scoped policies join through officers.assigned_centre_id =
target_row.centre_id . All privilege-sensitive writes (role assignment, verification
approval, payment status) are additionally wrapped in SECURITY DEFINER RPC
functions that re-check authorization server-side, so RLS is a second line of defense,
not the only one.
7. Authentication Architecture
Supabase Auth (email/phone + password, OTP optional) issues JWTs.
On signup, a trigger ( handle_new_user ) creates a corresponding profiles row
with role = 'farmer' by default. Officer/admin accounts are provisioned only by
an existing admin through a privileged RPC — never through public self-
registration.
Session handled via Supabase's server-side auth helpers for Next.js (cookie-
based, httpOnly, secure); every Server Action/Route Handler re-derives the user from the verified session, never from client-passed IDs.
Password reset via Supabase's built-in flow (magic link/email).
Role is never read from the JWT app_metadata blindly for authorization
decisions on sensitive actions — the service layer re-queries profiles.role
server-side for every privileged action, so a stale or tampered client token cannot
grant access.
8. Authorization / RBAC Architecture
Three roles: farmer , officer , admin . Officer additionally scoped to
assigned_centre_id .
Enforcement layers (defense in depth):
1. Route-group layout guard (UX only) — redirects unauthenticated/wrong-role users
away from a route tree. Not trusted for security.
2. Server Action / Route Handler guard — every entry point calls
requireRole(['officer','admin']) -style helper that re-fetches the user's role
from the DB using the server-side Supabase client with the verified session.
3. Database RLS — final backstop; even if application logic is buggy, the database
itself refuses cross-tenant/cross-role reads and writes.
4. Centre scoping — officer actions additionally check
officers.assigned_centre_id === target.centre_id server-side and in RLS.
This means privilege escalation requires simultaneously defeating the Server Action,
the RLS policy, and the centre-scope check — not just hiding a button in the UI.
9. API Architecture
Mix of Server Actions (primary, for form/mutation flows) and Route Handlers
( /app/api/... ) for polling/webhook-style needs. All grouped by domain:
Auth: register , login , logout , resetPassword (mostly via Supabase client SDK +
a thin wrapper for profile bootstrap)
Farmers: getProfile , updateProfile , addCrop , updateCrop , listCrops
Centres: listCentres , getCentre , getCentreCapacity
Slots: listAvailableSlots(centreId, date) , bookSlot(slotId, cropId)
(transactional, §10), cancelBooking(requestId)
Queue: getQueueStatus(slotId) (polling/subscription), callNext(slotId) ,
markArrived(requestId) , startProcessing(requestId) , completeProcurement(requestId) , skipFarmer(requestId, reason)
Procurement: createRequest (implicit in bookSlot), approveRequest ,
updateStatus(requestId, newStatus, remarks)
Payments: listPayments(scope) , updatePaymentStatus(paymentId, status)
Notifications: listNotifications , markRead(id) , markAllRead
Assistant: askAssistant(message, locale) — server-only, never exposes DB directly
to the LLM (see §17)
Each endpoint spec (pattern applied uniformly): method/action type, purpose, input
schema (zod), output shape, required role, required ownership/scope check, validation
rules, and explicit error cases (401 unauthenticated, 403 wrong role/scope, 404 not
found, 409 conflict e.g. slot full, 422 validation).
10. Slot Booking Architecture (critical path)
Guarantee required: capacity is never exceeded, even under concurrent requests.
Design: a single Postgres RPC function book_slot(p_farmer_id, p_slot_id,
p_crop_id) marked SECURITY DEFINER , called from the server (never raw client
inserts). Inside one transaction:
BEGIN;
 SELECT capacity, booked_count, active, slot_date, start_time,
end_time
 FROM procurement_slots
 WHERE id = p_slot_id
 FOR UPDATE; -- row lock prevents concurrent
readers
 -- from both seeing "space
available"
 -- validate: slot active, centre active, within operating hours,
 -- not already booked by this farmer, slot not in the past
 IF booked_count >= capacity THEN
 RAISE EXCEPTION 'SLOT_FULL';
 END IF;
 INSERT INTO procurement_requests (...) RETURNING id, booking_id;
 INSERT INTO queue_entries (procurement_request_id, position,
queue_state)
 VALUES (new_request_id, booked_count + 1, 'WAITING');
 UPDATE procurement_slots SET booked_count = booked_count + 1 WHERE id = p_slot_id;
COMMIT;
SELECT ... FOR UPDATE row-locks the slot row for the duration of the transaction, so
if Farmer A and Farmer B hit book_slot concurrently for the last position, the second
transaction blocks until the first commits, then re-reads booked_count and correctly
sees the slot is full — only one booking succeeds. This is enforced in the database,
not in application code, so it holds regardless of how many serverless function
instances call it concurrently.
Additional safeguards:
CHECK (booked_count <= capacity) constraint as a second guard against any
code path that bypasses the RPC.
UNIQUE (slot_id, farmer_id) prevents duplicate booking by the same farmer.
Explicit checks for centre active , slot active , and now() within
operating_hours before allowing insert.
The RPC is the only insert path into procurement_requests / queue_entries for
booking — application code never does a raw multi-step insert from the client
session.
11. Token Generation Architecture
Booking ID — globally unique, human-readable, generated via a Postgres sequence
per year: KF-<year>-<zero-padded sequence> (e.g. KF-2026-000123 ).
Sequence guarantees no duplicates even under concurrency ( nextval is atomic).
Token — scoped per centre per day (resets daily), format KF-<3-digit-
sequence> (e.g. KF-016 ), generated inside the same book_slot transaction
using booked_count + 1 at that centre/date scope (or a dedicated per-centre-
per-day sequence/counter row locked with FOR UPDATE ) — guaranteeing tokens
are issued in booking order with no gaps under normal operation.
Cancellation: a cancelled booking's token is not reused — reuse would break the
"token order = arrival order" guarantee and could cause two people to hold the
same token. The slot's booked_count is decremented on cancellation (freeing
capacity for a new booking), but the cancelled request keeps its historical token
for audit purposes; the queue simply removes that entry from the active queue.
Order preservation: queue_entries.position is assigned at creation and is
immutable; ordering for "next in line" is always ORDER BY position ASC filtered to
active states, so a cancellation doesn't renumber everyone else's position — it just
leaves a gap, which is harmless since the queue orders by position, not by count. 12. Queue Management Architecture
States: WAITING → CALLED → ARRIVED → PROCESSING → COMPLETED , with
SKIPPED reachable from WAITING or CALLED .
Valid transitions & actors:
From To Actor
WAITING CALLED officer ( callNext )
CALLED ARRIVED officer ( markArrived )
CALLED SKIPPED officer ( skipFarmer , requires reason)
WAITING SKIPPED officer ( skipFarmer , requires reason)
ARRIVED PROCESSING officer ( startProcessing )
PROCESSING COMPLETED officer ( completeProcurement )
All other transitions (e.g. COMPLETED → WAITING , farmer self-transitioning) are invalid
and rejected server-side by the transition function, which checks current state before
applying the next one (a small explicit state-machine table/ CASE in the service layer,
not ad-hoc UPDATE s).
Derived, server-computed values (never faked on the frontend):
current_token = the entry with state CALLED or PROCESSING for the slot (lowest
position among those states).
next_token = lowest-position WAITING entry for the slot.
people_ahead for a given farmer = COUNT(*) WHERE slot_id = X AND
queue_state IN ('WAITING') AND position < farmer's position .
estimated_wait = people_ahead * average_processing_duration , where
average_processing_duration is computed from AVG(completed_at -
arrived_at) over recently completed entries at that centre (rolling window, e.g.
last 20 completions), recalculated server-side — not a hardcoded guess.
Each transition writes a row to procurement_status_history -equivalent audit trail,
updates queue_entries timestamps ( called_at , arrived_at , completed_at ),
and triggers a notification to the farmer.
13. Procurement Workflow Architecture States: SUBMITTED → UNDER_VERIFICATION → APPROVED → SCHEDULED →
FARMER_ARRIVED → QUALITY_CHECK → COLLECTED → PAYMENT_PROCESSING →
PAYMENT_COMPLETED
Transition Actor Required input
SUBMITTED →
UNDER_VERIFICATION
officer —
UNDER_VERIFICATION →
APPROVED
officer remarks (optional)
UNDER_VERIFICATION →
REJECTED
officer remarks (required)
APPROVED → SCHEDULED
system (on slot
booking confirmation)
slot_id
SCHEDULED →
FARMER_ARRIVED
officer matches queue
ARRIVED
FARMER_ARRIVED →
QUALITY_CHECK
officer matches queue
PROCESSING
QUALITY_CHECK → COLLECTED officer quantity_kg confirmed
COLLECTED →
PAYMENT_PROCESSING
officer/system —
PAYMENT_PROCESSING →
PAYMENT_COMPLETED
officer reference_number
Every transition is applied through one service function
transitionProcu
