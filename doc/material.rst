Tutor-web material format
*************************

All tutor-web *material* (i.e. questions or examples) is stored in the
``material_bank`` repository. This lives in the ``db/material_bank`` directory
of a tutor-web installation.

The content for the main tutor-web site is stored in a private repository at
https://gitlab.com/tutor-web/material-bank, please let the administrators know
if you require access. Content will need to be added there before it can be
used.

Material scripts
================

All material in tutor-web is represented by R scripts. These can be in any directory
within the material bank, but the file name should end with ``.q.R``. They
should contain a ``question()`` function that returns HTML representing the
question, as well as the correct answer. A simple example is below::

    # TW:PERMUTATIONS=10
    # TW:TAGS=type.question,preference.number
    # TW:TIMESANSWERED=0
    # TW:TIMESCORRECT=0

    question <- function(permutation, data_frames) {
        return(list(
            content = '
                <label>What is your favourite number? <input type="number" name="value" /></label>
            ',
            correct = list('value' = list(permutation))
        ))
    }

* ``TW:PERMUTATIONS=10`` indicates there are 10 variations of this question,
  which will be treated as separate questions. Which variant is required will
  be given to the question function.
* ``TW:TAGS=...`` lists the relevant tags for these questions, which will be
  used by stages when selecting relevant questions.
* ``TW:TIMESANSWERED=0/CORRECT=0`` gives an initial bias to the question stats,
  indicating how hard this question is.
* ``content`` is the raw HTML for the question. Whilst here we return the HTML
  as a string, there are easier ways, see later in this section.
* ``correct`` is a list of form values and the correct response. In the above
  case, the correct answer is the permutation, i.e. 1..10 depending on which
  permutation of the question is being used, see later in this section.

Writing content
---------------

The CRAN package `htmltools <https://cran.r-project.org/package=htmltools>`__
can be used to simplify the creation of HTML. For example, the above example
could be re-written as::

    content = htmtools::withTags(label(
        'What is your favourite number?',
        input(type="number", name="value"))),

The ``Qgen/htmltools.R`` script in the material bank repository has some
additional helpers to simplify this process.

* ``math`` / ``math_block``: Format the contents as either in-line math or math
  on a separate line, respectively. For example::

    p('What is the value of', math('x^2'), '?')

* ``tex_block`` / ``rst_block``: Use pandoc to convert the contents from TeX /
  ReST into HTML, respectively. This allows you to write content using LaTeX or
  restructured text instead of HTML. For example::

    withTags(tagList(
      tex_block('What is the \\emph{value} of $x^2$?')
      rst_block('What is the *value* of :math:`x^2`')))

* ``explain``: A block that is only visible once the student has answered the
  question. For example::

    explanation('The value of', math('x^2'), 'should always be positive.')

* ``data_table``: Format a ``data.table`` as an HTML table, optionally with a
  link to a source. For example::

    data_table(data.frame(a=1:10, b=2:11), source = "http://www.google.com")

* ``multiple_choice_html``: Generates HTML for multiple answers, for the
  student to select one. You should use the companion function
  ``multiple_choice_correct``, when specifying the correct answer. For example::

    withTags(tagList(
      p("Your favourite colour (should be orange):"),
      multiple_choice_html(
          c('orange', 'pink', 'blue'),
          finalchoices = c('black'),
          param_name = 'colour')))

* ``cp_box``: A "copy-paste" box. The contents will be shrunken and
  automatically selected when the user clicks on it. It is intended for code
  examples that can then be copy-pasted into their R session. For example::

    cp_box('x <- data.frame(a=1:10, b=2:11)')

Writing content using write_question()
--------------------------------------

There are helper functions in ``Qgen/functions/functions.r`` to adapt older
scripts. In particular ``write_question`` will form a multiple-choice question
with the correct output::

    source("../../Qgen/functions/functions.r")
    question <- function(permutation, data_frames) {
        write_question(
            qid,
            qtitle,
            qtext,
            choices,
            choicescorrect,
            finalchoices,
            finalchoicescorrect,
            explain)
    }

Specifying the correct answer
-----------------------------

If the material is a question, then the student will be expected to fill in the
HTML form that ``content`` contains, and the answers will be checked against
``correct``. ``correct`` is a named list of fields in the HTML form to check,
the names should match the form field names (note that in the first example,
``value`` is used). The values should be one of:

* A vector containing the right answer(s): This is most useful with a number
  input. For example::

    content = withTags(tagList(
        p("Your favourite number (should be 5 or 6):"),
        input(type="number", name="number", min="0", max="10", step="1"))),m
    correct = list(number = c(5, 6))

* ``list(nonempty = TRUE)``: Means any answer is fine, so long as there is
  something. Most useful for a text field for entering examples, e.g::

        content = withTags(tagList(
            p(class = "hints", "Write an example or proof for this lecture"),
            textarea(name="text", class="preview-as-rst", ""))),
        correct = list('_start_with' = NULL, 'text' = list(nonempty = TRUE))

Previewing material
===================

There is a helper in the material bank to let you preview question output in R.
You can start it with, e.g::

    > source('preview.R')
    > s <- material_preview('math.kcse.1/p01q01/multiple_input.q.R')

This will start a webserver using `servr <https://cran.r-project.org/package=servr>`__,
every time you refresh the page the given script will be run and the output shown in a Tutor-web window.

Any console & logging output will also be captured, for example you can use either of the following in your script to output debug information::

    logging::logdebug("woo")
    str(list(a=1, b=2))

Previewing material inside tutor-web
====================================

Content already in the material bank can be viewed by going to ``/preview``.

Your tutor-web user has to have the ``admin.material_render`` permission before being allowed to preview material.
You can add this at the commandline::

    echo username | ./server/bin/student_import --groups 'admin.material_render' -

You can then go to ``/preview`` and enter a path to a question you would like to preview.

Update
======

Before questions are available for tutor-web, you need to update the data base by running::

    ./server/bin/material_update

Data frames
===========

A question can require the student to fill in one or many tables before they
can answer questions. To do this:

1. Add a `HODF <https://github.com/shuttlethread/hodf>`__ table definition in a
   JSON file to the material bank, e.g. ``test.dataframe/heights.json``
2. At the top of any relevant question scripts, add
   ``#TW:DATAFRAMES=test.dataframe/heights.json`` to indicate the data needs to
   be collected.
3. When the question function is called, ``data_frames[['test.dataframe/heights.json']]``
   will contain the student's responses as a data.frame.

HTML Class reference
====================

Tutor-web behaviour is triggered using classes in the HTML content. Many of
these will have helpers above, but as a reference here are the possible values:

ol.shuffle
    Items within this list will be shuffled on display.

.parse-as-tex
    Parse the content of this element as LaTeX

span.math / div.math
    Parse the content as LaTeX math mode (used for rendered ReST)

.preview-as-tex / .preview-as-rst
    A preview is added below the textarea/input control with rendered markup.

.geogebra_applet
    Add a GeoGebra applet.

.reveal-on-answer
    This element won't be added on-screen until the student has answered this question.
