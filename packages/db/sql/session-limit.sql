// query: enforceAccountSessionLimit.lockUser
SELECT "id" FROM public.users WHERE "id" = $1 FOR UPDATE
