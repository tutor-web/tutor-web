"""
See ``doc/settings.rst`` for more details on the structures used here
"""
import itertools
import random

import numpy.random

from tutorweb_quizdb import DBSession, Base


# Randomly-chosen questions that should result in an integer value
INTEGER_SETTINGS = set((
    'allocation_seed',
    'question_cap',
    'award_lecture_answered',
    'award_lecture_aced',
    'award_tutorial_aced',
    'award_ugmaterial_correct',
    'award_ugmaterial_accepted',
    'cap_template_qns',
    'cap_template_qn_reviews',
    'cap_template_qn_nonsense',
    'grade_nmin',
    'grade_nmax',
    'ugreview_minreviews',
))
STRING_SETTINGS = set((
    'allocation_encryption_key',
    'iaa_mode',
    'grade_algorithm',
    'ugreview_vetted_review_mode',
))
SERVERSIDE_SETTINGS = set((
    'allocation_encryption_key',
    'allocation_seed',
    'prob_template_eval',
    'cap_template_qns',
    'cap_template_qn_reviews',
    'question_cap',
    'award_lecture_answered',
    'ugreview_capfalse',
    'ugreview_captrue',
    'ugreview_minreviews',
))
# These are applied to every stage, sp there's always an allocation_seed
GLOBAL_SPECS = dict(
    allocation_encryption_key=dict(randstring=20),
    allocation_seed=dict(min=0, max=2**32),
)


class SettingSpec():
    """
    Wrapper around spec dicts that resolves variants if necessary
    - va_fn A function that says if variant (e.g. "variant:registered") applies
    """
    def __init__(self, key, spec, va_fn=lambda: False):
        self.key = key
        self.spec = spec or {}

        # Check for a variant, if available use that
        for variant_key, variant_spec in self.spec.items():
            if not variant_key.startswith('variant:'):
                continue
            if va_fn(variant_key):
                self.spec = variant_spec
                break

    def is_customised(self):
        """Is this spec customised to a user?"""
        return (self.spec.get('shape', None) is not None or
                self.spec.get('max', None) is not None or
                self.spec.get('randstring', None) is not None or
                False)

    def equivalent(self, oth):
        """Is this Spec equivalent to oth?"""
        for key in ['value', 'shape', 'max', 'min', 'randstring']:
            our_value = self.spec.get(key, None)
            their_value = oth.spec.get(key, None)

            if our_value is None:
                if their_value is not None:
                    return False
                continue

            if their_value is None:
                if our_value is not None:
                    return False
                continue

            if abs(our_value - their_value) > 0.00001:
                return False
        return True

    def choose_value(self):
        """Return a new value according to our restrictions"""
        if not self.is_customised():
            return str(self.spec['value']) if 'value' in self.spec else None

        if self.key in STRING_SETTINGS:
            if self.spec.get('randstring', None) is not None:
                return "".join(chr(random.randint(32, 127)) for _ in range(self.spec['randstring']))
            raise ValueError("Cannot choose random value for setting %s" % self.key)

        if self.spec.get('shape', None) is not None:
            # Fetch value according to a gamma function
            for i in range(10):
                out = numpy.random.gamma(shape=float(self.spec['shape']), scale=float(self.spec['value']))
                if self.spec.get('max', None) is None or (self.spec['min'] or 0) <= out < self.spec['max']:
                    if self.key in INTEGER_SETTINGS:
                        out = int(round(out))
                    return str(out)
            raise ValueError("Cannot pick value that satisfies shape %f / value %f / min %f / max %f" % (
                self.spec['shape'],
                self.spec['value'],
                self.spec['min'],
                self.spec['max'],
            ))

        if self.spec.get('max', None) is not None:
            # Uniform random choice
            out = random.uniform(self.spec.get('min', 0) or 0, self.spec['max'])
            if self.key in INTEGER_SETTINGS:
                out = int(round(out))
            return str(out)

        # If we get here, there's something wrong with spec or is_customised
        raise ValueError("Should be customised, but found no means to!")


def getStudentSettings(db_stage, db_user):
    """Fetch settings for this lecture, customised for the student"""
    # Copy any existing student-specific settings in first
    out = {}
    for ss in DBSession.query(Base.classes.stage_setting).filter_by(
        stage=db_stage,
        user=db_user,
    ):
        out[ss.key] = ss.value

    # Function for testing applicability of variants
    va_cache = {}

    def _variantApplicable(variant):
        """Is this variant applicable to this student?"""
        if not variant:
            return True
        if va_cache[variant]:
            return va_cache[variant]

        if variant == "variant:registered":
            # Is the student subscribed to a course?
            raise NotImplementedError("TODO:")
            # va_cache[variant] = Something?
            return va_cache[variant]

        raise ValueError("Unknown variant %s" % variant)

    # Check all global settings for the lecture
    for key, spec in itertools.chain(GLOBAL_SPECS.items(), (db_stage.stage_setting_spec or {}).items()):
        spec = SettingSpec(key, spec, _variantApplicable)

        if key in out:
            # Already have a current student-overriden setting, ignore this one
            continue

        if not spec.is_customised():
            # We don't need a customised value, just use the global one.
            out[key] = spec.choose_value()
            continue

        # Find any previous settings for this stage/student
        x = (
            DBSession.query(Base.classes.stage, Base.classes.stage_setting)
            .filter(Base.classes.stage_setting.stage_id == Base.classes.stage.stage_id)
            .filter(Base.classes.stage_setting.key == key)
            # For this student
            .filter(Base.classes.stage_setting.user_id == db_user.id)
            # For this lecture
            .filter_by(syllabus_id=db_stage.syllabus_id)
            # But not this stage
            .filter(Base.classes.stage.stage_id != db_stage.stage_id)
            # NB: Ideally we traverse list, but instead we assume versions increment
            .order_by(Base.classes.stage.version.desc())
        ).all()
        if len(x) > 0:
            (old_stage, old_ss) = x[0]
            if key in GLOBAL_SPECS:
                old_spec = SettingSpec(key, GLOBAL_SPECS[key], _variantApplicable)
            else:
                old_spec = SettingSpec(key, old_stage.stage_setting_spec.get(key, {}), _variantApplicable)
            equivalent = spec.equivalent(old_spec)
        else:
            equivalent = False

        # If it's equivalent, re-use it. Otherwise choose a new value
        out[key] = old_ss.value if equivalent else spec.choose_value()
        DBSession.add(Base.classes.stage_setting(
            stage_id=db_stage.stage_id,
            user_id=db_user.id,
            key=key,
            value=out[key],
        ))
    DBSession.flush()
    return out


def clientside_settings(settings):
    """Filter result of getStudentSettings, returning only settings relevant to client side"""
    return dict((k, v) for k, v in settings.items() if k not in SERVERSIDE_SETTINGS)
