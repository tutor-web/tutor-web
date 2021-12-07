Tutor-web drill settings
^^^^^^^^^^^^^^^^^^^^^^^^

There are a bunch of key:value settings that can be used to control the
behaviour of the drill interface.

Core list of settings
=====================

Question assignment:

* ``question_cap``: The maximum number of questions of each question type that a student should be allocated. Default 100

Coin awards for students:

* ``award_stage_answered``: Milli-SMLY awarded for getting grade 5 in a stage. Default 0
* ``award_stage_aced``: Milli-SMLY awarded for getting grade 10 in a stage. Default 0
* ``award_tutorial_aced``: Milli-SMLY awarded for getting grade 10 in every stage in tutorial/class. Default 0
* ``award_ugmaterial_correct``: Milli-SMLY awarded for ugmaterial being considered "correct". Default 0
* ``award_ugmaterial_accepted``: Milli-SMLY awarded for ugmaterial being accepted into question bank by a vetted reviewer. Default 0

Grading algorithm:

* ``grade_algorithm``: Grading algorithm to use. Default 'weighted'

  * ``weighted``: Most recent answers have greatest affect.
  * ``ratiocorrect``: Score is proportion of correct to total number of questions. Used for exam mode.
  * ``scorrect``: Student should give ``grade_s`` correct answers to ace, incorrect answers ignored. Used for user-generated material.

* ``grade_nmin``: Minimum number of questions to consider during grading. Default 8
* ``grade_nmax``: Maximum number of questions to consdier during grading. Default 30
* ``grade_alpha``: Default 0.125
* ``grade_s``: Default 1

* ``ugreview_minreviews``: The minimum number of reviews required. Before this the mark is biased towards 0, see below. Default 3

    mark for UG material = (total grade of all reviews) / max(ugreview_minreviews, (number of reviews))

* ``ugreview_captrue``: The mark above which we consider this material gets a "correct" grade, and we stop reviewing. Default 3
* ``ugreview_capfalse``: The mark above which we consider this material gets an "incorrect" grade, and we stop reviewing. Default -1
* ``ugreview_vetted_review_mode``: Which questions a vetted reviewer gets. One of the following. Default 'correct-first'

  * ``correct-first``: Review questions deemed correct (i.e. good) by peer reviewers first
  * ``correct-only``: Review questions deemed correct (i.e. good) by peer reviewers only
  * ``undecided``: Questions without enough reviews to deem correct/incorrect, i.e. the review_mode for regular students

Question timeout:

* ``timeout_std``: Default 2
* ``timeout_min``: Lowest timeout for a question. In minutes. Default 3
* ``timeout_max``: Highest timeout for a question. In minutes. Default 10
* ``timeout_grade``: Grade that lower timeouts kick in. Default 5

Study Time (i.e. combined time spent on question and reading explanation):

  Study time = min(
      studytime_factor * (incorrect questions in a row) +
      studytime_answeredfactor * (# of questions answered including practice),
      studytime_max)

* ``studytime_factor``: Default 2
* ``studytime_answeredfactor``: Default 0
* ``studytime_max``: Maxiumum study time in seconds. Default 20

Practice Mode:

* ``practice_after``: Number of questions after which you can start practicing. Default 0
* ``practice_batch``: Number of practice questions you can do after "practice_after". Default Infinity

Allocation:

* ``iaa_type``: Which IAA algorithm to use on the client. Default 'adaptive'
* ``iaa_adaptive_gpow``: Default 1
* ``allocation_method``: Which IAA algorithm to use on the server. Default 'original'

Setting specifications
======================

Within a stage, we describe the value given to a setting using a setting specification.
This is a JSON object with entries for all the settings you want to override,
for example:

    {
        "grade_alpha": {"value": 0.5},
        "grade_s": {"min": 1, "max": 100},
    }

Here we override grade_alpha to be 0.5 for every student, and for each student,
choose a uniform random value 1..100 exclusive.

Note that the ``_min`` in ``timeout_min`` is unrelated to the ``min`` above.
A new timeout is assigned per-question, not per-lecture.

Updating setting specifications
-------------------------------

If a stage is updated, but the specification for an individual setting stays
the same, then a student will keep their previous random value.

If, for example, we change the above to ``"grade_s": {"min": 1, "max": 200}``,
then any student will be assigned a new random value, even though their
existing value met these criteria.

Updating settings
=================

If any setting for a lecture is updated, then a student will start using that
new value once they sync their copy of the lecture, i.e. when they answer their
next question. In addition, if ``:min`` or ``:max`` is changed, then they will
be randomly assigned a new value between those bounds.

If students have finished working on that lecture then their settings will be
left unchanged. This means that historical data where students worked with
different values will be preserved.
