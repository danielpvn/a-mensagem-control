-- =====================================================================
-- A Mensagem Control - banco online (biblioteca compartilhada)
-- Cole tudo no Supabase: menu "SQL Editor" > "New query" > Run.
-- Pode rodar de novo sem problema (não apaga dados).
-- =====================================================================

-- ---------- Quem pode fazer o quê ----------
-- Cada login ganha uma linha aqui. Papéis:
--   'pending' = pediu acesso pelo app e espera aprovação (não recebe nada)
--   'reader'  = recebe a biblioteca
--   'editor'  = também publica para todas as igrejas e aprova os pedidos de acesso
--   'blocked' = acesso retirado
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  church text,
  role text not null default 'pending',
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text;
alter table public.profiles alter column role set default 'pending';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('pending', 'reader', 'editor', 'blocked'));

-- Todo login novo (pedido de acesso pelo app ou criado no painel) nasce aguardando aprovação.
-- O nome da igreja vem do formulário "Pedir acesso" do app.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, email, church, role)
  values (new.id, new.email, nullif(trim(new.raw_user_meta_data ->> 'church'), ''), 'pending')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Logins que já existiam antes deste script (os que já tinham perfil mantêm o papel)
insert into public.profiles (user_id, email) select id, email from auth.users on conflict do nothing;
update public.profiles p set email = u.email from auth.users u where p.user_id = u.id and p.email is null;

create or replace function public.is_editor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where user_id = auth.uid() and role = 'editor');
$$;

-- Leitor ou editor aprovado
create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where user_id = auth.uid() and role in ('reader', 'editor'));
$$;

-- ---------- Biblioteca ----------
-- Nada é apagado de verdade: "deleted = true" avisa os outros computadores para apagar também.

create table if not exists public.library_sermons (
  id text primary key,
  title text not null,
  date text,
  paragraphs jsonb not null default '[]'::jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

create table if not exists public.library_hymns (
  uid text primary key,
  number text,
  title text not null,
  collection text,
  auto_chorus boolean not null default true,
  lyrics text not null default '',
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

create table if not exists public.library_backgrounds (
  name text primary key,
  size bigint,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

create index if not exists library_sermons_updated on public.library_sermons (updated_at);
create index if not exists library_hymns_updated on public.library_hymns (updated_at);
create index if not exists library_backgrounds_updated on public.library_backgrounds (updated_at);

-- A hora da alteração é sempre a do servidor (os relógios dos PCs podem estar errados)
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists touch_sermons on public.library_sermons;
create trigger touch_sermons before insert or update on public.library_sermons
  for each row execute function public.touch_updated_at();
drop trigger if exists touch_hymns on public.library_hymns;
create trigger touch_hymns before insert or update on public.library_hymns
  for each row execute function public.touch_updated_at();
drop trigger if exists touch_backgrounds on public.library_backgrounds;
create trigger touch_backgrounds before insert or update on public.library_backgrounds
  for each row execute function public.touch_updated_at();

-- ---------- Permissões da API ----------
-- Necessárias se "Automatically expose new tables" estiver desmarcado no projeto.
-- Quem não fez login (anon) não recebe nada; o que cada login pode fazer é decidido pelo RLS abaixo.
revoke all on public.profiles, public.library_sermons, public.library_hymns, public.library_backgrounds from anon;
grant select on public.profiles to authenticated;
grant update (role, church) on public.profiles to authenticated;
grant select, insert, update on public.library_sermons, public.library_hymns, public.library_backgrounds to authenticated;

-- ---------- Regras de acesso (RLS) ----------
-- Sem login, ninguém lê nada (os hinos e as Mensagens têm direitos autorais).
alter table public.profiles enable row level security;
alter table public.library_sermons enable row level security;
alter table public.library_hymns enable row level security;
alter table public.library_backgrounds enable row level security;

-- Cada um vê o próprio perfil; editores veem todos (para aprovar os pedidos de acesso)
drop policy if exists "ver o proprio perfil" on public.profiles;
create policy "ver o proprio perfil" on public.profiles
  for select to authenticated using (user_id = auth.uid() or public.is_editor());

-- Só editores mudam papéis (aprovar, recusar, tirar acesso)
drop policy if exists "editores aprovam" on public.profiles;
create policy "editores aprovam" on public.profiles
  for update to authenticated using (public.is_editor()) with check (public.is_editor());

do $$
declare t text;
begin
  foreach t in array array['library_sermons', 'library_hymns', 'library_backgrounds'] loop
    execute format('drop policy if exists "logados leem" on public.%I', t);
    execute format('drop policy if exists "aprovados leem" on public.%I', t);
    execute format('create policy "aprovados leem" on public.%I for select to authenticated using (public.is_member())', t);
    execute format('drop policy if exists "editores inserem" on public.%I', t);
    execute format('create policy "editores inserem" on public.%I for insert to authenticated with check (public.is_editor())', t);
    execute format('drop policy if exists "editores alteram" on public.%I', t);
    execute format('create policy "editores alteram" on public.%I for update to authenticated using (public.is_editor()) with check (public.is_editor())', t);
  end loop;
end $$;

-- ---------- Arquivos das imagens de fundo ----------
insert into storage.buckets (id, name, public)
values ('backgrounds', 'backgrounds', false)
on conflict (id) do nothing;

drop policy if exists "logados baixam fundos" on storage.objects;
drop policy if exists "aprovados baixam fundos" on storage.objects;
create policy "aprovados baixam fundos" on storage.objects
  for select to authenticated using (bucket_id = 'backgrounds' and public.is_member());

drop policy if exists "editores enviam fundos" on storage.objects;
create policy "editores enviam fundos" on storage.objects
  for insert to authenticated with check (bucket_id = 'backgrounds' and public.is_editor());

drop policy if exists "editores trocam fundos" on storage.objects;
create policy "editores trocam fundos" on storage.objects
  for update to authenticated using (bucket_id = 'backgrounds' and public.is_editor());

-- =====================================================================
-- As igrejas pedem acesso pelo próprio app (Configurações > Banco online > Pedir acesso)
-- e um editor aprova no app dele. Só o PRIMEIRO editor precisa ser definido aqui
-- (troque o e-mail):
--
--   update public.profiles set role = 'editor', church = 'Tabernáculo da Fé - Luziânia'
--   where user_id = (select id from auth.users where email = 'seu-email@exemplo.com');
-- =====================================================================
