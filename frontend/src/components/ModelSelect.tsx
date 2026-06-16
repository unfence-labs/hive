import type { ModelCatalogEntry } from "@/types";

/** Model dropdown shared by the agent and automation forms. */
export function ModelSelect({
  value,
  onChange,
  models,
}: {
  value: string;
  onChange: (id: string) => void;
  models: ModelCatalogEntry[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label} ({m.providerLabel})
        </option>
      ))}
    </select>
  );
}
