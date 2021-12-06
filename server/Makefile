PROJECT=tutorweb
SHELL=/bin/bash -o pipefail

all: compile test lint

bin/pip:
	python3 -m venv .

lib/.requirements: requirements.txt requirements-to-freeze.txt setup.py bin/pip
	# Install frozen requirements
	./bin/pip install -r requirements.txt
	# Make sure any new requirements are available
	./bin/pip install -r requirements-to-freeze.txt
	# Freeze the output at current state
	./bin/pip freeze | grep -v egg=tutorweb_quizdb > requirements.txt
	touch lib/.requirements

compile: lib/.requirements application.ini

test: compile
	# Quell pytest warnings: https://github.com/pytest-dev/pytest/issues/1403
	./bin/python -Wignore:::_pytest.assertion.rewrite -m pytest tests/test_*.py

lint: lib/.requirements
	./bin/flake8 --ignore=E501,E741,W504 tutorweb_quizdb/ tests/

coverage: compile
	./bin/coverage run ./bin/py.test tests/
	./bin/coverage html
	ln -rsf htmlcov ../client/www/htmlcov
	echo Visit http://...//htmlcov/index.html

application.ini: ./application.ini.sh ../install.sh ../.local-conf
	(cd .. && ./install.sh --exec server/application.ini.sh server/$@)

start: compile
	./bin/pserve application.ini

.PHONY: compile test lint coverage start
