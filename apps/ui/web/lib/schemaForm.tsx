/**
 * Generates a form from a workflow's input JSON Schema (derived from its zod
 * schema on the server). Supports string, number, boolean, enum, and
 * string/number arrays (comma-separated entry).
 */
import { useState } from "react";
import type { JsonSchema } from "./api.js";

export interface SchemaFormProps {
  schema: JsonSchema;
  value: Record<string, unknown>;
  onChange(value: Record<string, unknown>): void;
}

function unwrapType(field: JsonSchema): string {
  if (field.enum) return "enum";
  if (field.type === "array") return "array";
  if (field.type === "integer") return "number";
  return field.type ?? "string";
}

export function defaultsFromSchema(schema: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.properties ?? {})) {
    if (field.default !== undefined) out[key] = field.default;
    else if (unwrapType(field) === "boolean") out[key] = false;
  }
  return out;
}

export function SchemaForm({ schema, value, onChange }: SchemaFormProps) {
  const properties = Object.entries(schema.properties ?? {});
  const required = new Set(schema.required ?? []);

  if (properties.length === 0) {
    return <p className="dim">This workflow takes no inputs.</p>;
  }

  const set = (key: string, fieldValue: unknown) => onChange({ ...value, [key]: fieldValue });

  return (
    <div className="form">
      {properties.map(([key, field]) => {
        const kind = unwrapType(field);
        const label = (
          <label htmlFor={`field-${key}`}>
            {key}
            {required.has(key) ? " *" : ""}
            {field.description ? <span className="hint"> — {field.description}</span> : null}
          </label>
        );

        if (kind === "boolean") {
          return (
            <div className="field checkbox" key={key}>
              <input
                id={`field-${key}`}
                type="checkbox"
                checked={Boolean(value[key])}
                onChange={(e) => set(key, e.target.checked)}
              />
              {label}
            </div>
          );
        }

        if (kind === "enum") {
          return (
            <div className="field" key={key}>
              {label}
              <select
                id={`field-${key}`}
                value={String(value[key] ?? "")}
                onChange={(e) => set(key, e.target.value)}
              >
                <option value="" disabled>
                  select…
                </option>
                {(field.enum ?? []).map((option) => (
                  <option key={String(option)} value={String(option)}>
                    {String(option)}
                  </option>
                ))}
              </select>
            </div>
          );
        }

        if (kind === "array") {
          const itemsAreNumbers = field.items?.type === "number" || field.items?.type === "integer";
          return (
            <div className="field" key={key}>
              {label}
              <ArrayInput
                id={`field-${key}`}
                initial={Array.isArray(value[key]) ? (value[key] as unknown[]).join(", ") : ""}
                onItems={(items) => set(key, itemsAreNumbers ? items.map(Number) : items)}
              />
            </div>
          );
        }

        if (kind === "number") {
          return (
            <div className="field" key={key}>
              {label}
              <input
                id={`field-${key}`}
                type="number"
                value={value[key] === undefined ? "" : String(value[key])}
                min={field.minimum}
                max={field.maximum}
                onChange={(e) => set(key, e.target.value === "" ? undefined : Number(e.target.value))}
              />
            </div>
          );
        }

        return (
          <div className="field" key={key}>
            {label}
            <input
              id={`field-${key}`}
              type="text"
              value={String(value[key] ?? "")}
              onChange={(e) => set(key, e.target.value)}
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Comma-separated array entry. Keeps its own raw text state so typing a comma
 * isn't erased by the parse→join round trip; the parsed items are pushed up
 * on every keystroke.
 */
function ArrayInput({
  id,
  initial,
  onItems,
}: {
  id: string;
  initial: string;
  onItems(items: string[]): void;
}) {
  const [text, setText] = useState(initial);
  return (
    <input
      id={id}
      type="text"
      placeholder="comma, separated, values"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onItems(
          e.target.value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        );
      }}
    />
  );
}
