import { describe, expect, it } from 'vitest';

import {
  ALL_ACTIONS,
  CHALLENGE_LENGTH,
  createChallenge,
  currentPrompt,
  FACE_LOST_MS,
  MIN_RELIEF_MM,
  stepFace,
  tick,
  TIMEOUT_MS,
  type ChallengeState,
  type FaceSample,
  type LivenessAction,
} from '../challenge';

const firstIndex = () => 0;

const NEUTRAL: Omit<FaceSample, 'timestamp'> = {
  faceCount: 1,
  offAxisDeg: 3,
  blinkLeft: 0.05,
  blinkRight: 0.05,
  smile: 0.05,
  jawOpen: 0.05,
  browUp: 0.05,
  depthReliefMm: 20,
};

const PERFORM: Record<LivenessAction, Partial<FaceSample>> = {
  blink: { blinkLeft: 0.9, blinkRight: 0.9 },
  smile: { smile: 0.8 },
  openMouth: { jawOpen: 0.7 },
  raiseBrows: { browUp: 0.8 },
};

class Driver {
  state: ChallengeState;
  t = 1_000;

  constructor(state?: ChallengeState) {
    this.state = state ?? createChallenge(this.t, firstIndex);
  }

  feed(sample: Partial<FaceSample> = {}, times = 1): this {
    for (let i = 0; i < times; i += 1) {
      this.t += 66;
      this.state = stepFace(this.state, { ...NEUTRAL, timestamp: this.t, ...sample });
    }
    return this;
  }

  perform(action: LivenessAction): this {
    return this.feed({}, 2).feed(PERFORM[action], 4);
  }

  completeAllActions(): this {
    for (const step of this.state.steps) {
      if (step !== 'center') this.perform(step);
    }
    return this;
  }
}

describe('createChallenge', () => {
  it('picks distinct actions plus a final centring step', () => {
    const state = createChallenge(0, firstIndex);
    expect(state.steps).toHaveLength(CHALLENGE_LENGTH + 1);
    expect(state.steps[CHALLENGE_LENGTH]).toBe('center');
    const actions = state.steps.slice(0, CHALLENGE_LENGTH);
    expect(new Set(actions).size).toBe(CHALLENGE_LENGTH);
    actions.forEach((a) => expect(ALL_ACTIONS).toContain(a));
  });

  it('uses the random source to vary the sequence', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 50; seed += 1) {
      let x = seed;
      const rand = (n: number) => {
        x = (x * 1103515245 + 12345) % 2147483648;
        return x % n;
      };
      seen.add(createChallenge(0, rand).steps.join(','));
    }
    expect(seen.size).toBeGreaterThan(10);
  });
});

describe('happy path', () => {
  it('passes after every action and a centred, 3D face', () => {
    const d = new Driver().completeAllActions();
    expect(currentPrompt(d.state)).toBe('Look straight at the camera');
    d.feed({}, 4);
    expect(d.state.status).toBe('ready_to_capture');
  });
});

describe('anti-spoofing', () => {
  it('never passes for a flat face (photo or screen)', () => {
    const d = new Driver();
    const flat = { depthReliefMm: 1 };
    for (const step of d.state.steps) {
      if (step !== 'center') d.feed(flat, 2).feed({ ...PERFORM[step], ...flat }, 4);
    }
    d.feed(flat, 50);
    expect(d.state.status).toBe('running');
    expect(tick(d.state, d.t + TIMEOUT_MS).failure).toBe('depth_check_failed');
  });

  it('requires a fresh depth measurement at the moment of capture', () => {
    const d = new Driver().completeAllActions().feed({ depthReliefMm: -1 }, 10);
    expect(d.state.status).toBe('running');
    d.feed({ depthReliefMm: MIN_RELIEF_MM }, 4);
    expect(d.state.status).toBe('ready_to_capture');
  });

  it('does not count a held expression for the next step', () => {
    const d = new Driver();
    const [first, second] = d.state.steps as LivenessAction[];
    // Hold the second action's expression from the start, through the first.
    d.feed(PERFORM[second], 2).feed({ ...PERFORM[second], ...PERFORM[first] }, 4);
    expect(d.state.index).toBe(1);
    d.feed(PERFORM[second], 10);
    expect(d.state.index).toBe(1);
    // It counts only after relaxing and doing it again.
    d.feed({}, 1).feed(PERFORM[second], 4);
    expect(d.state.index).toBe(2);
  });

  it('ignores a brief spike that is not held', () => {
    const d = new Driver();
    const first = d.state.steps[0] as LivenessAction;
    if (first === 'blink') return; // a blink is momentary by nature
    d.feed({}, 2).feed(PERFORM[first], 1).feed({}, 1).feed(PERFORM[first], 1);
    expect(d.state.index).toBe(0);
  });

  it('only centres with eyes open and mouth closed', () => {
    const d = new Driver().completeAllActions();
    d.feed({ blinkLeft: 0.9, blinkRight: 0.9 }, 10);
    expect(d.state.status).toBe('running');
    d.feed({ jawOpen: 0.6 }, 10);
    expect(d.state.status).toBe('running');
    d.feed({ offAxisDeg: 20 }, 10);
    expect(d.state.status).toBe('running');
  });
});

describe('failures', () => {
  it('fails immediately when a second face appears', () => {
    const d = new Driver().feed({ faceCount: 2 });
    expect(d.state.status).toBe('failed');
    expect(d.state.failure).toBe('multiple_faces');
  });

  it('fails when the face leaves the frame', () => {
    const d = new Driver().feed({}, 3);
    const later = tick(d.state, d.t + FACE_LOST_MS + 1);
    expect(later.failure).toBe('face_lost');
  });

  it('times out after the time limit', () => {
    const d = new Driver().feed({}, 10);
    const later = tick(d.state, d.state.startedAt + TIMEOUT_MS + 1);
    expect(later.failure).toBe('timeout');
  });

  it('stays failed once failed', () => {
    const d = new Driver().feed({ faceCount: 2 }).completeAllActions().feed({}, 10);
    expect(d.state.status).toBe('failed');
  });
});
