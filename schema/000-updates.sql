BEGIN;

-- requires_group_id changed to NULL, we don't specify accept_terms here
DO
$do$
BEGIN
   IF EXISTS (SELECT *
                FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND table_name = 'syllabus'
                 AND column_name = 'requires_group_id'
                 AND is_nullable = 'NO') THEN
       ALTER TABLE syllabus
           ALTER COLUMN requires_group_id DROP DEFAULT,
           ALTER COLUMN requires_group_id DROP NOT NULL;
       UPDATE syllabus
          SET requires_group_id = NULL
        WHERE requires_group_id = get_group_id('accept_terms');
   END IF;
END
$do$;

-- ugmaterial table was never finished, get rid of it
DROP TABLE IF EXISTS ugmaterial;

-- dataframe table not used, we just use existence on the path
DROP TABLE IF EXISTS dataframe;

-- If ug_question_id sequence still exists, drop it and adapt existing permutation column
DO
$do$
BEGIN
   IF NOT EXISTS (SELECT *
                FROM information_schema.sequences
               WHERE sequence_schema = 'public'
                 AND sequence_name = 'ug_question_id') THEN
       -- Nothing to do, exit.
       RETURN;
   END IF;

   -- Make a backup of the answer table
   CREATE TABLE answer_2019_04 AS SELECT * FROM answer;

   -- Regenerate permutation column for all template questions / examples
   WITH answer_new_perm AS (
       SELECT answer_id
            , CASE WHEN answer_id = MIN(answer_id) OVER (PARTITION BY a.material_source_id, a.permutation)
                   THEN 1  -- Should be the question
                   ELSE 0 - MIN(answer_id) OVER (PARTITION BY a.material_source_id, a.permutation)
                    END new_perm
         FROM answer a
        WHERE material_source_id IN (SELECT material_source_id FROM material_source WHERE 'type.template' = ANY(material_tags))
   )
   UPDATE answer
      SET permutation = answer_new_perm.new_perm
     FROM answer_new_perm
    WHERE answer_new_perm.answer_id = answer.answer_id;

   -- Drop the now-unused sequence
   DROP SEQUENCE ug_question_id;
END
$do$;

-- INTEGER too small for Milli-SMLY amounts
DO
$do$
BEGIN
    IF NOT EXISTS (SELECT *
                   FROM information_schema.columns
                  WHERE table_schema = 'public'
                    AND table_name = 'answer'
                    AND column_name = 'coins_awarded'
                    AND data_type = 'integer') THEN
        -- Nothing to do, exit.
        RETURN;
    END IF;

    -- Have to remove dependent views for this to work
    DROP VIEW coin_unclaimed;
    DROP VIEW stage_ugmaterial;
    ALTER TABLE public.answer ALTER COLUMN coins_awarded TYPE BIGINT;
END
$do$;


COMMIT;
