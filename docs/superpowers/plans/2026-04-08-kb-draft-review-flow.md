# Knowledge Base Draft Review Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-dialog draft review flow so chat extraction generates an editable Markdown draft first, and only saves to the knowledge base after explicit user confirmation.

**Architecture:** Split the current extract action into two backend endpoints: one generates a draft from chat history, the other persists the reviewed Markdown file into `KB_ROOT_URI`. Update the knowledge-base dialog to use a two-step form/review state machine and refresh/open the saved file after persistence.

**Tech Stack:** TypeScript, Express, React, Vitest, node-mocks-http

---

### Task 1: Backend Draft Contract

**Files:**
- Modify: `src/kb-proxy.ts`
- Test: `src/kb-proxy-draft.test.ts`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement minimal draft generation helpers**
- [ ] **Step 4: Run test to verify it passes**

### Task 2: Backend Routes

**Files:**
- Modify: `src/kb-routes.ts`
- Test: `src/kb-routes-draft.test.ts`

- [ ] **Step 1: Write the failing route tests**
- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement `POST /api/kb/extract-draft` and `POST /api/kb/save-draft`**
- [ ] **Step 4: Run tests to verify they pass**

### Task 3: Frontend Dialog Flow

**Files:**
- Modify: `frontend/src/components/kb/KBExtractDialog.tsx`
- Modify: `frontend/src/pages/KnowledgeBase.tsx`
- Test: `frontend/src/components/kb/KBExtractDialog.test.tsx`

- [ ] **Step 1: Write the failing dialog flow tests**
- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement form/review state machine and save callback**
- [ ] **Step 4: Run tests to verify they pass**

### Task 4: Verification

**Files:**
- Modify: `src/kb-proxy.ts`
- Modify: `src/kb-routes.ts`
- Modify: `frontend/src/components/kb/KBExtractDialog.tsx`
- Modify: `frontend/src/pages/KnowledgeBase.tsx`

- [ ] **Step 1: Run focused backend and frontend tests**
- [ ] **Step 2: Run `npm run typecheck`**
- [ ] **Step 3: Run `npm run build`**
