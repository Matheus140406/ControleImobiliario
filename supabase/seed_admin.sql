-- Cria a conta inicial do administrador via Supabase Auth.
-- Já executado no projeto "controle-imobiliario" (id: kebinpqppoaftqeqoyjp).
--
-- Credenciais:
--   Email: imobiliariaedu2026@gmail.com
--   Senha: Café1234#
--
-- Alternativa recomendada para novos ambientes: use o SQL Editor do
-- Supabase Studio ou a Admin API (`supabase.auth.admin.createUser`, com a
-- service_role key, executada só no servidor) em vez deste script — inserir
-- direto em auth.users é um workaround para quando não há acesso à service_role key.
do $$
declare
  new_user_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000',
    new_user_id,
    'authenticated',
    'authenticated',
    'imobiliariaedu2026@gmail.com',
    crypt('Café1234#', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(), now(), '', '', '', ''
  );

  insert into auth.identities (
    id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(),
    new_user_id::text,
    new_user_id,
    jsonb_build_object('sub', new_user_id::text, 'email', 'imobiliariaedu2026@gmail.com'),
    'email',
    now(), now(), now()
  );
end $$;
