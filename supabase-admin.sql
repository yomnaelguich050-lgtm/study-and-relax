-- =====================================================================
-- supabase-admin.sql — attribuer le rôle admin à UN utilisateur existant
--
-- À exécuter dans SQL Editor (jamais depuis le navigateur), APRÈS :
--   - supabase-setup.sql
--   - la création du compte via signup.html (et la confirmation de l'e-mail)
--
-- 1) Authentication > Users : copiez l'UUID de l'utilisateur.
-- 2) Remplacez VOTRE-UUID ci-dessous (en gardant les apostrophes).
-- Relançable : si la ligne existe déjà, elle est simplement confirmée.
-- Pour retirer le rôle :  delete from public.user_roles where user_id = 'VOTRE-UUID';
-- =====================================================================

insert into public.user_roles (user_id, role)
select u.id, 'admin'
from auth.users u
where u.id = 'VOTRE-UUID'::uuid   -- ⚠ remplacer VOTRE-UUID
on conflict (user_id) do update set role = 'admin';

-- Vérification : doit renvoyer 1 ligne
select u.id, u.email, r.role
from public.user_roles r
join auth.users u on u.id = r.user_id;
