// query: inviteArmRotationFault.createFaultSeq
CREATE SEQUENCE IF NOT EXISTS {{faultSeq}}
// query: inviteArmRotationFault.createFaultFn

      CREATE OR REPLACE FUNCTION {{faultFn}}() RETURNS trigger
      LANGUAGE plpgsql AS $body$
      BEGIN
        PERFORM nextval('{{faultSeq}}');
        RAISE EXCEPTION 'den rotation denied by test';
      END $body$

// query: inviteArmRotationFault.dropFaultTrigger
DROP TRIGGER IF EXISTS {{faultTrigger}} ON message_conversations
// query: inviteArmRotationFault.createFaultTrigger

      CREATE TRIGGER {{faultTrigger}}
      BEFORE UPDATE ON message_conversations
      FOR EACH ROW
      WHEN (OLD.id = '{{denId}}'
        AND NEW."inviteCode" IS DISTINCT FROM OLD."inviteCode")
      EXECUTE FUNCTION {{faultFn}}()

// query: inviteArmArchiveFault.createFaultSeq
CREATE SEQUENCE IF NOT EXISTS {{faultSeq}}
// query: inviteArmArchiveFault.createFaultFn

      CREATE OR REPLACE FUNCTION {{faultFn}}() RETURNS trigger
      LANGUAGE plpgsql AS $body$
      BEGIN
        PERFORM nextval('{{faultSeq}}');
        RAISE EXCEPTION 'den archive denied by test';
      END $body$

// query: inviteArmArchiveFault.dropArchiveFaultTrigger
DROP TRIGGER IF EXISTS {{archiveFaultTrigger}} ON message_conversation_invite_codes
// query: inviteArmArchiveFault.createArchiveFaultTrigger

      CREATE TRIGGER {{archiveFaultTrigger}}
      BEFORE INSERT ON message_conversation_invite_codes
      FOR EACH ROW
      WHEN (NEW."conversationId" = '{{denId}}')
      EXECUTE FUNCTION {{faultFn}}()

// query: inviteFaultInjectionHits.selectFaultSeq
SELECT last_value FROM {{faultSeq}}
// query: inviteDropFaultInjection.dropFaultTrigger
DROP TRIGGER IF EXISTS {{faultTrigger}} ON message_conversations
// query: inviteDropFaultInjection.dropArchiveFaultTrigger
DROP TRIGGER IF EXISTS {{archiveFaultTrigger}} ON message_conversation_invite_codes
// query: inviteDropFaultInjection.dropFaultFn
DROP FUNCTION IF EXISTS {{faultFn}}()
// query: inviteDropFaultInjection.dropFaultSeq
DROP SEQUENCE IF EXISTS {{faultSeq}}
// query: membershipArmFaultInjection.createFaultSeq
CREATE SEQUENCE IF NOT EXISTS {{faultSeq}}
// query: membershipArmFaultInjection.createFaultFn

      CREATE OR REPLACE FUNCTION {{faultFn}}() RETURNS trigger
      LANGUAGE plpgsql AS $body$
      BEGIN
        IF nextval('{{faultSeq}}') = 1 THEN
          RAISE EXCEPTION
            'could not serialize access due to read/write dependencies among transactions'
            USING ERRCODE = '40001';
        END IF;
        RETURN NEW;
      END $body$

// query: membershipArmFaultInjection.dropFaultTrigger
DROP TRIGGER IF EXISTS {{faultTrigger}} ON message_conversations
// query: membershipArmFaultInjection.createFaultTrigger

      CREATE TRIGGER {{faultTrigger}}
      BEFORE UPDATE ON message_conversations
      FOR EACH ROW
      WHEN (OLD.id = '{{denId}}' AND NEW."membershipSeq" > OLD."membershipSeq")
      EXECUTE FUNCTION {{faultFn}}()

// query: membershipFaultInjectionHits.selectFaultSeq
SELECT last_value FROM {{faultSeq}}
// query: membershipDropFaultInjection.dropFaultTrigger
DROP TRIGGER IF EXISTS {{faultTrigger}} ON message_conversations
// query: membershipDropFaultInjection.dropFaultFn
DROP FUNCTION IF EXISTS {{faultFn}}()
// query: membershipDropFaultInjection.dropFaultSeq
DROP SEQUENCE IF EXISTS {{faultSeq}}
