-- Tabela de imóveis + RLS
-- Já aplicado no projeto Supabase "controle-imobiliario" (id: kebinpqppoaftqeqoyjp).
-- Mantido aqui como referência/versão do schema.

create table if not exists public.imoveis (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  titulo text not null,
  descricao text,
  preco numeric(12,2) not null default 0,
  tipo text not null,
  fotos_urls text[] not null default '{}',
  status text not null default 'disponivel' check (status in ('disponivel', 'vendido', 'alugado', 'reservado'))
);

alter table public.imoveis enable row level security;

-- Leitura pública dos imóveis
create policy "Leitura publica de imoveis"
  on public.imoveis for select
  to anon, authenticated
  using (true);

-- Apenas usuários autenticados podem criar, editar ou excluir
create policy "Usuarios autenticados podem criar imoveis"
  on public.imoveis for insert
  to authenticated
  with check (true);

create policy "Usuarios autenticados podem editar imoveis"
  on public.imoveis for update
  to authenticated
  using (true)
  with check (true);

create policy "Usuarios autenticados podem excluir imoveis"
  on public.imoveis for delete
  to authenticated
  using (true);
