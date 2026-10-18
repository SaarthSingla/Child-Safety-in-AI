// Active liveness challenge: a random sequence of facial actions that a
// photo or a pre-recorded video cannot follow, plus a depth-relief check that
// a flat image on paper or a screen cannot pass. Pure logic, no UI or native
// code, so it is unit-testable.

export type LivenessAction =
  | 'blink'
  | 'smile'
  | 'openMouth'
  | 'raiseBrows';

export type FaceSample = {
  faceCount: number;
  timestamp: number;
  offAxisDeg?: number;
  blinkLeft?: number;
  blinkRight?: number;
  smile?: number;
  jawOpen?: number;
  browUp?: number;
  depthReliefMm: number;
};

export type LivenessFailure =
  | 'multiple_faces'
  | 'face_lost'
  | 'timeout'
  | 'depth_check_failed';

type Step = LivenessAction | 'center';

export type ChallengeState = {
  status: 'running' | 'ready_to_capture' | 'failed';
  steps: readonly Step[];
  index: number;
  // An action only counts after its signal was first seen relaxed, so an
  // expression held from the previous step cannot complete the next one.
  armed: boolean;
  hold: number;
  startedAt: number;
  lastFaceAt: number | null;
  depthOkCount: number;
  lastReliefMm: number;
  failure?: LivenessFailure;
};

export const CHALLENGE_LENGTH = 3;
export const TIMEOUT_MS = 45_000;
export const FACE_LOST_MS = 1_500;
export const MIN_RELIEF_MM = 8;
const MIN_DEPTH_OK_SAMPLES = 5;
const CENTER_MAX_OFF_AXIS_DEG = 12;
const CENTER_HOLD = 4;

type ActionRule = {
  prompt: string;
  metric: (s: FaceSample) => number;
  on: number;
  off: number;
  hold: number;
};

const ACTION_RULES: Record<LivenessAction, ActionRule> = {
  blink: {
    prompt: 'Blink both eyes',
    metric: (s) => Math.min(s.blinkLeft ?? 0, s.blinkRight ?? 0),
    on: 0.6,
    off: 0.25,
    hold: 1,
  },
  smile: {
    prompt: 'Smile',
    metric: (s) => s.smile ?? 0,
    on: 0.55,
    off: 0.25,
    hold: 3,
  },
  openMouth: {
    prompt: 'Open your mouth',
    metric: (s) => s.jawOpen ?? 0,
    on: 0.45,
    off: 0.15,
    hold: 3,
  },
  raiseBrows: {
    prompt: 'Raise your eyebrows',
    metric: (s) => s.browUp ?? 0,
    on: 0.5,
    off: 0.2,
    hold: 3,
  },
};

export const ALL_ACTIONS = Object.keys(ACTION_RULES) as LivenessAction[];

const CENTER_PROMPT = 'Look straight at the camera';

// randomInt(n) must return a uniformly random integer in [0, n).
export function createChallenge(
  nowMs: number,
  randomInt: (maxExclusive: number) => number,
): ChallengeState {
  const pool = [...ALL_ACTIONS];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return {
    status: 'running',
    steps: [...pool.slice(0, CHALLENGE_LENGTH), 'center'],
    index: 0,
    armed: false,
    hold: 0,
    startedAt: nowMs,
    lastFaceAt: null,
    depthOkCount: 0,
    lastReliefMm: -1,
  };
}

function fail(state: ChallengeState, failure: LivenessFailure): ChallengeState {
  return { ...state, status: 'failed', failure };
}

function timeoutFailure(state: ChallengeState): LivenessFailure {
  return state.depthOkCount < MIN_DEPTH_OK_SAMPLES ? 'depth_check_failed' : 'timeout';
}

export function tick(state: ChallengeState, nowMs: number): ChallengeState {
  if (state.status !== 'running') return state;
  if (nowMs - state.startedAt > TIMEOUT_MS) return fail(state, timeoutFailure(state));
  if (state.lastFaceAt !== null && nowMs - state.lastFaceAt > FACE_LOST_MS) {
    return fail(state, 'face_lost');
  }
  return state;
}

export function stepFace(state: ChallengeState, sample: FaceSample): ChallengeState {
  const ticked = tick(state, sample.timestamp);
  if (ticked.status !== 'running') return ticked;

  if (sample.faceCount > 1) return fail(ticked, 'multiple_faces');
  if (sample.faceCount === 0) return ticked;

  const depthOk = sample.depthReliefMm >= MIN_RELIEF_MM;
  let next: ChallengeState = {
    ...ticked,
    lastFaceAt: sample.timestamp,
    lastReliefMm: sample.depthReliefMm,
    depthOkCount: ticked.depthOkCount + (depthOk ? 1 : 0),
  };

  const step = next.steps[next.index];

  if (step === 'center') {
    const centered =
      (sample.offAxisDeg ?? 90) <= CENTER_MAX_OFF_AXIS_DEG &&
      Math.max(sample.blinkLeft ?? 1, sample.blinkRight ?? 1) < 0.35 &&
      (sample.jawOpen ?? 1) < 0.3 &&
      depthOk &&
      next.depthOkCount >= MIN_DEPTH_OK_SAMPLES;

    const hold = centered ? next.hold + 1 : 0;
    if (hold >= CENTER_HOLD) {
      return { ...next, hold, status: 'ready_to_capture' };
    }
    return { ...next, hold };
  }

  const rule = ACTION_RULES[step];
  const value = rule.metric(sample);

  if (!next.armed) {
    return value <= rule.off ? { ...next, armed: true, hold: 0 } : next;
  }

  const hold = value >= rule.on ? next.hold + 1 : 0;
  if (hold >= rule.hold) {
    next = { ...next, index: next.index + 1, armed: false, hold: 0 };
    return next;
  }
  return { ...next, hold };
}

export function currentPrompt(state: ChallengeState): string {
  const step = state.steps[state.index];
  return step === 'center' ? CENTER_PROMPT : ACTION_RULES[step].prompt;
}

export function progress(state: ChallengeState): { done: number; total: number } {
  return { done: state.index, total: state.steps.length };
}

export function failureMessage(failure: LivenessFailure): string {
  switch (failure) {
    case 'multiple_faces':
      return 'More than one face was in view. Make sure only you are in the frame.';
    case 'face_lost':
      return 'Your face left the frame. Keep your face inside the circle.';
    case 'depth_check_failed':
      return 'We could not confirm a real face in front of the camera. Photos and screens are not accepted.';
    case 'timeout':
      return 'The check took too long. Please try again.';
  }
}
