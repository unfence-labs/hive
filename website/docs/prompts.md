---
title: Prompts & templates
description: Control what your agents are told.
---

# Prompts & templates

Hive layers a small editable prompt system on top of each provider's native harness. Nothing is hidden. Every prompt is a Markdown file you can read and edit in *Settings → Prompt*.

## The three system prompts

| Prompt | Used for | Default behavior |
|---|---|---|
| **Build Agent prompt** | Workspace chat and project automations | Describes the Hive environment and working rules. |
| **Brain Agent prompt** | Brain chat | Explains the knowledge base role. A map of the Brain's file paths is appended automatically. |
| **Issue draft prompt** | Workspaces sourced from an issue | Not a system prompt. It renders the editable message that **prefills your composer** when a workspace is created from an issue. |

Each can be edited or reset to its default. Hive *appends* its prompt to the provider's own system prompt. It never replaces the harness prompt. The CLI's native behavior stays intact.

## Variables

Prompts support interpolation variables:

**Build / Brain prompts**

| Variable | Resolves to |
|---|---|
| `{DIR}` | The workspace path the agent runs in |
| `{PROJECT}` | The project name |
| `{DEFAULT_BRANCH}` | The project's default branch |

**Issue draft prompt**

| Variable | Resolves to |
|---|---|
| `{NUMBER}` | Issue number |
| `{TITLE}` | Issue title |
| `{URL}` | Issue URL |
| `{BODY}` | Issue body |

## Git context injection

For workspace and automation sessions Hive automatically appends a **git context block**. This is a snapshot taken at session start:

- the project and workspace and current branch and main branch;
- the **workspace source**. It is the originating branch or an issue or a pull request. An issue carries its number and title and URL. A pull request carries its number and title and URL and base branch. Hive adds instructions to update the existing PR rather than open a new one. Hive adds a warning for fork PRs;
- `git status` and the last ten commits.

Chat sessions also get a note about the live browser panel so agents know they can drive a visible browser.

## Prompt templates

Templates are named reusable **user prompts**. They are the "what to do" text that [automations](/docs/automations) run on a schedule. Create them in *Settings → Prompt*. An automation references a template by name so editing the template updates every automation using it. Or it carries its own inline prompt. A template can't be deleted while an automation references it.
