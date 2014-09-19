GIT = git
NPM = npm
NODEJS = node

NODE_PATH = node_modules

all: install_dependencies test lint tutorweb/quiz/resources/tw.js

pre_commit: lint tutorweb/quiz/resources/tw.js

test: install_dependencies
	NODE_PATH=$(NODE_PATH) $(NODEJS) tests/run-tests.js

lint:
	$(NODEJS) node_modules/jslint/bin/jslint lib/*.js

install_dependencies:: repo_hooks
	NODE_PATH=$(NODE_PATH) $(NPM) install

repo_hooks:
	(cd .git/hooks/ && ln -sf ../../hooks/pre-commit pre-commit)

# NB: We use .js.map.js here, so Python interprets as application/javascript
# and Diazo doesn't XHTMLify. We could add to /etc/mime.types but that's unfriendly
# to other developers
tutorweb/quiz/resources/tw.js: lib/*.js
	NODE_PATH=$(NODE_PATH) $(NODEJS) $(NODE_PATH)/browserify/bin/cmd.js --debug lib/*.js | $(NODEJS) $(NODE_PATH)/exorcist/bin/exorcist.js tutorweb/quiz/resources/tw.js.map.js > tutorweb/quiz/resources/tw.js

tests/html/tw-test.js: lib/*.js tests/html/mock-tutorial.js
	NODE_PATH=$(NODE_PATH) $(NODEJS) $(NODE_PATH)/browserify/bin/cmd.js --debug lib/*.js tests/html/mock-tutorial.js > tests/html/tw-test.js

webserver: tutorweb/quiz/resources/tw.js tests/html/tw-test.js
	git submodule update --init
	NODE_PATH=$(NODE_PATH) $(NODEJS) tests/html/server.js

.PHONY: pre_commit test lint install_dependencies repo_hooks watch webserver
