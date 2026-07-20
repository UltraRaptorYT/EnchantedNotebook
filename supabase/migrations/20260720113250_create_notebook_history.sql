create table public.notebook_history (
  id bigint generated always as identity primary key,
  notebook_id uuid not null,
  drawing_path text not null unique,
  question text not null check (char_length(question) between 1 and 2000),
  answer text not null check (char_length(answer) between 1 and 10000),
  model text not null check (char_length(model) between 1 and 100),
  created_at timestamptz not null default now()
);

create index notebook_history_notebook_created_idx
  on public.notebook_history (notebook_id, created_at desc);

create index notebook_history_created_idx
  on public.notebook_history (created_at desc);

alter table public.notebook_history enable row level security;

revoke all on table public.notebook_history from anon, authenticated;
grant select, insert, delete on table public.notebook_history to service_role;
grant usage, select on sequence public.notebook_history_id_seq to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'notebook-drawings',
  'notebook-drawings',
  false,
  4000000,
  array['image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
