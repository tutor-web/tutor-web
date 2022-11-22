import hashlib
import os.path
import re

import git


MAX_TEMPLATE_PERMUTATIONS = 10  # After this we consider them ugmaterial


def path_tags(path):
    """
    Return tags based on the file (path), read what type it is
    """
    if path.endswith('.q.R'):
        return ['type.question']
    if path.endswith('.e.R'):
        return ['type.example']
    if path.endswith('.t.R'):
        return ['type.template']
    return []


def parse_list(line):
    """
    Turn comma-separated (line) into a sequence of items, ignoring whitespace
    """
    for l in line.split(','):
        x = l.strip()
        if x:
            yield x


def file_md5sum(path):
    """
    Return MD5-sum string of file at (path)
    """
    with open(path, 'rb') as f:
        return(hashlib.md5(f.read()).hexdigest())


def _file_revision(material_bank, path, prev_revision, git_broken_okay=False):
    """
    Find out git revision for file, adding to it for each dirty version we see
    """
    # Get git revision for file
    repo = git.Repo(material_bank)
    git_revision = '(untracked)'
    try:
        revs = repo.iter_commits(paths=path, max_count=1)
    except ValueError as e:
        if git_broken_okay:
            # NB: Later versions of git can fail to read version information on a repository we don't own:
            #     ValueError: SHA could not be resolved, git returned: b''
            #     /preview has no need for the revision anyway, so ignore the error.
            return '(git-error)'
        raise e
    for rev in revs:
        git_revision = str(rev)

    m = re.search(r'^(.*)\+(\d+)$', prev_revision) if prev_revision else None
    if m and m.group(1) == git_revision:
        # The previous git revision is the same as this one, our count should be one higher
        rev_count = int(m.group(2) or '0') + 1
    elif prev_revision == git_revision:
        # We're part of the same revision, which was clean from git
        # NB: We know at this point the file is different, no point re-checking
        rev_count = 1
    else:
        # New revision, start from 1 if it's dirty
        is_dirty = repo.is_dirty(path=path, untracked_files=True)
        rev_count = 1 if is_dirty else 0

    # Add rev_count to git_revision if it's greater than zero
    return "%s+%d" % (git_revision, rev_count) if rev_count > 0 else git_revision


def material_bank_open(material_bank, path, *args):
    combined_path = os.path.normpath(os.path.join(material_bank, path))
    if not combined_path.startswith(material_bank):
        raise ValueError("%s not in %s" % (path, material_bank))
    return open(combined_path, *args)


def path_to_materialsource(material_bank, path, prev_revision, git_broken_okay=False):
    """
    Read in metadata from file, turn into dict of options
    to create materialsource
    """
    file_metadata = dict(TAGS='')
    setting_re = re.compile(r'^[#]\s*TW:(\w+)=(.*)')
    try:
        with material_bank_open(material_bank, path, 'r') as f:
            for line in f:
                m = setting_re.search(line)
                if m:
                    file_metadata[m.group(1)] = m.group(2)
        revision = _file_revision(material_bank, path, prev_revision, git_broken_okay)
    except FileNotFoundError:
        file_metadata = dict(
            PERMUTATIONS=0,
            TAGS='deleted',
        )
        revision = "(deleted)"
    file_metadata['TAGS'] = list(parse_list(file_metadata.get('TAGS', '')))
    file_metadata['PERMUTATIONS'] = int(file_metadata.get('PERMUTATIONS', 1))

    # Add to tags based on file-name
    file_metadata['TAGS'].extend(path_tags(path))

    # Check that templates don't have more than MAX_TEMPLATE_PERMUTATIONS: The rest are for student answers
    if 'type.template' in file_metadata['TAGS']:
        if file_metadata['PERMUTATIONS'] > MAX_TEMPLATE_PERMUTATIONS:
            raise ValueError("Material templates can only have up to %d permutations" % MAX_TEMPLATE_PERMUTATIONS)

    return dict(
        bank=material_bank,
        path=os.path.normpath(path),
        revision=revision,
        permutation_count=file_metadata['PERMUTATIONS'],
        material_tags=file_metadata['TAGS'],
        dataframe_paths=list(parse_list(file_metadata.get('DATAFRAMES', ''))),
        initial_answered=int(file_metadata.get('TIMESANSWERED', 0)),
        initial_correct=int(file_metadata.get('TIMESCORRECT', 0)),
    )
