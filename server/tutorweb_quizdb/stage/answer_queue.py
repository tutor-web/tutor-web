import logging

from sqlalchemy.orm.exc import NoResultFound

from tutorweb_quizdb import DBSession, Base
from tutorweb_quizdb.rst import to_rst
from tutorweb_quizdb.student import student_is_vetted
from tutorweb_quizdb.syllabus import path_to_ltree
from tutorweb_quizdb.timestamp import timestamp_to_datetime, datetime_to_timestamp

VETTED_ACCEPT_CUTOFF = 40


log = logging.getLogger(__name__)


def mark_aq_entry(db_a, alloc, grade_hwm):
    """
    Update db_a.correct / db_a.mark / db_a.coins_awarded based on entry
    - db_a: answer_queue entry to modify
    - alloc: Stage allocation for this student
    - grade_hwm: The highest grade acheived so far
    """
    def crossed_grade_boundary(boundary):
        """True iff student has crossed grade boundary for the first time"""
        return grade_hwm < boundary and db_a.grade >= boundary

    def get_award_setting(award_type):
        return round(float(alloc.settings.get('award_' + award_type, 0)))

    def get_sibling_hwms():
        """Return the high-water-mark for every other stage in the tutorial"""
        return DBSession.execute("""
            SELECT st.stage_id
                 , (SELECT COALESCE(MAX(a.grade), 0)
                      FROM answer a, all_stage_versions asv
                     WHERE a.stage_id = asv.stage_id
                       AND asv.latest_stage_id = st.stage_id -- i.e we want answer items for all versions of this stage
                       AND a.user_id = :user_id) grade_hwm
              FROM stage st, syllabus sy
             WHERE sy.syllabus_id = st.syllabus_id
               AND sy.path <@ :tut_path
               AND st.stage_id != :stage_id
               AND st.next_stage_id IS NULL
            GROUP BY st.stage_id
        """, dict(
            user_id=db_a.user_id,
            stage_id=db_a.stage_id,
            tut_path=str(path_to_ltree("nearest-tut:%s" % alloc.db_stage.syllabus.path)),
        ))

    if db_a.ug_reviews is not None:
        # Mark as UG material with reviews
        mark_aq_entry_usergenerated(db_a, alloc, db_a.ug_reviews)
    else:
        # No UG review, consider as a regular question
        db_a.coins_awarded = 0
        if crossed_grade_boundary(5.000):
            db_a.coins_awarded += get_award_setting('stage_answered')
        if crossed_grade_boundary(9.750):
            db_a.coins_awarded += get_award_setting('stage_aced')

            # Have we also aced all other lectures?
            for (sibling_id, sibling_hwm) in get_sibling_hwms():
                if sibling_hwm < 9.750:
                    break
            else:
                db_a.coins_awarded += get_award_setting('tutorial_aced')


def mark_aq_entry_usergenerated(db_a, alloc, ug_reviews):
    """For a list of UG reviews, return a mark"""
    def get_award_setting(award_type):
        return round(float(alloc.settings.get('award_' + award_type, 0)))

    # Count / tally all review sections
    out_count = 0
    out_total = 0
    vetted_accepted = False
    for reviewer_user_id, review in ug_reviews:
        if not review:
            continue

        review_total = 0
        for r_type, r_rating in review.items():
            if r_type == 'comments':
                continue
            if r_type == 'vetted' and int(r_rating) > VETTED_ACCEPT_CUTOFF:
                vetted_accepted = True
            try:
                review_total += int(r_rating)
            except ValueError:
                pass
        review['mark'] = review_total
        out_total += review_total
        out_count += 1

    if out_count > 0:
        # Mark should be mean of all reviews
        db_a.mark = int(out_total / max(int(alloc.settings.get('ugreview_minreviews', 3)), out_count))
    else:
        db_a.mark = 0

    if db_a.review and db_a.review.get('superseded', False):
        # If this is superseded, then make sure it's incorrect to get rid of it
        db_a.correct = False
    elif vetted_accepted:
        # A vetter thought this was good enough to accept, so should be correct
        db_a.correct = True
    elif db_a.correct is not None:
        # Already reached a decision, don't change it
        pass
    elif db_a.mark > float(alloc.settings.get('ugreview_captrue', 3)):
        db_a.correct = True
    elif db_a.mark < float(alloc.settings.get('ugreview_capfalse', -1)):
        db_a.correct = False
    else:
        db_a.correct = None

    db_a.coins_awarded = 0
    if db_a.correct is True:
        db_a.coins_awarded += get_award_setting('ugmaterial_correct')
        if vetted_accepted:
            # Was accepted into main question bank, give major bonus
            db_a.coins_awarded += get_award_setting('ugmaterial_accepted')


def db_to_incoming(alloc, db_a):
    """Turn db entry back to wire-format"""
    def format_review(reviewer_user_id, review):
        """Format incoming review object from stage_ugmaterial for client"""
        if not review:
            review = {}

        # rst-ize comments
        if review.get('comments', None):
            review['comments'] = to_rst(review['comments'])
        return review

    return dict(
        uri=alloc.to_public_id(db_a.material_source_id, db_a.permutation),
        client_id=db_a.client_id,
        time_start=datetime_to_timestamp(db_a.time_start),
        time_end=datetime_to_timestamp(db_a.time_end),
        time_offset=db_a.time_offset,

        correct=db_a.correct,
        grade_after=float(db_a.grade),
        # NB: We don't return coins_awarded

        student_answer=db_a.student_answer,
        review=db_a.review,
        synced=True,
        mark=getattr(db_a, 'mark', 0),

        ug_reviews=[
            format_review(reviewer_user_id, review)
            for reviewer_user_id, review
            in (db_a.ug_reviews or [])
            if alloc.db_student.id != reviewer_user_id  # NB: Your own review will be in review, so no need
        ],
    )


def incoming_to_db(alloc, in_a):
    """Turn wire-format into a DB answer entry"""
    try:
        (mss_id, permutation) = alloc.from_public_id(in_a['uri'])
    except Exception:
        # Log exception along with real error
        log.exception("Could not parse question ID %s" % in_a['uri'])
        raise ValueError("Could not parse question ID %s" % in_a['uri'])
    try:
        ms = DBSession.query(Base.classes.material_source).filter_by(material_source_id=mss_id).one()
    except NoResultFound:
        log.exception("Could not parse question ID %s" % in_a['uri'])
        raise ValueError("Cannot find question %s for user %s (are you logged in as the right user?)" % (
            in_a['uri'],
            alloc.db_student.user_name,
        ))

    return Base.classes.answer(
        stage_id=alloc.db_stage.stage_id,  # NB: Assume incoming answers are based on the latest stage
        user_id=alloc.db_student.id,

        material_source_id=ms.material_source_id,
        permutation=permutation,
        client_id=in_a['client_id'],
        time_start=timestamp_to_datetime(in_a['time_start']),
        time_end=timestamp_to_datetime(in_a['time_end']),

        correct=in_a['correct'],
        grade=in_a['grade_after'],
        coins_awarded=0,

        student_answer=in_a.get('student_answer', None),
        review=in_a.get('review', None),
    )


def sync_answer_queue(alloc, in_queue, time_offset):
    # Fetch all past stage_ids for this stage_id, so we consider answers from older stave revisions
    all_stages = [x[0] for x in DBSession.execute("""
        SELECT stage_id FROM all_stage_versions WHERE latest_stage_id = :stage_id
    """, dict(
        stage_id=alloc.db_stage.stage_id,
    ))]

    # Lock answer_queue for this student, to stop any concorrent updates
    db_queue = (DBSession.query(Base.classes.answer)
                .filter(Base.classes.answer.stage_id.in_(all_stages))
                .filter(Base.classes.answer.user_id == alloc.db_student.id)
                .order_by(Base.classes.answer.time_end, Base.classes.answer.time_offset)
                .with_for_update().all())

    # Fetch any reviews if we've written content here
    # NB: This won't select items in in_queue that haven't been inserted yet, but
    #     should just be the self-review we won't return anyway.
    stage_ug_reviews = {}
    for (answer_id, ug_reviews) in DBSession.execute(
            """
            SELECT answer_id, reviews FROM stage_ugmaterial
             WHERE user_id = :user_id
               AND material_source_id IN (
                SELECT material_source_id FROM stage_material_sources sms
                 WHERE sms.stage_id = :stage_id
                   AND 'type.template' = ANY(sms.material_tags))
            ORDER BY time_end
            """, dict(
                stage_id=alloc.db_stage.stage_id,  # NB: This uses latest stage, since material will be carried over.
                user_id=alloc.db_student.id,
            )):
        stage_ug_reviews[answer_id] = ug_reviews

    # First pass, fill in any missing time_offset fields
    for a in in_queue[:]:
        # If not complete, ignore it
        if not a.get('time_end', 0):
            in_queue.remove(a)
        if a.get('time_offset', None) is None:
            a['time_offset'] = time_offset
    # Re-sort based on any additional time_offsets
    in_queue.sort(key=lambda a: (a['time_end'], a['time_offset']))

    db_i = 0
    in_i = 0
    additions = 0
    out = []
    grade_hwm = 0
    while True:
        if db_i >= len(db_queue):
            # Ran off the end of DB items, anything extra should be added to incoming
            cmp = -1

            if in_i >= len(in_queue):
                # Parsed both lists, done
                break
        elif in_i >= len(in_queue):
            # Ran off the end of incoming items, anything extra should be added to DB
            cmp = 1
        else:
            # Find smallest of DB/incoming entries
            cmp = in_queue[in_i]['time_end'] - datetime_to_timestamp(db_queue[db_i].time_end)
            if cmp == 0:
                cmp = in_queue[in_i]['time_offset'] - db_queue[db_i].time_offset

        if cmp == 0:
            # Matching items, update any review
            # NB: Only update the review when there's something to replace it with, so view_stage_ug_rewrite is saved
            if in_queue[in_i].get('review', None):
                db_queue[db_i].review = in_queue[in_i]['review']
            db_entry = db_queue[db_i]
            db_i += 1
            in_i += 1

        elif cmp < 0:
            # An extra incoming item, insert it
            db_entry = incoming_to_db(alloc, in_queue[in_i])
            db_entry.time_offset = time_offset
            DBSession.add(db_entry)
            additions += 1
            in_i += 1

        else:  # i.e. cmp < 0
            # An extra DB item, do nothing, will get added to outgoing list
            db_entry = db_queue[db_i]
            db_i += 1

        # If reviews are present, update DB entry based on them
        db_entry.ug_reviews = stage_ug_reviews.get(db_entry.answer_id, None)
        mark_aq_entry(db_entry, alloc, grade_hwm)
        out.append(db_to_incoming(alloc, db_entry))
        if db_entry.grade > grade_hwm:
            grade_hwm = db_entry.grade

        DBSession.flush()
    # Return combination of answer queues, and how many new entries we found
    return (out, additions)


def request_review(alloc):
    is_vetted = student_is_vetted(alloc.db_student, alloc.db_stage)

    # Choose review mode
    review_mode = alloc.settings.get('ugreview_vetted_review_mode', 'correct-only') if is_vetted else 'undecided'
    if review_mode == 'correct-only':  # Only see "correct" material, i.e. material already deemed good by peer reviewers
        review_mode_where = 'AND correct'
        review_mode_order = 'JSONB_ARRAY_LENGTH(reviews)'
    elif review_mode == 'correct-first':  # See "correct" material first, then undecided material
        review_mode_where = 'AND (correct IS NULL OR correct)'
        review_mode_order = 'correct, JSONB_ARRAY_LENGTH(reviews)'
    elif review_mode == 'undecided':  # See only material that don't have a correct/incorrect verdict assigned to them
        review_mode_where = 'AND correct IS NULL'
        review_mode_order = 'JSONB_ARRAY_LENGTH(reviews)'
    else:
        raise ValueError("Unknown review mode %s" % review_mode)

    # Find a question that needs a review
    # Get all questions that we didn't write, ones with least reviews first
    for (stage_id, mss_id, answer_id, reviews) in DBSession.execute(
            """
            SELECT stage_id, material_source_id, answer_id, reviews FROM stage_ugmaterial
             WHERE user_id != :user_id
               """ + review_mode_where + """
               AND material_source_id IN (
                SELECT material_source_id FROM stage_material_sources sms
                 WHERE sms.stage_id = :stage_id
                   AND 'type.template' = ANY(sms.material_tags))
            ORDER BY """ + review_mode_order + """, RANDOM()
            """, dict(
                stage_id=alloc.db_stage.stage_id,  # NB: This uses latest stage, since material will be carried over.
                user_id=alloc.db_student.id,
            )):

        # Consider all reviews
        mark = 0
        for (r_user_id, r_obj) in reviews:
            if r_obj is None:
                # Ignore empty reviews
                continue
            if r_user_id == alloc.db_student.id:
                # We reviewed it ourselves, so ignore it
                mark = -99
                break

        if mark >= 0:
            # This one is good enough for reviewing
            return dict(
                uri=alloc.to_public_id(mss_id, 0 - answer_id),
            )

    # No available material to review
    return dict()
