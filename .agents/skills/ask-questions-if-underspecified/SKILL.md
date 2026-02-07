---
name: ask-questions-if-underspecified
description: clarify requirements before implementing. use when serious doubts arise.
version: "1.0.1"
metadata:
  repository: "https://github.com/trailofbits/skills"
  url: "https://github.com/trailofbits/skills/tree/c9b644a/plugins/ask-questions-if-underspecified/skills/ask-questions-if-underspecified"
---

# ask questions if underspecified

## when to use

use this skill when a request has multiple plausible interpretations or key details (objective, scope, constraints, environment, or safety) are unclear.

## when not to use

do not use this skill when the request is already clear, or when a quick, low-risk discovery read can answer the missing details.

## goal

ask the minimum set of clarifying questions needed to avoid wrong work; do not start implementing until the must-have questions are answered (or the user explicitly approves proceeding with stated assumptions).

## workflow

### 1) decide whether the request is underspecified

treat a request as underspecified if after exploring how to perform the work, some or all of the following are not clear:

- define the objective (what should change vs stay the same)
- define "done" (acceptance criteria, examples, edge cases)
- define scope (which files/components/users are in/out)
- define constraints (compatibility, performance, style, deps, time)
- identify environment (language/runtime versions, os, build/test runner)
- clarify safety/reversibility (data migration, rollout/rollback, risk)

if multiple plausible interpretations exist, assume it is underspecified.

### 2) ask must-have questions first (keep it small)

ask 1-5 questions in the first pass. prefer questions that eliminate whole branches of work.

make questions easy to answer:

- optimize for scannability (short, numbered questions; avoid paragraphs)
- offer multiple-choice options when possible
- suggest reasonable defaults when appropriate (mark them clearly as the default/recommended choice; bold the recommended choice in the list, or if you present options in a code block, put a bold "recommended" line immediately above the block and also tag defaults inside the block)
- include a fast-path response (e.g., reply `defaults` to accept all recommended/default choices)
- include a low-friction "not sure" option when helpful (e.g., "not sure - use default")
- separate "need to know" from "nice to know" if that reduces friction
- structure options so the user can respond with compact decisions (e.g., `1b 2a 3c`); restate the chosen options in plain language to confirm

### 3) pause before acting

until must-have answers arrive:

- do not run commands, edit files, or produce a detailed plan that depends on unknowns
- do perform a clearly labeled, low-risk discovery step only if it does not commit you to a direction (e.g., inspect repo structure, read relevant config files)

if the user explicitly asks you to proceed without answers:

- state your assumptions as a short numbered list
- ask for confirmation; proceed only after they confirm or correct them

### 4) confirm interpretation, then proceed

once you have answers, restate the requirements in 1-3 sentences (including key constraints and what success looks like), then start work.

## question templates

- "before i start, i need: (1) ..., (2) ..., (3) .... if you don't care about (2), i will assume ...."
- "which of these should it be? a) ... b) ... c) ... (pick one)"
- "what would you consider 'done'? for example: ..."
- "any constraints i must follow (versions, performance, style, deps)? if none, i will target the existing project defaults."
- use numbered questions with lettered options and a clear reply format

```text
1) scope?
a) minimal change (default)
b) refactor while touching the area
c) not sure - use default
2) compatibility target?
a) current project defaults (default)
b) also support older versions: <specify>
c) not sure - use default

reply with: defaults (or 1a 2a)
```

## anti-patterns

- don't ask questions you can answer with a quick, low-risk discovery read (e.g., configs, existing patterns, docs).
- don't ask open-ended questions if a tight multiple-choice or yes/no would eliminate ambiguity faster.
