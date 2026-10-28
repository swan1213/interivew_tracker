import { describe, expect, it } from 'vitest';
import { bookingLink, linkLabel, linkParts, selfServe } from './links';

describe('links in message text', () => {
  it('turns bracketed tracking links into short tags and keeps the sentence around them', () => {
    const t = 'Fortune 500 companies [ https://substack.com/redirect/a55cf6ab-bbd5?j=eyJ1 ], sharing my experiences.';
    expect(linkParts(t)).toEqual([
      { text: 'Fortune 500 companies ' },
      { url: 'https://substack.com/redirect/a55cf6ab-bbd5?j=eyJ1', label: 'substack.com' },
      { text: ', sharing my experiences.' },
    ]);
  });

  it('leaves trailing punctuation out of the link and shows short paths in full', () => {
    expect(linkParts('See https://www.adoreal.com/careers.')).toEqual([{ text: 'See ' }, { url: 'https://www.adoreal.com/careers', label: 'adoreal.com/careers' }, { text: '.' }]);
    expect(linkLabel('https://jobs.smartrecruiters.com/my-applications/KeywordsStudios/89724ec0-5131-4117-90a9')).toBe('jobs.smartrecruiters.com');
    expect(linkParts('no links here')).toEqual([{ text: 'no links here' }]);
  });
});

describe('bookingLink', () => {
  it('finds a self-scheduling page or a video interview, not other links', () => {
    expect(bookingLink('See https://www.nice.com/company and https://s101.recruiting.eu.greenhouse.io/schedule/-n2XU?utm_medium=email')).toEqual({ kind: 'book', url: 'https://s101.recruiting.eu.greenhouse.io/schedule/-n2XU?utm_medium=email' });
    expect(bookingLink('share your availability: https://you.ashbyhq.com/meeting/eaebe227')?.kind).toBe('book');
    expect(bookingLink('Start your interview here: https://app.hireflix.com/cP4GjVmyRZhK')).toEqual({ kind: 'video', url: 'https://app.hireflix.com/cP4GjVmyRZhK' });
    expect(bookingLink('Learn more at https://www.rebuyengine.com/careers')).toBeNull();
  });
});

describe('selfServe', () => {
  it('knows booking pages, AI and video interviews by their links or their wording', () => {
    expect(selfServe('please share your availability by selecting time slots here: Enter your availability now > ( https://s101.recruiting.eu.greenhouse.io/availability/0156 )')).toMatchObject({ kind: 'book', url: expect.stringContaining('greenhouse.io/availability') });
    expect(selfServe('Click on this link: https://scheduler.zoom.us/francisca/ta-interview')?.kind).toBe('book');
    expect(selfServe('Please click the "FIND A TIME" button below to select a time slot that works best for you.')).toEqual({ kind: 'book' });
    expect(selfServe('Please schedule this to take place by 10/9/2026 by clicking the button below.')).toEqual({ kind: 'book' });
    expect(selfServe("When you're ready, start your AI interview here: Start your AI interview\nUnsubscribe: https://talent.micro1.ai/unsubscribe/?t=1")).toEqual({ kind: 'ai' });
    expect(selfServe('Click the link below to begin your AI interview. Take the AI Interview')).toEqual({ kind: 'ai' });
  });

  it('a recruiter asking you to reply with times is not self-serve', () => {
    expect(selfServe('Please let me know which of the following options works best for you next week.')).toBeNull();
    expect(selfServe('Could you share a few times that work for a call? https://www.htecgroup.com/')).toBeNull();
  });
});
