GIT = git
NPM = npm
YARN = yarn
NODE = node
NODE != which node || which nodejs
NODE_CMD = NODE_PATH="$(CURDIR)" $(NODE)
SHELL=/bin/bash -o pipefail

OUTPUTS := admin coin index preview stage test/select_list test/progress test/rendertex

OUT_FILES = \
    www/geogebra \
    www/js/polyfill.min.js \
    www/js/libraries.min.js \
    www/serviceworker.js \
    www/css/libraries.min.css \
    $(foreach O,$(OUTPUTS),www/$(O).html www/js/$(O).min.js www/css/$(O).min.css)

LIBRARIES_JS = \
    handsontable \
    jquery \

LIBRARIES_CSS = \
    node_modules/bootstrap/dist/css/bootstrap-reboot.min.css \
    node_modules/bootstrap/dist/css/bootstrap-grid.min.css \
    node_modules/handsontable/dist/handsontable.min.css \

all: test lint compile

www/geogebra:
	[ -f "/tmp/ggb-bundle.zip" ] || wget -O /tmp/ggb-bundle.zip https://download.geogebra.org/package/geogebra-math-apps-bundle
	unzip -o /tmp/ggb-bundle.zip -d $@

compile: node_modules/ clean-unused $(OUT_FILES)

start: all

test: node_modules/
	yarn run test

coverage: node_modules/
	yarn run coverage
	mkdir -p www/coverage/client/
	yarn run nyc report --reporter=html --report-dir=www/coverage/client/

lint: node_modules/
	yarn run lint

clean:
	rm -r -- "node_modules/" || true
	rm -- $(OUT_FILES) || true

clean-unused:
	for f in $(filter-out \
	    $(foreach f,$(OUT_FILES),$(shell dirname $(f))/$(shell readlink $(f))), \
	    $(wildcard www/*/*.min.r*.* www/*/*/*.min.r*.*) \
	); do rm -- $$f; done

watch:
	while inotifywait -r lib; do make compile; done

upgrade: node_modules/
	$(YARN) upgrade-interactive --latest

node_modules/: package.json yarn.lock
	$(YARN) install --link-duplicates --frozen-lockfile
	touch node_modules/

yarn.lock:
	touch $@

# Move minified output to a version with sha1 hash in it's name, symlink to proper output
# (extension), (source-tempfile), (symlink-dest)
sha1_symlink = \
    REV_FILE="$$(dirname $(3))/$$(basename $(3) .min.$(1)).min.r$$(sha1sum $(2) | head -c7).$(1)"; \
    mv $(2) $$REV_FILE; \
    ln -rsf $$REV_FILE $(3)

# Generate environment variables that point to the sha1 hash version
sha1_envvars = \
    for f in $(1); do \
        eval sha_$$(basename $$f | sed 's/\W/_/g')=$$(readlink $$f); \
    done;

www/js/libraries.min.js: package.json
	mkdir -p $(dir $@)
	(cd www/js && ln -sf ../../node_modules .)
	$(NODE_CMD) node_modules/.bin/browserify \
	        $(foreach l,$(LIBRARIES_JS),-r $(l)) \
	    | $(NODE_CMD) node_modules/.bin/uglifyjs \
	        --compress --mangle "reserved=['$$','require','exports']" \
	        --output $@.mktmp
	$(call sha1_symlink,js,$@.mktmp,$@)

www/css/libraries.min.css: package.json
	mkdir -p $(dir $@)
	(cd www/css && ln -sf ../../lib .)
	cat $(LIBRARIES_CSS) > $@.mktmp
	$(call sha1_symlink,css,$@.mktmp,$@)

www/js/%.min.js: lib/%.js lib/*.js package.json
	mkdir -p $(dir $@)
	(cd www/js && ln -sf ../../lib .)
	$(NODE_CMD) node_modules/.bin/browserify --debug \
	        $(foreach l,$(LIBRARIES_JS),-x $(l)) \
	        $< \
	    | $(NODE_CMD) node_modules/.bin/uglifyjs \
	        --compress --mangle "reserved=['$$','require','exports']" \
	        --source-map "content='inline',url='$(notdir $@).map'" \
	        --output $@.mktmp
	mv $@.mktmp.map $@.map
	$(call sha1_symlink,js,$@.mktmp,$@)

www/css/%.min.css: lib/%.css lib/*.css package.json
	mkdir -p $(dir $@)
	(cd www/css && ln -sf ../../lib .)
	$(NODE_CMD) node_modules/postcss-cli/bin/postcss \
	    --config postcss.config.js \
	    -o $@.mktmp \
	    $<
	mv $@.mktmp.map $@.map
	$(call sha1_symlink,css,$@.mktmp,$@)

www/%.html: lib/%.html lib/base.html $(filter-out %.html,$(OUT_FILES)) \
    ../.local-conf \
    build/html_compile.js \
    package.json
	set -a; \
	    [ -f ../.local-conf ] && . ../.local-conf; \
	    $(call sha1_envvars,$(OUT_FILES)) \
	    $(NODE_CMD) build/html_compile.js $< $@.mktmp $^
	mv $@.mktmp $@

www/serviceworker.js: lib-sw/*.js $(filter-out www/serviceworker.js %.html www/geogebra,$(OUT_FILES))
	echo "appResources = [" > $@
	for f in $(subst www/,,$(filter-out www/test/% www/css/test/% www/js/test/% www/geogebra,$(OUT_FILES))); do echo "    '$$f'," >> $@; done
	echo "];" >> $@
	cat lib-sw/*.js >> $@
	@echo "" >> $@
	@echo -n "// MD5: " >> $@
	@cat $+ | md5sum | cut -d' ' -f1 >> $@

.PHONY: compile test coverage start lint clean clean-unused watch
