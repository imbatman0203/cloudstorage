-- Afterframe persistent cloud storage schema.
-- Run once in the Supabase SQL editor after creating the project.

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  original_name text not null,
  category text not null default 'Moments',
  tone text not null default 'sage',
  size_bytes bigint not null,
  duration_seconds numeric,
  mime_type text not null,
  original_path text not null,
  hls_path text,
  status text not null default 'Queued',
  processing_stage text not null default 'Queued',
  processing_progress integer not null default 0 check (processing_progress between 0 and 100),
  share_token text not null unique,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.videos enable row level security;

create policy "Owners can view their videos" on public.videos for select using (auth.uid() = owner_id);
create policy "Owners can create their videos" on public.videos for insert with check (auth.uid() = owner_id);
create policy "Owners can update their videos" on public.videos for update using (auth.uid() = owner_id);
create policy "Owners can delete their videos" on public.videos for delete using (auth.uid() = owner_id);

insert into storage.buckets (id, name, public)
values ('afterframe-videos', 'afterframe-videos', false)
on conflict (id) do nothing;

create policy "Owners can read their video objects" on storage.objects for select using (bucket_id = 'afterframe-videos' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "Owners can upload their video objects" on storage.objects for insert with check (bucket_id = 'afterframe-videos' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "Owners can update their video objects" on storage.objects for update using (bucket_id = 'afterframe-videos' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "Owners can remove their video objects" on storage.objects for delete using (bucket_id = 'afterframe-videos' and auth.uid()::text = (storage.foldername(name))[1]);
