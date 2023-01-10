"""
[titles]
comp = Computer Science Department
crypto251 = The Smileycoin cryptocurrency
0 = Cryptocurrency and the Smileycoin

[lectures]
lec00100 = Introduction to cryptocurrencies
lec00200 = Smileycoin basics
lec00250 = Picking up a wallet

[downloads]
lec00100 = http://tutor-web.net/comp/crypto251.0/lec00100/@@download-pdf/comp.crypto251.0.lec00100.pdf
lec00200 = http://tutor-web.net/comp/crypto251.0/lec00200/@@download-pdf/comp.crypto251.0.lec00200.pdf
_ = http://tutor-web.net/comp/crypto251.0/@@download-pdf/comp.crypto251.0.pdf

[stage.stage0]
title = Write and review Examples
material_tags = type.template
        outputtype.example
        path.comp.crypto251.0.{lec_name}
timeout_max = {"max": 30, "min": 15}
timeout_min = {"max": 15, "min": 10}

[stage.stage1]
title = Write and review questions
material_tags = type.template
        outputtype.question
        path.comp.crypto251.0.{lec_name}
only_in = lec00300
        lec01400
        lec04000
        lec30100
timeout_grade = {"max": 7.5, "min": 2.5}
timeout_max = {"max": 30, "min": 15}
timeout_min = {"max": 15, "min": 10}
"""
import configparser
import json
import os.path

from sqlalchemy.sql import expression
from sqlalchemy.orm.exc import NoResultFound
from sqlalchemy_utils import Ltree
from sqlalchemy_utils.types.ltree import LQUERY

from tutorweb_quizdb import DBSession, Base, ACTIVE_HOST
from tutorweb_quizdb.student import get_group


def upsert_syllabus(path, title, href, requires_group):
    """Fetch / insert from the syllabus table something with path"""
    g_id = get_group(requires_group, auto_create=True).id if requires_group else None

    try:
        dbl = (DBSession.query(Base.classes.syllabus)
                        .filter_by(host_id=ACTIVE_HOST, path=path)
                        .one())
        dbl.title = title
        dbl.supporting_material_href = href
        dbl.requires_group_id = g_id
    except NoResultFound:
        dbl = Base.classes.syllabus(
            host_id=ACTIVE_HOST,
            path=path,
            title=title,
            supporting_material_href=href,
            requires_group_id=g_id,
        )
        DBSession.add(dbl)
    DBSession.flush()
    return dbl


def multiline_list(s):
    """Break up .ini multi-line strings into lists"""
    return [l.strip() for l in s.split("\n") if l.strip()]


def new_tutorial_config():
    conf = configparser.ConfigParser()
    conf.read_string('''
# Make sure required sections exist
[titles]
[requires_group]
_  =
[lectures]
[downloads]
    ''', source='defaults')
    return conf


def read_with_imports(conf, conf_path):
    with open(conf_path, 'r') as f:
        for l in f:
            if l.startswith('# TW:BASE '):
                read_with_imports(conf, os.path.join(
                    os.path.dirname(conf_path),
                    l.split()[2],
                ))
    conf.read(conf_path)


def lec_import(f):
    tut_path = os.path.splitext(os.path.basename(f))[0]
    tut_struct = new_tutorial_config()
    read_with_imports(tut_struct, f)

    # Make sure the department & tutorial are available
    path = Ltree(tut_path)
    for i in range(len(path)):
        if i == len(path) - 1:
            upsert_syllabus(
                path,
                tut_struct['titles'][str(path[i])],
                tut_struct['downloads'].get('_', None),
                tut_struct['requires_group']['_'],
            )
        else:
            upsert_syllabus(
                path[:i + 1],
                tut_struct['titles'][str(path[i])],
                None,
                None,  # Only set the requires_group permission on the course/tutorial itself
            )

    # Get all current lectures
    db_lecs = dict()
    for s in DBSession.query(Base.classes.syllabus).filter_by(host_id=ACTIVE_HOST).filter(Base.classes.syllabus.path.lquery(expression.cast(str(path) + '.*{1}', LQUERY))):
        db_lecs[s.path] = s

    # Add all lectures & stages
    for lec_name in tut_struct['lectures'].keys():
        lec_title = tut_struct['lectures'][lec_name]
        lec_href = tut_struct['downloads'].get(lec_name, None)
        lec_requires_group = tut_struct['requires_group'].get(lec_name, tut_struct['requires_group']['_'])

        db_lec = upsert_syllabus(path + Ltree(lec_name), lec_title, lec_href, lec_requires_group)
        if path + Ltree(lec_name) in db_lecs:
            del db_lecs[path + Ltree(lec_name)]

        # Get all current stages, put in dict
        db_stages = dict()
        for s in DBSession.query(Base.classes.stage).filter_by(syllabus=db_lec):
            db_stages[s.stage_name] = s

        for sect_name in tut_struct.sections():
            if not sect_name.startswith('stage.'):
                continue
            stage_tmpl = tut_struct[sect_name]
            if lec_name not in multiline_list(stage_tmpl.get('only_in', lec_name)):
                continue
            if lec_name in multiline_list(stage_tmpl.get('not_in', '')):
                continue
            stage_name = sect_name.replace('stage.', '')
            stage_title = tut_struct[sect_name]['title']

            # De-mangle material tags, e.g. path.{tut_path}.{lec_name}
            material_tags = [t.format(
                tut_path=tut_path,
                lec_name=lec_name,
                stage_name=stage_name,
            ) for t in multiline_list(stage_tmpl['material_tags'])]

            # Everything else is assumed to be a setting
            setting_spec = {}
            for k in stage_tmpl.keys():
                if k in set(('title', 'material_tags', 'only_in', 'not_in')):
                    continue
                setting_spec[k] = json.loads(stage_tmpl[k])

            if stage_name in db_stages:
                # If equivalent, do nothing
                # TODO: Is this doing the right thing?
                if db_stages[stage_name].material_tags == material_tags and \
                   db_stages[stage_name].stage_setting_spec == setting_spec:
                    if db_stages[stage_name].title != stage_title:
                        # Can just update title without needing a new version
                        db_stages[stage_name].title = stage_title
                        DBSession.flush()
                    continue
            # Add it, let the database worry about bumping version
            DBSession.add(Base.classes.stage(
                syllabus=db_lec,
                stage_name=stage_name,
                title=stage_title,
                material_tags=material_tags,
                stage_setting_spec=setting_spec
            ))
            DBSession.flush()

    # Tidy up any unused lectures
    for s in db_lecs.values():
        deleted_id = get_group('admin.deleted', auto_create=True).id
        if s.requires_group_id != deleted_id:
            s.requires_group_id = deleted_id
    DBSession.flush()


def script():
    import argparse
    import sys
    from tutorweb_quizdb import setup_script

    argparse_arguments = [
        dict(description='Import a tutorial/lecture/stage configuration'),
        dict(
            name='infile',
            help='.INI syllabus file(s) to import, assumes STDIN if none given',
            type=argparse.FileType('r'),
            nargs='*',
            default=sys.stdin),
    ]

    with setup_script(argparse_arguments) as env:
        for f in env['args'].infile:
            if f.endswith('.ini'):
                lec_import(f)
            else:
                raise ValueError("Unkown file format: %s" % f)
