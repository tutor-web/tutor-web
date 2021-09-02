from tutorweb_quizdb import Base, DBSession  # noqa


def script_console():
    from tutorweb_quizdb import setup_script

    argparse_arguments = [
        dict(description='Run a python debugger in useful environment'),
    ]

    with setup_script(argparse_arguments) as env:  # noqa
        import pdb
        pdb.set_trace()
