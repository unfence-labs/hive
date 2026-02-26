import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import {
  loadPromptTemplates,
  savePromptTemplate,
  deletePromptTemplate,
  withTemplatesLock,
} from "../state/prompt-templates.js";
import { loadAutomations } from "../state/automations.js";
import { getDataDir } from "../state/state.js";
import type { CreatePromptTemplateRequest, UpdatePromptTemplateRequest, PromptTemplate } from "../types.js";

interface PromptTemplateRoutesOptions {
  dataDir?: string;
}

export async function promptTemplateRoutes(
  app: FastifyInstance,
  opts: PromptTemplateRoutesOptions = {},
): Promise<void> {
  const dataDir = opts.dataDir ?? getDataDir();

  // ── List all templates ──────────────────────────────────────────────
  app.get("/api/prompt-templates", async () => {
    return loadPromptTemplates(dataDir);
  });

  // ── Create template ─────────────────────────────────────────────────
  app.post<{ Body: CreatePromptTemplateRequest }>("/api/prompt-templates", async (req, reply) => {
    const { name, type, content } = req.body;

    if (!name?.trim()) {
      return reply.status(400).send({ error: "Name is required" });
    }
    if (type !== "system" && type !== "user") {
      return reply.status(400).send({ error: "Type must be 'system' or 'user'" });
    }
    if (!content?.trim()) {
      return reply.status(400).send({ error: "Content is required" });
    }

    const now = new Date().toISOString();
    const template: PromptTemplate = {
      id: `tpl-${nanoid(8)}`,
      name: name.trim(),
      type,
      content: content.trim(),
      createdAt: now,
      updatedAt: now,
    };

    await withTemplatesLock(async () => {
      await savePromptTemplate(template, dataDir);
    });

    return reply.status(201).send(template);
  });

  // ── Update template ─────────────────────────────────────────────────
  app.put<{ Params: { id: string }; Body: UpdatePromptTemplateRequest }>(
    "/api/prompt-templates/:id",
    async (req, reply) => {
      const { id } = req.params;
      const updates = req.body;

      const updated = await withTemplatesLock(async () => {
        const templates = await loadPromptTemplates(dataDir);
        const existing = templates.find((t) => t.id === id);
        if (!existing) return null;

        const merged: PromptTemplate = {
          ...existing,
          ...(updates.name !== undefined && { name: updates.name.trim() }),
          ...(updates.content !== undefined && { content: updates.content.trim() }),
          updatedAt: new Date().toISOString(),
        };
        await savePromptTemplate(merged, dataDir);
        return merged;
      });

      if (!updated) return reply.status(404).send({ error: "Template not found" });
      return updated;
    },
  );

  // ── Delete template ─────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>("/api/prompt-templates/:id", async (req, reply) => {
    const { id } = req.params;

    // Check if any automation references this template
    const automations = await loadAutomations(dataDir);
    const referencedBy = automations.find(
      (a) => a.action.systemPromptId === id || a.action.userPromptId === id,
    );
    if (referencedBy) {
      return reply.status(409).send({
        error: `Template is referenced by automation "${referencedBy.name}"`,
      });
    }

    const found = await withTemplatesLock(async () => {
      return deletePromptTemplate(id, dataDir);
    });

    if (!found) return reply.status(404).send({ error: "Template not found" });
    return reply.status(204).send();
  });
}
