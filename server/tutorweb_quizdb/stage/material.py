from tutorweb_quizdb import DBSession, Base
from tutorweb_quizdb.material.render import material_render
from tutorweb_quizdb.student import get_current_student, student_is_vetted
from .allocation import get_allocation
from .index import update_stats
from .utils import get_current_stage
from .setting import getStudentSettings


VETTED_REVIEW_TEMPLATE = dict(
    name='vetted',
    title='Vetted Review Mode',
    values=[
        [-48, "This is not a serious submission"],
        [0, "Reasonable solution, but not appropriate for the main question bank"],
        [12, "This should be modified for further review"],
        [48, "This is good enough to be added to the main question bank"],
    ],
)
VETTED_ACCEPT_CUTOFF = 40


def material_student_dataframes(ms_arr, student):
    """
    Fetch all student-set dataframes given a list of paths
    """
    # Work out all the dataframes we need, by bank
    bank_dataframe_paths = {}
    for ms in ms_arr:
        bank_dataframe_paths[ms.bank] = bank_dataframe_paths.get(ms.bank, set()).union(ms.dataframe_paths)

    # For each bank, fetch everything the student has filled in
    student_dataframes = {}
    for bank in bank_dataframe_paths.keys():
        student_dataframes[bank] = dict()
        for sd in DBSession.query(Base.classes.student_dataframe).filter_by(
            user_id=student.user_id,
            bank=bank,
        ).filter(Base.classes.student_dataframe.dataframe_path.in_(bank_dataframe_paths[bank])):
            student_dataframes[bank][sd.dataframe_path] = sd.data
    return student_dataframes


def stage_material(alloc, requested_ids):
    """Turn list of (mss_id, permutation) or public ID into a structure with both material stats and data"""
    # Given public IDs, make them mss_id/permutation tuples
    if len(requested_ids) > 0 and isinstance(requested_ids[0], str):
        requested_ids = [alloc.from_public_id(x) for x in requested_ids]

    # Turn tuples into DB objects
    requested_material = [
        (DBSession.query(Base.classes.material_source).filter_by(material_source_id=mss_id).one(), permutation)
        for mss_id, permutation in requested_ids
    ]

    out = dict(
        stats=[
            dict(
                uri=alloc.to_public_id(ms.material_source_id, permutation),
                initial_answered=ms.initial_answered,
                initial_correct=ms.initial_correct,
                _type='regular',  # TODO: ...or historical?
            ) for ms, permutation in requested_material
        ],
        data={},
    )
    update_stats(alloc, out['stats'])

    student_dataframes = material_student_dataframes(
        (ms for ms, _ in requested_material),
        alloc.db_student
    )
    for ms, permutation in requested_material:
        rendered = material_render(ms, permutation, student_dataframes[ms.bank])

        if 'type.template' in ms.material_tags and permutation < 0:
            # It's a user-generated question, add in special review boxes for vetted reviewers
            if student_is_vetted(alloc.db_student, alloc.db_stage):
                rendered['review_questions'].insert(0, VETTED_REVIEW_TEMPLATE)

        out['data'][alloc.to_public_id(ms.material_source_id, permutation)] = rendered
    return out


def view_stage_material(request):
    """
    Get one, or all material for a stage
    """
    db_stage = get_current_stage(request)
    db_student = get_current_student(request)
    settings = getStudentSettings(db_stage, db_student)
    alloc = get_allocation(settings, db_stage, db_student)

    if (request.params.get('id', None)):
        requested_material = [request.params['id']]
    else:
        requested_material = alloc.get_material()
    return stage_material(alloc, requested_material)


def includeme(config):
    config.add_view(view_stage_material, route_name='stage_material', renderer='json')
    config.add_route('stage_material', '/stage/material')
