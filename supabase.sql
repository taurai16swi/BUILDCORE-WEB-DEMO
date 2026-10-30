-- BuildCore Supabase foundation.
-- Run in the Supabase SQL Editor. Never put a service_role key in browser code.
-- Identity records and chat attachments are private; only short-lived signed URLs
-- should be issued to an authenticated owner, approved chat participant, or admin.

do $$
begin
  create type public.platform_user_role as enum ('customer', 'builder', 'admin');
exception
  when duplicate_object then null;
end
$$;

alter type public.platform_user_role add value if not exists 'company';

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now(),
  role public.platform_user_role not null default 'customer',
  full_name text not null default 'New Operator'
);

create table if not exists public.builder_profiles (
  id uuid primary key references public.profiles(id) on delete cascade,
  builder_tag text unique not null,
  business_name text not null,
  is_approved boolean not null default false,
  department_code text not null default 'OT',
  age smallint not null,
  phone text not null,
  skills text[] not null default '{}',
  work_experience text not null,
  country text not null,
  location text not null,
  portfolio_url text,
  identity_document_type text not null,
  identity_document_path text not null,
  certificate_paths text[] not null default '{}',
  application_pdf_path text,
  created_at timestamptz not null default now(),
  constraint builder_profiles_age_check check (age between 1 and 120),
  constraint builder_profiles_department_check check (department_code in ('FD', 'BD', 'MD', 'UX', 'HW', 'OT')),
  constraint builder_profiles_identity_type_check check (
    identity_document_type in ('National ID', 'Passport', 'Driver''s licence')
  ),
  constraint builder_profiles_skills_check check (cardinality(skills) > 0),
  constraint builder_profiles_portfolio_url_check check (
    portfolio_url is null or portfolio_url ~ '^https?://'
  )
);

alter table public.builder_profiles
  add column if not exists department_code text not null default 'OT',
  add column if not exists age smallint,
  add column if not exists phone text,
  add column if not exists skills text[] not null default '{}',
  add column if not exists work_experience text,
  add column if not exists country text,
  add column if not exists location text,
  add column if not exists portfolio_url text,
  add column if not exists identity_document_type text,
  add column if not exists identity_document_path text,
  add column if not exists certificate_paths text[] not null default '{}',
  add column if not exists application_pdf_path text;

create sequence if not exists public.builder_tag_number_seq
  as bigint
  minvalue 0
  start with 0
  increment by 1
  no cycle;

do $$
declare
  highest_existing_number bigint;
  current_sequence_number bigint;
begin
  select max((regexp_match(builder_tag, '^BCT-BLD-([0-9]+)-[A-Z]{2}$'))[1]::bigint)
  into highest_existing_number
  from public.builder_profiles;

  if highest_existing_number is not null then
    select last_value into current_sequence_number
    from public.builder_tag_number_seq;

    perform setval(
      'public.builder_tag_number_seq',
      greatest(highest_existing_number, current_sequence_number),
      true
    );
  end if;
end
$$;

create table if not exists public.chatter_box_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  message_content text,
  attachment_url text,
  file_name text,
  created_at timestamptz not null default now(),
  constraint chatter_box_message_length check (
    message_content is null or char_length(message_content) <= 200
  ),
  constraint chatter_box_message_not_empty check (
    nullif(btrim(message_content), '') is not null or attachment_url is not null
  )
);

alter table public.chatter_box_messages
  add column if not exists file_name text;

create index if not exists chatter_box_messages_sender_created_idx
  on public.chatter_box_messages (sender_id, created_at desc);
create index if not exists chatter_box_messages_receiver_created_idx
  on public.chatter_box_messages (receiver_id, created_at desc);

create or replace function public.has_platform_role(required_role public.platform_user_role)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = required_role
  );
$$;

revoke all on function public.has_platform_role(public.platform_user_role) from public, anon;
grant execute on function public.has_platform_role(public.platform_user_role) to authenticated;

create or replace function public.has_approved_builder_profile()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
  select public.has_platform_role('admin'::public.platform_user_role)
    or (
      public.has_platform_role('builder'::public.platform_user_role)
      and exists (
        select 1
        from public.builder_profiles
        where id = (select auth.uid())
          and is_approved
      )
    );
$$;

revoke all on function public.has_approved_builder_profile() from public, anon;
grant execute on function public.has_approved_builder_profile() to authenticated;

create or replace function public.assign_builder_tag()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
begin
  if new.department_code not in ('FD', 'BD', 'MD', 'UX', 'HW', 'OT') then
    raise exception 'Unsupported builder department code';
  end if;

  new.builder_tag := 'BCT-BLD-'
    || lpad(nextval('public.builder_tag_number_seq')::text, 5, '0')
    || '-'
    || new.department_code;
  return new;
end;
$$;

drop trigger if exists assign_builder_tag_before_insert on public.builder_profiles;
create trigger assign_builder_tag_before_insert
  before insert on public.builder_profiles
  for each row execute function public.assign_builder_tag();

create or replace function public.handle_new_platform_signup()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  requested_role text;
  safe_role public.platform_user_role;
begin
  requested_role := new.raw_user_meta_data ->> 'role';
  safe_role := case
    when requested_role in ('builder', 'company') then requested_role::public.platform_user_role
    else 'customer'::public.platform_user_role
  end;

  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), 'New Operator'),
    safe_role
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_hook on auth.users;
create trigger on_auth_user_created_hook
  after insert on auth.users
  for each row execute function public.handle_new_platform_signup();

create or replace function public.set_my_account_type(requested_role text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
begin
  if requested_role is null or requested_role not in ('customer', 'company', 'builder') then
    raise exception 'Unsupported account type';
  end if;

  update public.profiles
  set role = requested_role::public.platform_user_role,
      updated_at = now()
  where id = (select auth.uid())
    and role <> 'admin'::public.platform_user_role;

  if not found then
    raise exception 'Could not update the signed-in account type';
  end if;
end;
$$;

revoke all on function public.set_my_account_type(text) from public, anon;
grant execute on function public.set_my_account_type(text) to authenticated;

create or replace function public.set_my_profile_name(requested_full_name text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
begin
  if requested_full_name is null
     or char_length(btrim(requested_full_name)) not between 1 and 120 then
    raise exception 'Name must be between 1 and 120 characters';
  end if;

  update public.profiles
  set full_name = btrim(requested_full_name),
      updated_at = now()
  where id = (select auth.uid());

  if not found then
    raise exception 'Could not update the signed-in profile';
  end if;
end;
$$;

revoke all on function public.set_my_profile_name(text) from public, anon;
grant execute on function public.set_my_profile_name(text) to authenticated;

create or replace function public.update_my_approved_builder_profile(
  requested_business_name text,
  requested_age smallint,
  requested_phone text,
  requested_skills text[],
  requested_work_experience text,
  requested_country text,
  requested_location text,
  requested_portfolio_url text,
  requested_certificate_paths text[]
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  account_id uuid := (select auth.uid());
begin
  if account_id is null
     or not public.has_platform_role('builder'::public.platform_user_role)
     or not exists (
       select 1
       from public.builder_profiles
       where id = account_id and is_approved
     ) then
    raise exception 'Only approved builders can update their profile';
  end if;

  if requested_business_name is null
     or char_length(btrim(requested_business_name)) not between 1 and 120
     or requested_age is null
     or requested_age not between 1 and 120
     or requested_phone is null
     or char_length(btrim(requested_phone)) not between 1 and 40
     or requested_skills is null
     or cardinality(requested_skills) = 0
     or requested_work_experience is null
     or char_length(btrim(requested_work_experience)) not between 1 and 5000
     or requested_country is null
     or char_length(btrim(requested_country)) not between 1 and 100
     or requested_location is null
     or char_length(btrim(requested_location)) not between 1 and 120
     or (requested_portfolio_url is not null
       and (char_length(requested_portfolio_url) > 500
         or requested_portfolio_url !~ '^https?://')) then
    raise exception 'One or more builder profile fields are invalid';
  end if;

  if requested_certificate_paths is null
     or exists (
       select 1
       from unnest(requested_certificate_paths) as certificate(path)
       where split_part(certificate.path, '/', 1) <> account_id::text
          or split_part(certificate.path, '/', 2) = ''
          or certificate.path like '%/%/%'
          or not exists (
            select 1
            from storage.objects
            where bucket_id = 'builder-private-documents'
              and name = certificate.path
          )
     ) then
    raise exception 'Certificate files must belong to your private builder profile';
  end if;

  update public.builder_profiles
  set business_name = btrim(requested_business_name),
      age = requested_age,
      phone = btrim(requested_phone),
      skills = requested_skills,
      work_experience = btrim(requested_work_experience),
      country = btrim(requested_country),
      location = btrim(requested_location),
      portfolio_url = nullif(btrim(requested_portfolio_url), ''),
      certificate_paths = requested_certificate_paths
  where id = account_id and is_approved;

  if not found then
    raise exception 'Your builder approval changed before the profile could be saved';
  end if;
end;
$$;

revoke all on function public.update_my_approved_builder_profile(
  text, smallint, text, text[], text, text, text, text, text[]
) from public, anon;
grant execute on function public.update_my_approved_builder_profile(
  text, smallint, text, text[], text, text, text, text, text[]
) to authenticated;

-- The sample signup trigger trusted user-editable metadata. Clear any admin
-- roles it may have granted, without demoting manually promoted accounts.
update public.profiles as profile
set role = 'customer',
    updated_at = now()
from auth.users as auth_user
where profile.id = auth_user.id
  and profile.role = 'admin'
  and auth_user.raw_user_meta_data ->> 'role' = 'admin';

create or replace function public.can_read_chatter_attachment(object_name text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
  select public.has_platform_role('admin'::public.platform_user_role)
    or (
      public.has_approved_builder_profile()
      and exists (
        select 1
        from public.chatter_box_messages as message
        where message.attachment_url = object_name
          and (
            message.sender_id = (select auth.uid())
            or message.receiver_id = (select auth.uid())
          )
      )
    );
$$;

revoke all on function public.can_read_chatter_attachment(text) from public, anon;
grant execute on function public.can_read_chatter_attachment(text) to authenticated;

alter table public.profiles enable row level security;
alter table public.builder_profiles enable row level security;
alter table public.chatter_box_messages enable row level security;

-- Remove the permissive development policies from the sample schema.
drop policy if exists "Allow public profile select loops" on public.profiles;
drop policy if exists "Allow individual profile mutations" on public.profiles;
drop policy if exists "Allow open builder reads" on public.builder_profiles;
drop policy if exists "Allow builder profile insertions" on public.builder_profiles;
drop policy if exists "Allow unrestricted administrative controls" on public.builder_profiles;
drop policy if exists "Allow open access to dialogue exchanges" on public.chatter_box_messages;
drop policy if exists "Allow programmatic packet streaming injections" on public.chatter_box_messages;

drop policy if exists "profiles_select_self_or_admin" on public.profiles;
create policy "profiles_select_self_or_admin"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.has_platform_role('admin'::public.platform_user_role));

drop policy if exists "builder_profiles_select_owner_or_admin" on public.builder_profiles;
create policy "builder_profiles_select_owner_or_admin"
  on public.builder_profiles for select to authenticated
  using (id = (select auth.uid()) or public.has_platform_role('admin'::public.platform_user_role));

drop policy if exists "builder_profiles_insert_own_builder" on public.builder_profiles;
create policy "builder_profiles_insert_own_builder"
  on public.builder_profiles for insert to authenticated
  with check (
    id = (select auth.uid())
    and public.has_platform_role('builder'::public.platform_user_role)
    and is_approved = false
  );

drop policy if exists "builder_profiles_update_admin_only" on public.builder_profiles;
create policy "builder_profiles_update_admin_only"
  on public.builder_profiles for update to authenticated
  using (public.has_platform_role('admin'::public.platform_user_role))
  with check (public.has_platform_role('admin'::public.platform_user_role));

drop policy if exists "builder_profiles_update_approved_owner" on public.builder_profiles;
create policy "builder_profiles_update_approved_owner"
  on public.builder_profiles for update to authenticated
  using (id = (select auth.uid()) and is_approved)
  with check (id = (select auth.uid()) and is_approved);

drop policy if exists "chatter_messages_select_participant" on public.chatter_box_messages;
create policy "chatter_messages_select_participant"
  on public.chatter_box_messages for select to authenticated
  using (
    public.has_platform_role('admin'::public.platform_user_role)
    or (
      public.has_approved_builder_profile()
      and (
        sender_id = (select auth.uid())
        or receiver_id = (select auth.uid())
      )
    )
  );

drop policy if exists "chatter_messages_insert_approved_sender" on public.chatter_box_messages;
create policy "chatter_messages_insert_approved_sender"
  on public.chatter_box_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and public.has_approved_builder_profile()
    and (
      nullif(btrim(message_content), '') is not null
      or attachment_url is not null
    )
    and (
      message_content is null
      or char_length(message_content) <= 200
    )
  );

grant select on public.profiles to authenticated;
grant select, insert on public.builder_profiles to authenticated;
grant select, insert on public.chatter_box_messages to authenticated;
revoke all on public.profiles, public.builder_profiles, public.chatter_box_messages from public, anon;
revoke update on public.builder_profiles from public, anon, authenticated;
grant update (is_approved) on public.builder_profiles to authenticated;

-- Private storage: ID documents and certificates are never public.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'builder-private-documents',
  'builder-private-documents',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = excluded.allowed_mime_types;

-- Private chat files are limited to 5 MiB. The frontend creates signed URLs
-- after checking that the current user participates in the associated message.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chatter-box-attachments',
  'chatter-box-attachments',
  false,
  5242880,
  array['application/pdf', 'image/jpeg', 'image/png', 'text/plain',
        'application/zip', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do update
set public = false,
    file_size_limit = 5242880,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "builder_documents_insert_own" on storage.objects;
create policy "builder_documents_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'builder-private-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.has_platform_role('builder'::public.platform_user_role)
  );

drop policy if exists "builder_documents_read_own_or_admin" on storage.objects;
create policy "builder_documents_read_own_or_admin"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'builder-private-documents'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.has_platform_role('admin'::public.platform_user_role)
    )
  );

drop policy if exists "builder_documents_delete_own_or_admin" on storage.objects;
create policy "builder_documents_delete_own_or_admin"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'builder-private-documents'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.has_platform_role('admin'::public.platform_user_role)
    )
  );

drop policy if exists "chatter_attachments_insert_approved_sender" on storage.objects;
create policy "chatter_attachments_insert_approved_sender"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chatter-box-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.has_approved_builder_profile()
  );

drop policy if exists "chatter_attachments_read_message_participant" on storage.objects;
create policy "chatter_attachments_read_message_participant"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'chatter-box-attachments'
    and public.can_read_chatter_attachment(name)
  );

drop policy if exists "chatter_attachments_delete_own_or_admin" on storage.objects;
create policy "chatter_attachments_delete_own_or_admin"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'chatter-box-attachments'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.has_platform_role('admin'::public.platform_user_role)
    )
  );

-- Enable row changes for authenticated Realtime subscriptions, without adding
-- the table twice when this setup is re-run.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'chatter_box_messages'
     )
  then
    alter publication supabase_realtime add table public.chatter_box_messages;
  end if;
end
$$;

-- Promote the first administrator manually in the SQL Editor after signup:
-- update public.profiles set role = 'admin' where id = '<trusted-auth-user-uuid>';

-- Content publishing, public media, and the website contact inbox.
create table if not exists public.site_updates (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 3 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  excerpt text not null check (char_length(btrim(excerpt)) between 3 and 300),
  body text not null check (char_length(btrim(body)) between 3 and 20000),
  category text not null default 'News' check (char_length(btrim(category)) between 2 and 40),
  cover_image_url text,
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists site_updates_published_created_idx
  on public.site_updates (published_at desc)
  where status = 'published';

create table if not exists public.footer_links (
  key text primary key check (
    key in ('visit', 'map', 'events', 'jobs', 'contact', 'privacy', 'terms', 'accessibility', 'social-media-hub')
  ),
  label text not null check (char_length(btrim(label)) between 2 and 60),
  href text not null default '' check (
    char_length(href) <= 500
    and (href = '' or href ~* '^(https?://|mailto:|tel:|/|\?|#)')
  ),
  position smallint not null unique check (position between 1 and 9),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.footer_links (key, label, href, position)
values
  ('visit', 'Visit', '?page=about#about', 1),
  ('map', 'Map', '', 2),
  ('events', 'Events', '?page=insights#insights', 3),
  ('jobs', 'Jobs', '?page=opportunities#opportunities', 4),
  ('contact', 'Contact', '?page=contact#contact', 5),
  ('privacy', 'Privacy', '', 6),
  ('terms', 'Terms', '', 7),
  ('accessibility', 'Accessibility', '', 8),
  ('social-media-hub', 'Social Media Hub', '', 9)
on conflict (key) do nothing;

create table if not exists public.media_assets (
  path text primary key,
  public_url text not null,
  original_name text not null check (char_length(original_name) between 1 and 255),
  mime_type text not null check (
    mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm')
  ),
  size_bytes bigint not null check (size_bytes between 1 and 26214400),
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.contact_submissions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  email text not null check (
    char_length(email) between 5 and 254
    and email ~* '^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
  ),
  inquiry text not null check (
    inquiry in (
      'Digital product or website',
      'Hardware installation or support',
      'Partnership',
      'Builder network',
      'Something else'
    )
  ),
  message text not null check (char_length(btrim(message)) between 5 and 5000),
  status text not null default 'new' check (status in ('new', 'in_progress', 'resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contact_submissions_status_created_idx
  on public.contact_submissions (status, created_at desc);

create or replace function public.set_content_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.set_site_update_timestamps()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    new.published_at := now();
  elsif new.status <> 'published' then
    new.published_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists site_updates_set_updated_at on public.site_updates;
create trigger site_updates_set_updated_at
  before insert or update on public.site_updates
  for each row execute function public.set_site_update_timestamps();

drop trigger if exists contact_submissions_set_updated_at on public.contact_submissions;
create trigger contact_submissions_set_updated_at
  before update on public.contact_submissions
  for each row execute function public.set_content_updated_at();

alter table public.site_updates enable row level security;
alter table public.footer_links enable row level security;
alter table public.media_assets enable row level security;
alter table public.contact_submissions enable row level security;

drop policy if exists "site_updates_read_published" on public.site_updates;
create policy "site_updates_read_published"
  on public.site_updates for select to anon, authenticated
  using (status = 'published');

drop policy if exists "site_updates_admin_manage" on public.site_updates;
create policy "site_updates_admin_manage"
  on public.site_updates for all to authenticated
  using (public.has_platform_role('admin'::public.platform_user_role))
  with check (public.has_platform_role('admin'::public.platform_user_role));

drop policy if exists "footer_links_read_enabled" on public.footer_links;
create policy "footer_links_read_enabled"
  on public.footer_links for select to anon, authenticated
  using (enabled);

drop policy if exists "footer_links_admin_manage" on public.footer_links;
create policy "footer_links_admin_manage"
  on public.footer_links for all to authenticated
  using (public.has_platform_role('admin'::public.platform_user_role))
  with check (public.has_platform_role('admin'::public.platform_user_role));

drop policy if exists "media_assets_admin_manage" on public.media_assets;
create policy "media_assets_admin_manage"
  on public.media_assets for all to authenticated
  using (public.has_platform_role('admin'::public.platform_user_role))
  with check (public.has_platform_role('admin'::public.platform_user_role));

drop policy if exists "contact_submissions_public_insert" on public.contact_submissions;
create policy "contact_submissions_public_insert"
  on public.contact_submissions for insert to anon, authenticated
  with check (status = 'new');

drop policy if exists "contact_submissions_admin_manage" on public.contact_submissions;
create policy "contact_submissions_admin_manage"
  on public.contact_submissions for all to authenticated
  using (public.has_platform_role('admin'::public.platform_user_role))
  with check (public.has_platform_role('admin'::public.platform_user_role));

grant select on public.site_updates to anon, authenticated;
grant insert, update, delete on public.site_updates to authenticated;
grant select on public.footer_links to anon, authenticated;
grant insert, update, delete on public.footer_links to authenticated;
grant select, insert, update, delete on public.media_assets to authenticated;
grant insert on public.contact_submissions to anon, authenticated;
grant select, update on public.contact_submissions to authenticated;
revoke all on public.site_updates, public.footer_links, public.media_assets, public.contact_submissions from public;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-media',
  'site-media',
  true,
  26214400,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']
)
on conflict (id) do update
set public = true,
    file_size_limit = 26214400,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "site_media_public_read" on storage.objects;
create policy "site_media_public_read"
  on storage.objects for select to public
  using (bucket_id = 'site-media');

drop policy if exists "site_media_admin_insert" on storage.objects;
create policy "site_media_admin_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'site-media'
    and public.has_platform_role('admin'::public.platform_user_role)
  );

drop policy if exists "site_media_admin_update" on storage.objects;
create policy "site_media_admin_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'site-media'
    and public.has_platform_role('admin'::public.platform_user_role)
  )
  with check (
    bucket_id = 'site-media'
    and public.has_platform_role('admin'::public.platform_user_role)
  );

drop policy if exists "site_media_admin_delete" on storage.objects;
create policy "site_media_admin_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'site-media'
    and public.has_platform_role('admin'::public.platform_user_role)
  );
