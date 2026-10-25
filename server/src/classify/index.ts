import { cfg } from '../config';
import type { Classification, ParsedMessage } from '../types';
import { classifyWithClaude } from './claude';
import { classifyHeuristic } from './heuristic';

/**
 * Classify the latest inbound message of a thread.
 * Rules always run first; when an Anthropic key is configured the model refines the
 * result and the rules output is the fallback if the call fails.
 */
export async function classifyMessage(head: ParsedMessage, thread: ParsedMessage[], now: Date = new Date()): Promise<Classification> {
  const rules = classifyHeuristic(head, now);
  if (!cfg.anthropicKey || cfg.mock) return rules;
  try {
    return await classifyWithClaude(head, thread, rules, now);
  } catch (e) {
    console.warn('[classify] model call failed, using rules:', (e as Error).message);
    return rules;
  }
}
