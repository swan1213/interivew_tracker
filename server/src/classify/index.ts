import { cfg } from '../config';
import type { Classification, ParsedMessage } from '../types';
import { classifyWithClaude } from './claude';
import { classifyHeuristic, firstSentences, isJobRelated } from './heuristic';

/** A conversation you started that has no reply yet: listed under Sent, nothing to do. */
export function classifySent(m: ParsedMessage): Classification {
  return {
    classifier: 'rules', jobRelated: isJobRelated(m), cat: 'sent', sec: '', pri: 'low', conf: 100,
    company: '', role: '', recruiter: '', stage: '', action: '', deadline: '', deadlineKey: '9999',
    needs: false, canReply: false, replyKind: '', summary: firstSentences(m.bodyText, 2, 220), facts: [], assumptions: [], times: [],
  };
}

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
