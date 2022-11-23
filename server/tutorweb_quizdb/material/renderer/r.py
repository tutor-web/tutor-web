import json
import os
import threading
import warnings

import rpy2.rinterface
import rpy2.robjects as robjects
from rpy2.rinterface import RRuntimeWarning
from rpy2.robjects.packages import importr

R_INTERPRETER_LOCK = threading.Lock()
jsonlite = importr("jsonlite")


def rob_to_dict(a):
    """
    Take R Object and turn it into something JSON-parsable
    """
    if isinstance(a, robjects.vectors.ListVector):
        if 'shiny.tag' in set(a.rclass) or 'shiny.tag.list' in set(a.rclass):
            return robjects.r['as.character'](a)[0]
        elif a.names:
            return dict(zip(a.names, [rob_to_dict(x) for x in a]))
        else:
            # No names, treat it as an array, combining vectors within
            out = []
            for x in a:
                out += rob_to_dict(x)
            return out
    elif isinstance(a, rpy2.rinterface.RNULLType):
        return None
    else:
        return [
            None
            if isinstance(x, rpy2.rinterface.NALogicalType)
            else x
            for x in a]


def r_render(ms, permutation, student_dataframes={}):
    """Execute R script to generate content"""
    # TODO: Caching of question objects?
    with R_INTERPRETER_LOCK:
        try:
            old_wd = os.getcwd()
            robjects.r('''question <- function () stop("R question script did not define a question function")''')
            robjects.r('''setwd''')(os.path.dirname(os.path.join(ms.bank, ms.path)))
            robjects.r('''source''')(os.path.join(ms.bank, ms.path))
            r_student_dataframes = jsonlite.fromJSON(
                json.dumps(student_dataframes),
            )
            warnings.filterwarnings("ignore", category=RRuntimeWarning)
            rob = robjects.globalenv['question'](permutation, r_student_dataframes)
            # TODO: Stacktraces?
            try:
                rv = rob_to_dict(rob)
            except Exception as e:
                raise ValueError("R question output not parsable %s\n%s" % (rob, e))

            if 'content' not in rv:
                raise ValueError("R question %s did not return 'content'" % ms.path)
            rv['content'] = "".join(rv['content'])
            return rv
        finally:
            os.chdir(old_wd)
