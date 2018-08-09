"""
{
    "path": "comp.crypto251",
    "titles": ["Computer Science Department", "Cryptocurrency and the Smileycoin"],
    "requires_group": null,
    "lectures": [
        ["lec00100", "Introduction to cryptocurrencies"],
        ["lec00200", "Smileycoin basics"],
        ["lec00250", "Picking up a wallet"],
        ["lec00260", "Compiling the Linux wallet"],
        ["lec00300", "Introduction to the SMLY command line"],
        ["lec01400", "The transaction: from concept to theory"],
        ["lec01500", "The block and the blockchain"],
        ["lec01600", "Cryptocurrency mining"],
        ["lec02000", "Cryptography and cryptocurrencies"],
        ["lec02100", "Hash function introduction"],
        ["lec02200", "Elliptic curves"],
        ["lec03000", "The trilogy: tutor-web, Smileycoin and Education in a Suitcase"],
        ["lec03100", "The tutor-web premine"],
        ["lec03200", "Splitting the coinbase: No longer just a miners fee"],
        ["lec03400", "Staking"],
        ["lec03500", "The tutor-web as a faucet"],
        ["lec04000", "The command line in detail"],
        ["lec04500", "Building a transaction on the command line"],
        ["lec15000", "Cryptocurrency exchanges"],
        ["lec15500", "API access to exchanges"],
        ["lec26000", "Automation on the blockchain (stores, ATM, gambling etc)"],
        ["lec30000", "The Bitcoin programming language"],
        ["lec47000", "Atomic swaps"]
    ],
    "stage_template": [
        {
            "name": "stage0",
            "title": "write and review Examples",
            "material_tags": [{"path_tags": 1}, "type.template", "outputtype.example"],
            "setting_spec": {}
        }
    ]
}
"""
import json

from sqlalchemy import func
from sqlalchemy.orm.exc import NoResultFound
from sqlalchemy_utils import Ltree

from tutorweb_quizdb import DBSession, Base, ACTIVE_HOST


def upsert_lec(path, title, requires_group):
    """Fetch / insert from the lecture table something with path"""
    try:
        dbl = (DBSession.query(Base.classes.lecture)
                        .filter_by(host_id=ACTIVE_HOST, path=path)
                        .one())
        dbl.title = title
        dbl.requires_group_id = func.public.get_group_id(requires_group)
        return dbl
    except NoResultFound:
        dbl = Base.classes.lecture(
            host_id=ACTIVE_HOST,
            path=path,
            title=title,
            requires_group_id=func.public.get_group_id(requires_group),
        )
        DBSession.add(dbl)
    DBSession.flush()
    return dbl


def resolve_material_tags(stage_tmpl, db_lec):
    out = []

    for t in stage_tmpl['material_tags']:
        if not isinstance(t, dict):
            out.append(t)
        elif t.get('path_tags', None):
            out.extend(['path.%s' % db_lec.path[:i + 1] for i in range(len(db_lec.path))])
        else:
            raise ValueError("Unknown tag function: %s" % t)
    return out


def lec_import(tut_struct):
    # Make sure the department & tutorial are available
    path = Ltree(tut_struct['path'])
    requires_group = tut_struct['requires_group'] or 'accept_terms'
    for i in range(len(path)):
        upsert_lec(path[:i + 1], tut_struct['titles'][i], requires_group)

    # Add all lectures & stages
    for (lec_name, lec_title) in tut_struct['lectures']:
        db_lec = upsert_lec(path + Ltree(lec_name), lec_title, requires_group)

        # Get all current stages, put in dict
        db_stages = dict()
        for s in DBSession.query(Base.classes.stage).filter_by(lecture=db_lec):
            db_stages[s.stage_name] = s

        for stage_tmpl in tut_struct['stage_template']:
            # De-mangle any functions in material tags
            material_tags = resolve_material_tags(stage_tmpl, db_lec)
            setting_spec = stage_tmpl['setting_spec'] or {}

            if stage_tmpl['name'] in db_stages:
                # If equivalent, do nothing
                # TODO: Is this doing the right thing?
                if db_stages[stage_tmpl['name']].material_tags == material_tags and \
                   db_stages[stage_tmpl['name']].stage_setting_spec == setting_spec:
                    if db_stages[stage_tmpl['name']].title != stage_tmpl['title']:
                        # Can just update title without needing a new version
                        db_stages[stage_tmpl['name']].title = stage_tmpl['title']
                        DBSession.flush()
                    continue
            # Add it, let the database worry about bumping version
            DBSession.add(Base.classes.stage(
                lecture=db_lec,
                stage_name=stage_tmpl['name'],
                title=stage_tmpl['title'],
                material_tags=material_tags,
                stage_setting_spec=setting_spec
            ))


def script():
    import os
    import sys
    import transaction

    from tutorweb_quizdb import initialize_dbsession
    initialize_dbsession(os.environ['DB_URL'])

    with transaction.manager:
        tut_struct = json.load(sys.stdin)
        lec_import(tut_struct)
