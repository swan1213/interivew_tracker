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

/** Mail with no job-search signal (newsletters, personal mail): listed under Other mail, never an action or application. */
export function classifyOther(rules: Classification): Classification {
  return {
    ...rules, cat: 'other', sec: '', pri: 'low', conf: 100, company: '', role: '', recruiter: '', stage: '', action: '', deadline: '', deadlineKey: '9999',
    needs: false, canReply: false, replyKind: '', mode: undefined, need: undefined, slotLen: undefined, windowDates: undefined, opts: undefined,
    facts: [], assumptions: [], times: [], platform: undefined, link: undefined, interviewer: undefined, event: undefined,
  };
}

/**
 * Classify the latest inbound message of a thread.
 * Rules always run first; when an Anthropic key is configured the model refines the
 * result and the rules output is the fallback if the call fails.
 */
export async function classifyMessage(head: ParsedMessage, thread: ParsedMessage[], now: Date = new Date(), allowModel = true): Promise<Classification> {
  const rules = classifyHeuristic(head, now);
  // Phrases like "please confirm" or "when are you free" also appear in ordinary mail; only job mail gets job categories.
  if (!rules.jobRelated && !thread.some((m) => isJobRelated(m))) return classifyOther(rules);
  if (!allowModel || !cfg.anthropicKey || cfg.mock) return rules;
  try {
    return await classifyWithClaude(head, thread, rules, now);
  } catch (e) {
    console.warn('[classify] model call failed, using rules:', (e as Error).message);
    return rules;
  }
}

/** Whether classifyMessage would ask the model about this thread (job mail, with a key configured). */
export function modelWanted(head: ParsedMessage, thread: ParsedMessage[]): boolean {
  if (!cfg.anthropicKey || cfg.mock) return false;
  return isJobRelated(head) || thread.some((m) => isJobRelated(m));
}
