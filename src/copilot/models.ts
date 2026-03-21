import { config } from "../config.js";
import { getClient } from "./client.js";

export interface AvailableModel {
  id: string;
  label: string;
  description: string;
}

const FALLBACK_MODELS: AvailableModel[] = [
  { id: "claude-sonnet-4.6", label: "Claude Sonnet 4.6", description: "Standard default for most coding tasks" },
  { id: "claude-opus-4.6", label: "Claude Opus 4.6", description: "Premium reasoning for deeper analysis" },
  { id: "gpt-5.4", label: "GPT-5.4", description: "Strong general-purpose OpenAI model" },
  { id: "gpt-5.1", label: "GPT-5.1", description: "Fast OpenAI model" },
  { id: "gpt-4.1", label: "GPT-4.1", description: "Included baseline model" },
];

function dedupeModels(models: AvailableModel[]): AvailableModel[] {
  const seen = new Set<string>();
  const deduped: AvailableModel[] = [];
  for (const model of models) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    deduped.push(model);
  }
  return deduped;
}

export async function listAvailableModels(): Promise<AvailableModel[]> {
  try {
    const client = await getClient();
    const models = await client.listModels();
    const available = models
      .filter((model) => model.policy?.state === "enabled" && !model.name.includes("(Internal only)"))
      .map((model) => {
        const multiplier = model.billing?.multiplier;
        return {
          id: model.id,
          label: model.name,
          description:
            multiplier === 0 || multiplier === undefined
              ? "Included with Copilot"
              : `Premium (${multiplier}x)`,
        };
      });

    return dedupeModels([
      ...available,
      { id: config.copilotModel, label: config.copilotModel, description: "Current Max default model" },
    ]);
  } catch {
    return dedupeModels([
      ...FALLBACK_MODELS,
      { id: config.copilotModel, label: config.copilotModel, description: "Current Max default model" },
    ]);
  }
}
