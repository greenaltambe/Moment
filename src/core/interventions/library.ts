/**
 * Moment Core: Behavioral Message Library
 * Pure static message repository - zero browser dependencies, zero network requests.
 * Provides behavioral roast copy for mindful friction before interventions.
 */

import { MessageIntensity } from '../models/collection.js';

export const MOMENT_MESSAGE_LIBRARY: Record<MessageIntensity, readonly string[]> = {
  MILD: [
    'Really?',
    'Again?',
    'You sure?',
    'Was this actually the plan?',
    'Your attention called. You sent it here instead.',
    'Be honest. Why did you open this?',
    'Did you actually need this?',
    'One quick visit. Right.',
    'Interesting use of your time.',
    'You already know the answer.',
  ],

  SARCASTIC: [
    'Ah yes. A completely necessary visit.',
    'Excellent. Another very important scroll.',
    'Just checking one thing. Famous last words.',
    'And here we are again.',
    "Surely this time you'll stop after five minutes.",
    'Because apparently the thing you were avoiding can wait.',
    'Of course. This was definitely the priority.',
    'Nothing says productivity like opening this again.',
    "Your 'quick look' has entered the chat.",
    'Congratulations. You found another way to avoid starting.',
  ],

  SPICY: [
    'You opened this voluntarily. Incredible.',
    'You knew exactly what you were doing.',
    "You had one job: don't open this.",
    'You could be doing literally anything else right now.',
    'This is procrastination wearing a fake moustache.',
    "You're not confused about what you're doing.",
    "You're not taking a break. You're escaping.",
    "You didn't 'end up here.' You chose this.",
    'Your brain asked for stimulation. You handed it the keys.',
    "That thing you're avoiding is still waiting.",
    "You already know this isn't what you meant to do.",
    "You're bargaining with yourself again.",
    "How many 'last times' are we at now?",
    'You came here looking for an excuse, didn\'t you?',
  ],

  BRUTAL: [
    // Core Brutal Behavioral Callouts
    "You don't need this. You just want the escape.",
    'You already know how this ends.',
    "You're procrastinating. Stop pretending you aren't.",
    "This isn't a break. You're avoiding the thing you should be doing.",
    'Close it. You know exactly why you opened it.',
    "You're trading your actual goal for five minutes of cheap stimulation.",
    "Nothing changed since the last time you said 'just for a minute.'",
    "You're not here because you need this. You're here because starting is uncomfortable.",
    "Your task is still there. You're just making it wait.",
    "You know what you're supposed to be doing.",
    'That excuse sounded better in your head.',
    "You're trying to negotiate with a habit that already knows how to beat you.",
    'Another escape hatch. Convenient.',
    "You're not rewarding yourself. You're delaying yourself.",
    'Five minutes becomes thirty. You know the script.',
    "You're choosing the easy distraction over the thing you actually care about.",
    "Stop calling it a break when you haven't started.",
    "You're not checking something important. You're checking out.",
    'Your future self gets the bill for this.',
    'You can open it. But at least admit what you\'re doing.',
    "This isn't accidental anymore.",
    "You're repeating the exact behavior you're trying to stop.",
    'Be honest: this is avoidance.',
    "You don't need another scroll. You need to leave.",
    "Nothing on this page is more important than the thing you're avoiding.",
    'You\'re asking a website to solve a problem it didn\'t cause.',
    "You're looking for relief, not something you actually need.",
    "You're about to make the same choice and call it a different decision.",
    "Think about what you're giving up for this.",
    "Your goal didn't disappear. You just walked away from it.",
    "You're not lacking information. You're avoiding action.",
    "At this point, 'just checking' is comedy.",

    // Brutal — Harder Edge
    'Oh, come on. You know better than this.',
    'Seriously? This is what won?',
    'You had something better to do. You know it.',
    "You're really going to do this again?",
    "That's the excuse you're going with?",
    'You can stop pretending this is productive.',
    "You're not fooling anyone. Especially yourself.",
    "You don't need permission. You need to make the decision you already know you should make.",
    "Look at what you're choosing right now.",
    'This is exactly how you lose an hour.',
    "You're watching yourself make the decision you said you wouldn't make.",
    "You're not stuck. You're avoiding starting.",
    "You're making the easy choice because the useful one is harder.",
    "Don't turn a moment of weakness into an hour of nonsense.",
    'Put the phone down. The world will survive without this scroll.',
    'Close it. The excuse has already had enough screen time.',
    "You're spending your attention like it doesn't matter.",
    "Your attention is valuable. You're giving it away for free.",
    'You came here to avoid discomfort. Congratulations, you found it.',
    "That's enough. You know why Moment stopped you.",
  ],
};

/**
 * Selects a random message from the specified intensity library.
 * Normal local randomness is used.
 * Random selection never crosses intensity boundaries.
 *
 * @param intensity Desired message intensity tier (defaults to 'MILD')
 * @param rng Optional RNG generator for deterministic testing
 */
export function getRandomLibraryMessage(
  intensity: MessageIntensity = 'MILD',
  rng: () => number = Math.random
): string {
  const safeIntensity: MessageIntensity =
    intensity === 'SARCASTIC' || intensity === 'SPICY' || intensity === 'BRUTAL'
      ? intensity
      : 'MILD';
  const list = MOMENT_MESSAGE_LIBRARY[safeIntensity] || MOMENT_MESSAGE_LIBRARY.MILD;
  const index = Math.floor(rng() * list.length);
  return list[Math.min(index, list.length - 1)];
}
