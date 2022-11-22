import html
import logging
import json

from pyramid.httpexceptions import HTTPForbidden

from tutorweb_quizdb.student import get_group
from tutorweb_quizdb import DBSession, Base
from .renderer.usergenerated import ug_render
from .renderer.r import r_render
from .utils import material_bank_open


logger = logging.getLogger(__package__)


class MissingDataException(Exception):
    status_code = 400

    def __init__(self, missing):
        self.missing = missing

    def __str__(self):
        return ", ".join(self.missing)


def dataframe_template(material_bank, path):
    """Fetch the template of given dataframe"""
    with material_bank_open(material_bank, path, 'r') as f:
        return json.load(f)


def material_render(ms, permutation, student_dataframes={}):
    """
    Render a question
    """
    # If we don't have everything we need, bleat.
    missing = [x for x in ms.dataframe_paths if x not in student_dataframes]
    if len(missing) > 0:
        raise MissingDataException(missing)

    if ms.permutation_count < permutation:
        # Otherwise, permutation should be in range
        raise ValueError("Question %s only has %d permutations, not %d" % (
            ms.path,
            ms.permutation_count,
            permutation,
        ))

    try:
        if 'type.template' in ms.material_tags and permutation < 0:
            # For templates, permutations < 0 are user-generated material
            out = ug_render(ms, permutation, student_dataframes)
        elif ms.path.endswith('.R'):
            out = r_render(ms, permutation, student_dataframes)
        else:
            raise ValueError("Don't know how to render %s" % ms.path)
    except Exception as e:
        logger.exception(e)
        out = dict(
            error=e.__class__.__name__,
            content='<div class="alert alert-error">%s</div>' % (
                html.escape(e.__class__.__name__ + ": " + str(e)),
            )
        )

    # Add common extra detail to material object
    if 'tags' not in out:
        # TODO: Something more sensible to do?
        out['tags'] = ms.material_tags

    return out


def view_material_render(request):
    from tutorweb_quizdb.material.utils import file_md5sum, path_to_materialsource
    import os.path

    if not request.user or get_group('admin.material_render') not in request.user.groups:
        raise HTTPForbidden()

    # Regenerate the material source the DB would hold
    material_bank = request.json.get('material_bank', request.registry.settings['tutorweb.material_bank.default'])
    ms = Base.classes.material_source(
        **path_to_materialsource(material_bank, request.json['path'], None, git_broken_okay=True),
        md5sum=file_md5sum(os.path.join(material_bank, request.json['path'])))

    # Find all data templates for this question, and add to response
    out = dict(dataframe_templates={})
    student_dataframes = {}
    missing_data = False
    for dataframe_path in ms.dataframe_paths:
        out['dataframe_templates'][dataframe_path] = dataframe_template(ms.bank, dataframe_path)
        if dataframe_path in request.json.get('student_dataframes', {}):
            student_dataframes[dataframe_path] = request.json['student_dataframes'][dataframe_path]
        else:
            missing_data = True

    if missing_data:
        out['error'] = "Not enough data to render question"
    else:
        out.update(material_render(
            ms,
            permutation=int(request.json.get('permutation', '1')),
            student_dataframes=student_dataframes,
        ))

    return out


def includeme(config):
    config.add_view(view_material_render, route_name='view_material_render', renderer='json')
    config.add_route('view_material_render', '/material/render')


def script_material_render():
    import json
    import os.path
    from tutorweb_quizdb import setup_script

    argparse_arguments = [
        dict(description='Render any material item from the bank'),
        dict(
            name='inpath',
            help='Path to material file within question bank',
            nargs='+'),
    ]

    with setup_script(argparse_arguments) as env:
        bank_path = env['request'].registry.settings['tutorweb.material_bank.default']
        for f in env['args'].inpath:
            ms = DBSession.query(Base.classes.material_source).filter_by(
                bank=bank_path,
                path=os.path.relpath(f, bank_path),
                next_material_source_id=None
            ).one()

            out = material_render(
                ms,
                permutation=1,
            )
            content = out['content']
            del out['content']
            print("")
            print(content)
            print(json.dumps(out, sort_keys=True, indent=4))
