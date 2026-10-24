-- Ref Pocket : permet de voir la collection d'un AMI (et seulement d'un ami accepté).
-- À coller dans l'éditeur SQL de Supabase. Ne change rien aux règles d'accès existantes.

create or replace function public.friend_collection(p_friend uuid)
returns table(card_id text, total int, holos int, libres int)
language sql
security definer
set search_path = public
stable
as $$
  select ci.card_id::text,
         count(*)::int,
         count(*) filter (where ci.holo)::int,
         count(*) filter (where not coalesce(ci."lock", false))::int
  from card_instances ci
  where ci.owner = p_friend
    and exists (
      select 1 from friendships f
      where f.status = 'accepted'
        and ((f.requester = auth.uid() and f.addressee = p_friend)
          or (f.addressee = auth.uid() and f.requester = p_friend))
    )
  group by ci.card_id;
$$;

revoke all on function public.friend_collection(uuid) from public, anon;
grant execute on function public.friend_collection(uuid) to authenticated;
