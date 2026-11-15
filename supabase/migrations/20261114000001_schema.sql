-- DevFest Toronto 2026 swag distribution: core schema (portable Postgres).
-- All reads/writes happen on the server through a direct Postgres connection.
-- Row Level Security is enabled on every table with NO policies here, so the
-- Supabase anon/authenticated API roles cannot read or write anything.

create table if not exists registrations (
  ticket_number        text primary key check (ticket_number ~ '^[A-Z0-9_-]{4,64}$'),
  order_number         text not null default '',
  first_name           text not null default '',
  last_name            text not null default '',
  email                text not null default '',
  ticket_title         text not null default '',
  checkin_date_utc     text,
  barcode_id           text,
  extra                jsonb not null default '{}'::jsonb,
  in_latest_import     boolean not null default true,
  first_imported_at    timestamptz not null default now(),
  last_imported_at     timestamptz not null default now(),
  import_id            text not null default '',
  eligibility_override jsonb,
  -- Single authoritative swag claim state. Only claim/reverse transactions write it.
  swag                 jsonb
);
create index if not exists registrations_barcode_id_idx on registrations (barcode_id);

create table if not exists inventory (
  id            smallint primary key default 1 check (id = 1),
  initial       integer not null default 0 check (initial >= 0),
  adjustments   integer not null default 0,
  bags_out      integer not null default 0 check (bags_out >= 0),
  active_claims integer not null default 0 check (active_claims >= 0),
  -- Database-level guard: inventory can never go negative (no overselling).
  constraint inventory_not_negative check (initial + adjustments - bags_out >= 0)
);
insert into inventory (id) values (1) on conflict do nothing;

create table if not exists settings (
  id   smallint primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb
);
insert into settings (id) values (1) on conflict do nothing;

create table if not exists events (
  id            uuid primary key,
  type          text not null,
  at            timestamptz not null,
  at_ms         bigint not null,
  actor         jsonb not null,
  ticket_number text,
  counter       text,
  claim_id      text,
  details       jsonb
);
create index if not exists events_at_ms_idx on events (at_ms desc);
create index if not exists events_type_at_ms_idx on events (type, at_ms desc);
create index if not exists events_ticket_idx on events (ticket_number);

-- Audit history is append-only.
create or replace function events_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'audit events are append-only';
end $$;
drop trigger if exists events_no_update on events;
create trigger events_no_update before update or delete on events
  for each row execute function events_append_only();

create table if not exists idempotency (
  key           text primary key,
  uid           text not null,
  ticket_number text not null,
  result        jsonb not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null
);
create index if not exists idempotency_expires_idx on idempotency (expires_at);

create table if not exists live_meta (
  id         smallint primary key default 1 check (id = 1),
  version    bigint not null default 0,
  updated_at timestamptz not null default now()
);
insert into live_meta (id) values (1) on conflict do nothing;

create table if not exists staff (
  user_id      uuid primary key,
  email        text not null unique,
  display_name text not null,
  role         text not null check (role in ('organizer', 'volunteer')),
  added_by     text not null,
  added_at     timestamptz not null default now()
);

alter table registrations enable row level security;
alter table inventory     enable row level security;
alter table settings      enable row level security;
alter table events        enable row level security;
alter table idempotency   enable row level security;
alter table live_meta     enable row level security;
alter table staff         enable row level security;
