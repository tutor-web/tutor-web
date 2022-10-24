import base64
import hashlib
import random
import struct

from sqlalchemy import column, select, table, tuple_

import skippy

from tutorweb_quizdb import DBSession


def get_allocation(settings, *args, **kwargs):
    name = settings.get('allocation_method', 'original')
    if name == 'original':
        return OriginalAllocation(settings, *args, **kwargs)
    elif name == 'passthrough':
        return PassThroughAllocation(settings, *args, **kwargs)
    elif name == 'exam':
        return ExamAllocation(settings, *args, **kwargs)
    else:
        raise ValueError("Unknown allocation module %s" % name)


class BaseAllocation():
    def __init__(self, settings, db_stage, db_student):
        self.settings = settings
        self.db_stage = db_stage
        self.db_student = db_student

    def get_material(self):
        """
        Return a list of mss_id/permutation/answered/correct tuples
        of suitable material for this student.
        """
        q = select([
            column('material_source_id'),
            column('permutation'),
        ]).select_from(table('stage_material')).where(column('stage_id') == self.db_stage.stage_id)

        return DBSession.execute(q).fetchall()

    def to_public_id(self, mss_id, permutation):
        """
        Turn (mss_id, permutation) into a public question ID
        """
        return '%d:%d' % (mss_id, permutation)

    def from_public_id(self, public_id):
        """
        Turn the public ID back into a (mss_id, permutation) tuple
        """
        return tuple(int(x) for x in public_id.split(":", 1))

    def get_stats(self, public_ids):
        """
        Fetch the updated answered/correct stats for given public IDs
        """
        q = select([
            column('material_source_id'),
            column('permutation'),
            column('answered'),
            column('correct'),
        ]).select_from(table('answer_stats')).where(column('stage_id') == self.db_stage.stage_id)

        q = q.where(tuple_(
            column('material_source_id'),
            column('permutation')
        ).in_(self.from_public_id(x) for x in public_ids))

        # Return stats, sorted by incoming public_ids
        stats = {}
        for mss_id, permutation, answered, correct in DBSession.execute(q):
            stats[self.to_public_id(mss_id, permutation)] = dict(
                stage_answered=answered,
                stage_correct=correct,
            )
        return [stats.get(x, dict(stage_answered=0, stage_correct=0)) for x in public_ids]

    def material_hash(self):
        """
        Get a hash representing current material selection
        """
        mat_bytes = b"/".join(
            b"%d:%d" % (mss_id, permutation)
            for mss_id, permutation in self.get_material()
        )
        return hashlib.sha1(mat_bytes).hexdigest()


class OriginalAllocation(BaseAllocation):
    def _aq_length(self):
        # Get length of answerQueue
        return DBSession.execute(
            'SELECT COUNT(*)'
            ' FROM answer'
            ' WHERE stage_id = :stage_id'
            '   AND user_id = :user_id'
            '',
            dict(
                stage_id=self.db_stage.stage_id,
                user_id=self.db_student.user_id,
            )
        ).fetchone()[0]

    def __init__(self, settings, db_stage, db_student):
        super(OriginalAllocation, self).__init__(settings, db_stage, db_student)
        self.seed = int(settings['allocation_seed'])
        self.cipher = skippy.Skippy(settings['allocation_encryption_key'].encode('ascii'))
        self.refresh_int = int(self.settings.get('allocation_refresh_interval', 20))
        self.question_cap = int(self.settings.get('question_cap', 100))

    def to_public_id(self, mss_id, permutation):
        return base64.b64encode(struct.pack(
            'cII',
            b'B' if permutation < 0 else b'A',
            self.cipher.encrypt(mss_id),
            self.cipher.encrypt(abs(permutation)),
        )).decode('ascii')

    def from_public_id(self, public_id):
        public_id = base64.b64decode(public_id)
        if len(public_id) < 9:
            # Pre-version-char format
            version_char = b'A'
            mss_id, permutation = struct.unpack('II', public_id)
        else:
            version_char, mss_id, permutation = struct.unpack('cII', public_id)
        mss_id = self.cipher.decrypt(mss_id)
        permutation = self.cipher.decrypt(permutation)
        if version_char == b'B':
            permutation = 0 - permutation
        return mss_id, permutation

    def get_material(self):
        material = super(OriginalAllocation, self).get_material()

        # If there are enough, sample based on our seed & how many questions student has answered
        if self.question_cap < len(material):
            # TODO: We should be choosing based on difficulty, but to do that we need
            # updated stats, and the current grade
            local_random = random.Random()
            local_random.seed(self.seed + (self._aq_length() // self.refresh_int))
            material = local_random.sample(material, self.question_cap)
        return material


class PassThroughAllocation(BaseAllocation):
    """
    Public IDs are '(question_path):(permutation)', return all questions.
    To make things obvious when unit testing.

    Also set allocation_bank_name to the material bank in question
    """
    def __init__(self, settings, db_stage, db_student):
        super(PassThroughAllocation, self).__init__(settings, db_stage, db_student)
        self.bank = settings['allocation_bank_name']

    def to_public_id(self, mss_id, permutation):
        """
        Turn (mss_id, permutation) into a public question ID
        """
        (mss_path,) = DBSession.execute("""
            SELECT path
             FROM material_source
             WHERE material_source_id = :mss_id
        """, dict(
            mss_id=mss_id,
        )).fetchone()

        (version,) = DBSession.execute("""
            SELECT COUNT(*)
              FROM material_source
             WHERE material_source_id <= :mss_id
               AND path = :mss_path
        """, dict(
            mss_id=mss_id,
            mss_path=mss_path,
        )).fetchone()

        return '%s:%d:%d' % (mss_path, version, permutation)

    def from_public_id(self, public_id):
        """
        Turn the public ID back into a (mss_id, permutation) tuple
        """
        (mss_path, version, permutation) = public_id.split(":", 2)

        # Get all possible MSS IDs for this path, assume we want the version'th
        mss_ids = DBSession.execute("""
            SELECT material_source_id
              FROM material_source
             WHERE path = :mss_path
          ORDER BY material_source_id
        """, dict(
            mss_path=mss_path
        )).fetchall()

        return (mss_ids[int(version) - 1][0], int(permutation),)


class ExamAllocation(BaseAllocation):
    # TODO:
    pass
