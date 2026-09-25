LATEXMK ?= latexmk
NODE ?= node
CARGO ?= cargo

# LaTeX's \today and build timestamps use the UTC calendar.
export TZ := UTC

PAPER_SOURCE := paper/meaning-model.tex
GRAMMAR_SOURCE := paper/meaning-model-grammar.tex
BUILD_DIR := $(CURDIR)/build
OUTPUT_DIR := $(CURDIR)/output/pdf
BUILD_PDF := $(BUILD_DIR)/meaning-model.pdf
OUTPUT_PDF := $(OUTPUT_DIR)/meaning-model.pdf
GRAMMAR_BUILD_DIR := $(BUILD_DIR)/grammar
GRAMMAR_BUILD_PDF := $(GRAMMAR_BUILD_DIR)/meaning-model-grammar.pdf
GRAMMAR_OUTPUT_PDF := $(OUTPUT_DIR)/meaning-model-grammar.pdf

.PHONY: all check paper grammar book install build test test-examples test-rust test-mcp test-book verify-resources release release-export npm-package clean

all: check

check: test paper grammar book

install:
	cd mcp-server && npm ci

build:
	$(CARGO) build --manifest-path rust-engine/Cargo.toml --release

test: test-examples test-rust test-mcp test-book verify-resources

test-examples:
	$(NODE) --test examples/refinement-trial/example.test.mjs
	$(NODE) --test scripts/export-release.test.mjs

test-rust:
	$(CARGO) test --manifest-path rust-engine/Cargo.toml

test-mcp: build
	cd mcp-server && npm test
	$(NODE) examples/progressive-authoring/run.mjs

test-book: build
	$(NODE) --test --test-concurrency=1 examples/book-of-conditions/import-rust.test.mjs examples/book-of-conditions/rust-narrative.test.mjs

verify-resources:
	$(NODE) scripts/verify-resources.mjs

# Re-evaluate \today even when no source file changed overnight.
paper:
	mkdir -p "$(BUILD_DIR)" "$(OUTPUT_DIR)"
	$(LATEXMK) -g -cd -pdf -interaction=nonstopmode -halt-on-error \
		-output-directory="$(BUILD_DIR)" $(PAPER_SOURCE)
	cp "$(BUILD_PDF)" "$(OUTPUT_PDF)"

grammar:
	mkdir -p "$(GRAMMAR_BUILD_DIR)" "$(OUTPUT_DIR)"
	$(LATEXMK) -g -cd -pdf -interaction=nonstopmode -halt-on-error \
		-output-directory="$(GRAMMAR_BUILD_DIR)" $(GRAMMAR_SOURCE)
	cp "$(GRAMMAR_BUILD_PDF)" "$(GRAMMAR_OUTPUT_PDF)"

book:
	$(NODE) examples/book-of-conditions/build-story-body.mjs
	mkdir -p "$(BUILD_DIR)/book" "$(OUTPUT_DIR)"
	$(LATEXMK) -cd -pdf -interaction=nonstopmode -halt-on-error \
		-output-directory="$(BUILD_DIR)/book" examples/book-of-conditions/story.tex
	cp "$(BUILD_DIR)/book/story.pdf" "$(OUTPUT_DIR)/the-book-of-conditions.pdf"

release: check
	$(NODE) scripts/export-release.mjs

npm-package:
	cd mcp-server && npm run pack:release

release-export:
	$(NODE) scripts/export-release.mjs

clean:
	$(LATEXMK) -C -cd -pdf -output-directory="$(BUILD_DIR)" $(PAPER_SOURCE)
	$(LATEXMK) -C -cd -pdf -output-directory="$(GRAMMAR_BUILD_DIR)" $(GRAMMAR_SOURCE)
	$(RM) "$(BUILD_DIR)/meaning-model.bbl" "$(OUTPUT_PDF)" "$(GRAMMAR_OUTPUT_PDF)"
