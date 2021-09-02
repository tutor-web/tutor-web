BEGIN;


-- Answers
CREATE TABLE IF NOT EXISTS answer (
    answer_id                SERIAL PRIMARY KEY,

    stage_id                 INTEGER NOT NULL,
    FOREIGN KEY (stage_id) REFERENCES stage(stage_id),
    user_id                  INTEGER,
    FOREIGN KEY (user_id) REFERENCES "user"(user_id),

    material_source_id       INTEGER,
    permutation              INTEGER,
    client_id                TEXT NOT NULL,
    time_start               TIMESTAMP WITHOUT TIME ZONE,  -- NB: Always UTC
    time_end                 TIMESTAMP WITHOUT TIME ZONE,  -- NB: Always UTC
    time_offset              INTEGER NOT NULL DEFAULT 0,

    correct                  BOOLEAN NULL,
    grade                    NUMERIC(5, 3) NOT NULL,
    coins_awarded            INTEGER NOT NULL DEFAULT 0,

    student_answer           JSONB,
    review                   JSONB
);
CREATE INDEX IF NOT EXISTS answer_stage_id ON answer(stage_id);
CREATE INDEX IF NOT EXISTS answer_user_id ON answer(user_id);  -- For coin_unclaimed view
CREATE INDEX IF NOT EXISTS answer_mss_permutation ON answer(material_source_id, permutation);  -- For picking out UG material
COMMENT ON TABLE  answer IS 'Raw answer objects synced from client';
COMMENT ON COLUMN answer.time_start IS 'When the student started answering, in UTC';
COMMENT ON COLUMN answer.time_end IS 'When the student finished answering, in UTC';
COMMENT ON COLUMN answer.time_offset IS 'Difference between server and client UTC time, to nearest 10s';
COMMENT ON COLUMN answer.coins_awarded IS 'SMLY awarded for this question, in milli-SMLY';
COMMENT ON COLUMN answer.student_answer IS 'The student_answer object, i.e. the raw form selections';
COMMENT ON COLUMN answer.review IS 'The students review of the material, if they did one';


CREATE OR REPLACE VIEW answer_stats AS
    SELECT a.stage_id
         , a.material_source_id
         , a.permutation
         , COUNT(*) answered
         , COUNT(NULLIF(a.correct, false)) correct
    FROM answer a
    GROUP BY 1, 2, 3;
COMMENT ON VIEW answer_stats IS 'Answer stats for each stage/material_source/permutation combo';


CREATE OR REPLACE VIEW stage_material AS
    SELECT s.stage_id
         , ms.material_source_id
         , GENERATE_SERIES(1, ms.permutation_count) "permutation"
         , ms.initial_answered
         , ms.initial_correct
    FROM stage s
    JOIN material_source ms
      ON s.material_tags <@ ms.material_tags
    WHERE ms.next_material_source_id IS NULL
      AND s.next_stage_id IS NULL;
COMMENT ON VIEW stage_material IS 'All appropriate current material for all current stages, and their stats';


CREATE OR REPLACE VIEW stage_material_sources AS
    SELECT s.stage_id
         , ms.material_source_id
         , ms.material_tags
    FROM stage s
    JOIN material_source ms
      ON s.material_tags <@ ms.material_tags;
COMMENT ON VIEW stage_material_sources IS 'All appropriate material for all stages, including historical';


CREATE OR REPLACE VIEW stage_ugmaterial AS
    SELECT DISTINCT ON (CASE WHEN a.permutation < 0 THEN 0 - a.permutation ELSE a.answer_id END)
    a.*
    , JSONB_AGG(JSONB_BUILD_ARRAY(user_id, review)) OVER curqn AS reviews
    FROM answer a
    WINDOW curqn AS (
        -- i.e. all rows dealing with the current question
        PARTITION BY CASE WHEN a.permutation < 0 THEN 0 - a.permutation ELSE a.answer_id END
        ORDER BY CASE WHEN a.permutation < 0 THEN 0 - a.permutation ELSE a.answer_id END, a.time_end, a.answer_id
        ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING
    )
    ORDER BY CASE WHEN a.permutation < 0 THEN 0 - a.permutation ELSE a.answer_id END, a.time_end, a.answer_id;
COMMENT ON VIEW stage_ugmaterial IS 'All user-generated content and reviews against them';

COMMIT;
