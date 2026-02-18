-- SMate: Mode B (draft → confirm → persist) + Smart Context Window
-- Adds conv_state to conversations, drafts table, full-text search on messages

-- ============================================================
-- CONVERSATIONS: add conv_state for Mode B flow
-- ============================================================
alter table public.conversations
  add column conv_state text not null default 'normal'
  check (conv_state in ('normal', 'awaiting_confirmation'));

-- ============================================================
-- DRAFTS: pending data extractions awaiting user confirmation
-- ============================================================
create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  draft_data jsonb not null,         -- array of {tool, input} items
  summary_text text not null,        -- human-readable summary shown to user
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'discarded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.drafts enable row level security;
create index idx_drafts_conversation on public.drafts(conversation_id);
create index idx_drafts_pending on public.drafts(conversation_id)
  where status = 'pending';
create trigger drafts_updated_at before update on public.drafts
  for each row execute function public.update_updated_at();

-- ============================================================
-- FULL-TEXT SEARCH on messages (Spanish config)
-- ============================================================
alter table public.messages
  add column content_tsv tsvector
  generated always as (to_tsvector('spanish', content)) stored;

create index idx_messages_fts on public.messages using gin(content_tsv);
