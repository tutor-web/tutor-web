-- Material bank representation
-- Material: question / example/proof / etc.
BEGIN;

CREATE TABLE IF NOT EXISTS material_source (
    material_source_id       SERIAL PRIMARY KEY,

    bank                     TEXT NOT NULL,
    path                     TEXT NOT NULL,
    revision                 TEXT NOT NULL,
    UNIQUE (bank, path, revision),

    md5sum                   TEXT,
    permutation_count        INTEGER NOT NULL DEFAULT 1,
    material_tags            TEXT[] NOT NULL DEFAULT '{}',
    dataframe_paths          TEXT[] NOT NULL DEFAULT '{}',
    -- NB: Can't have a FOREIGN KEY on array types

    initial_answered         INTEGER NOT NULL DEFAULT 0,
    initial_correct          INTEGER NOT NULL DEFAULT 0,

    next_material_source_id  INTEGER NULL,
    FOREIGN KEY (next_material_source_id) REFERENCES material_source(material_source_id)
);
CREATE INDEX IF NOT EXISTS material_source_material_tags ON material_source USING GIN (material_tags);
CREATE INDEX IF NOT EXISTS material_source_next_material_source_id ON material_source(next_material_source_id);
COMMENT ON TABLE  material_source IS 'Source for material, i.e. a file in the material repository';
COMMENT ON COLUMN material_source.path     IS 'Path to material file';
COMMENT ON COLUMN material_source.revision IS 'Git revision of this material source';
COMMENT ON COLUMN material_source.md5sum   IS 'MD5sum of this version';
COMMENT ON COLUMN material_source.permutation_count IS 'Number of question permutations';
COMMENT ON COLUMN material_source.initial_answered IS 'Initial value for # of times this question has been answered';
COMMENT ON COLUMN material_source.initial_correct IS 'Initial value for # of times this question has been correctly answered';
COMMENT ON COLUMN material_source.next_material_source_id IS
    'This bank/path/revision has been superseded by this one, i.e. this one should be ignored';


CREATE OR REPLACE VIEW all_material_tags AS
    SELECT DISTINCT UNNEST(material_tags) FROM material_source;
COMMENT ON VIEW all_material_tags IS 'All currently used material_tags';


COMMIT;
