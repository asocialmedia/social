// query: state.read
SELECT value FROM verification WHERE id = $1 AND identifier = $2
     AND "expiresAt" > NOW(){{lock}}

// query: state.update
UPDATE verification SET value = $3, "updatedAt" = NOW()
     WHERE id = $1 AND identifier = $4 AND value = $2 AND "expiresAt" > NOW()

// query: state.delete
DELETE FROM verification WHERE id = $1 AND identifier = $2

// query: resolution.fingerprint
SELECT jsonb_build_object('email', u.email, 'verified', u."emailVerified",
       'banned', u.banned, 'role', u.role, 'twoFactorEnabled', u."twoFactorEnabled",
       'credentials', (SELECT jsonb_agg(jsonb_build_array(a.id, a.password, a."providerId", a."accountId") ORDER BY a.id) FROM accounts a WHERE a."userId" = u.id),
       'twoFactor', (SELECT jsonb_agg(jsonb_build_array(t.id, t.secret, t."backupCodes") ORDER BY t.id) FROM "twoFactor" t WHERE t."userId" = u.id))::text AS fingerprint
     FROM users u WHERE u.id = $1

// query: resolution.summary
SELECT (SELECT COUNT(*)::int FROM posts WHERE "userId" = $1) AS posts,
       (SELECT COUNT(*)::int FROM comments WHERE "userId" = $1) AS comments,
       (SELECT COUNT(*)::int FROM communities WHERE "ownerId" = $1) AS communities,
       (EXISTS(SELECT 1 FROM message_conversation_members WHERE "userId" = $1)
        OR EXISTS(SELECT 1 FROM messages WHERE "senderId" = $1)
        OR EXISTS(SELECT 1 FROM message_conversation_keys WHERE "ownerUserId" = $1 OR "wrapperUserId" = $1)) AS "privateHistory",
       EXISTS(SELECT 1 FROM message_conversations WHERE "ownerId" = $1) AS "ownsDen"

// query: resolution.preserveMembershipStatus
UPDATE community_members kept SET status = lost.status FROM community_members lost
    WHERE kept."userId" = $2 AND lost."userId" = $1 AND kept."communityId" = lost."communityId"
    AND lost.status::text <> 'ACTIVE'

// query: resolution.preserveMembershipRole
UPDATE community_members kept SET role = lost.role FROM community_members lost
    WHERE kept."userId" = $2 AND lost."userId" = $1 AND kept."communityId" = lost."communityId"
    AND (CASE lost.role::text WHEN 'OWNER' THEN 4 WHEN 'MODERATOR' THEN 3 WHEN 'MEMBER' THEN 2 ELSE 1 END)
      > (CASE kept.role::text WHEN 'OWNER' THEN 4 WHEN 'MODERATOR' THEN 3 WHEN 'MEMBER' THEN 2 ELSE 1 END)

// query: resolution.deduplicateRelation
DELETE FROM "{{table}}" lost USING "{{table}}" kept WHERE lost."userId" = $1 AND kept."userId" = $2 AND lost."{{key}}" = kept."{{key}}"

// query: resolution.transferRelation
UPDATE "{{table}}" SET "userId" = $2 WHERE "userId" = $1

// query: resolution.transferCommunityOwnerRole
UPDATE community_members SET role = 'OWNER' WHERE "userId" = $2 AND "communityId" IN (SELECT id FROM communities WHERE "ownerId" IN ($1, $2))

// query: resolution.removeSelfRelation
DELETE FROM "{{table}}" WHERE "{{first}}" IN ($1, $2) AND "{{second}}" IN ($1, $2)

// query: resolution.deduplicateSocialRelation
DELETE FROM "{{table}}" lost USING "{{table}}" kept WHERE lost."{{field}}" = $1 AND kept."{{field}}" = $2 AND lost."{{other}}" = kept."{{other}}"

// query: resolution.transferSocialRelation
UPDATE "{{table}}" SET "{{field}}" = $2 WHERE "{{field}}" = $1

// query: resolution.transferContentOwner
UPDATE "{{table}}" SET "{{field}}" = $2 WHERE "{{field}}" = $1

// query: resolution.combineAura
UPDATE users kept SET aura = kept.aura + lost.aura FROM users lost WHERE kept.id = $2 AND lost.id = $1

// query: resolution.userReferences
SELECT relation.relname AS "tableName", attribute.attname AS "columnName" FROM pg_constraint constraint_row
     JOIN pg_class relation ON relation.oid = constraint_row.conrelid
     JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
     JOIN pg_attribute attribute ON attribute.attrelid = relation.oid AND attribute.attnum = ANY(constraint_row.conkey)
     WHERE constraint_row.contype = 'f' AND constraint_row.confrelid = 'public.users'::regclass AND namespace.nspname = 'public'

// query: resolution.remainingReference
SELECT EXISTS(SELECT 1 FROM "{{table}}" WHERE "{{column}}" = $1) AS present

// query: resolution.lockTimeout
SET LOCAL lock_timeout = '5s'

// query: resolution.lockUsers
SELECT id FROM users WHERE id IN ($1, $2) ORDER BY id FOR UPDATE

// query: resolution.lockAccounts
SELECT id FROM accounts WHERE "userId" IN ($1, $2) ORDER BY id FOR UPDATE

// query: resolution.lockTwoFactor
SELECT id FROM "twoFactor" WHERE "userId" IN ($1, $2) ORDER BY id FOR UPDATE

// query: resolution.transferOAuth
UPDATE accounts SET "userId" = $2, "updatedAt" = NOW() WHERE "userId" = $1 AND "providerId" <> 'credential'

// query: resolution.clearProviderMirrors
UPDATE users SET "googleId" = NULL, "redditId" = NULL WHERE id = $1

// query: resolution.refreshProviderMirror
UPDATE users SET "{{field}}" = (SELECT "accountId" FROM accounts WHERE "userId" = $1 AND "providerId" = $2 ORDER BY "createdAt", id LIMIT 1) WHERE id = $1

// query: resolution.revokeSessions
DELETE FROM sessions WHERE "userId" IN ($1, $2)

// query: resolution.revokeVerifications
DELETE FROM verification WHERE "userId" IN ($1, $2) OR strpos(value, $1) > 0 OR strpos(value, $2) > 0

// query: resolution.retireUser
DELETE FROM users WHERE id = $1

// query: resolution.reserveUsername
INSERT INTO username_aliases (id, "userId", username, "createdAt", "expiresAt") VALUES ($1, $2, $3, NOW(), NOW() + INTERVAL '30 days') ON CONFLICT (username) DO NOTHING
