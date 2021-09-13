import unittest

from tutorweb_quizdb.rst import to_rst


class ToRstTest(unittest.TestCase):
    maxDiff = None

    def test_to_rst(self):
        self.assertEqual(to_rst("""
Moo
^^^

This is a *rubbish* example.
        """.strip()), """
<h1>Moo</h1><p>This is a <em>rubbish</em> example.</p>
        """.strip())

        self.assertEqual(to_rst("""
When :math`a \ne 0`, there are two solutions to :math:`ax^2 + bx + c = 0`
and they are

.. math::

   x = {-b \\pm \\sqrt{b^2-4ac} \\over 2a}
        """.strip()), """
<p>When :math`a
e 0`, there are two solutions to <span class="math">\\(ax^2 + bx + c = 0\\)</span>
and they are</p><div class="math">\\begin{equation*}
x = {-b \\pm \\sqrt{b^2-4ac} \\over 2a}
\\end{equation*}</div>
        """.strip())

    def test_parsing_errors(self):
        """Errors & warnings get captured and appended to top"""
        self.assertEqual(to_rst("""
``transactions`` is a json array of json objects:

``
[
        {
                \"txid\": \"id\",
                \"vout\": n
        },
        ...
]
``
        """.strip()), """
<div class="system-message severe"><div class="system-message-title">System message:</div>&lt;string&gt;:9: (SEVERE/4) Unexpected section title.

},
...</div><pre>``transactions`` is a json array of json objects:

``
[
        {
                &quot;txid&quot;: &quot;id&quot;,
                &quot;vout&quot;: n
        },
        ...
]
``</pre>
        """.strip())

        self.assertEqual(to_rst("""
Camel camel
    camel
Camel
        """.strip()), """
<div class="system-message warning"><div class="system-message-title">System message:</div>&lt;string&gt;:3: (WARNING/2) Definition list ends without a blank line; unexpected unindent.
</div><dl><dt>Camel camel</dt><dd><p>camel</p></dd></dl><div class="alert-message block-message system-message warning"><p class="system-message-title admonition-title">System Message: WARNING/2</p><span class="literal">&amp;lt;string&amp;gt;</span>line 3 <p>Definition list ends without a blank line; unexpected unindent.</p></div><p>Camel</p>
        """.strip())

        self.assertEqual(to_rst("""
Camel
camel
    camel
        """.strip()), """
<div class="system-message warning"><div class="system-message-title">System message:</div>&lt;string&gt;:3: (ERROR/3) Unexpected indentation.
</div><p>Camel
camel</p><div class="alert-message block-message system-message error"><p class="system-message-title admonition-title">System Message: ERROR/3</p><span class="literal">&amp;lt;string&amp;gt;</span>line 3 <p>Unexpected indentation.</p></div><blockquote><p>camel</p></blockquote>
        """.strip())
