import { MacroState, MacroStep } from '../types/macro';

export type HotkeyEvent = 'F8' | 'F3' | 'F9';

export interface StateMachineContext {
  state: MacroState;
  activeStepIndex: number;
  totalSteps: number;
  recordedSteps: MacroStep[];
  pausedStepIndex: number | null;
  patchSteps: MacroStep[];
  lastError: string | null;
}

export type StateListener = (context: StateMachineContext, eventTriggered?: HotkeyEvent) => void;

export class MacroStateMachine {
  private state: MacroState = 'IDLE';
  private activeStepIndex = 0;
  private recordedSteps: MacroStep[] = [];
  private pausedStepIndex: number | null = null;
  private patchSteps: MacroStep[] = [];
  private lastError: string | null = null;
  private listeners = new Set<StateListener>();

  constructor(initialSteps: MacroStep[] = []) {
    this.recordedSteps = [...initialSteps];
  }

  public getState(): MacroState {
    return this.state;
  }

  public getContext(): StateMachineContext {
    return {
      state: this.state,
      activeStepIndex: this.activeStepIndex,
      totalSteps: this.recordedSteps.length,
      recordedSteps: [...this.recordedSteps],
      pausedStepIndex: this.pausedStepIndex,
      patchSteps: [...this.patchSteps],
      lastError: this.lastError,
    };
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.getContext());
    return () => this.listeners.delete(listener);
  }

  private notify(eventTriggered?: HotkeyEvent) {
    const context = this.getContext();
    this.listeners.forEach((listener) => listener(context, eventTriggered));
  }

  public handleHotkey(event: HotkeyEvent): boolean {
    this.lastError = null;
    if (event === 'F8') return this.handleF8();
    if (event === 'F3') return this.handleF3();
    if (event === 'F9') return this.handleF9();
    return false;
  }

  private handleF8(): boolean {
    if (this.state === 'IDLE') {
      this.state = 'RECORDING';
      this.recordedSteps = [];
      this.activeStepIndex = 0;
      this.notify('F8');
      return true;
    }

    if (this.state === 'RECORDING') {
      this.state = 'IDLE';
      this.activeStepIndex = 0;
      this.notify('F8');
      return true;
    }

    if (this.state === 'PAUSED_AWAITING_USER') {
      this.state = 'RECORDING_PATCH';
      this.patchSteps = [];
      this.notify('F8');
      return true;
    }

    if (this.state === 'RECORDING_PATCH') {
      const insertAt = this.pausedStepIndex ?? this.activeStepIndex;
      const patchedSteps = [...this.recordedSteps];
      patchedSteps.splice(insertAt, 0, ...this.patchSteps);
      this.recordedSteps = patchedSteps.map((step, index) => ({
        ...step,
        stepNumber: index + 1,
      }));
      this.state = 'PAUSED_AWAITING_USER';
      this.notify('F8');
      return true;
    }

    return false;
  }

  private handleF3(): boolean {
    if (this.state === 'RECORDING' || this.state === 'RECORDING_PATCH') return false;
    if (this.recordedSteps.length === 0) {
      this.lastError = 'No macro steps loaded. Record [F8] or load a .json file first.';
      this.notify('F3');
      return false;
    }
    this.state = 'PLAYING';
    this.activeStepIndex = 0;
    this.notify('F3');
    return true;
  }

  private handleF9(): boolean {
    if (this.state === 'PLAYING') {
      this.pausedStepIndex = this.activeStepIndex;
      this.state = 'PAUSED_AWAITING_USER';
      this.notify('F9');
      return true;
    }

    if (this.state !== 'PAUSED_AWAITING_USER') return false;
    this.activeStepIndex = (this.pausedStepIndex ?? this.activeStepIndex) + this.patchSteps.length;
    this.patchSteps = [];
    this.state = 'PLAYING';
    this.notify('F9');
    return true;
  }

  public addRecordedStep(step: Omit<MacroStep, 'stepNumber'>) {
    if (this.state === 'RECORDING_PATCH') {
      this.patchSteps = [...this.patchSteps, { ...step, stepNumber: this.patchSteps.length + 1 }];
      this.notify();
      return;
    }
    if (this.state !== 'RECORDING') return;
    this.recordedSteps.push({ ...step, stepNumber: this.recordedSteps.length + 1 });
    this.notify();
  }

  public setActiveStepIndex(index: number) {
    this.activeStepIndex = index;
    this.notify();
  }

  public playbackCompleted() {
    if (this.state !== 'PLAYING') return;
    this.state = 'IDLE';
    this.activeStepIndex = 0;
    this.pausedStepIndex = null;
    this.patchSteps = [];
    this.notify();
  }

  public pauseForPatch(index: number, errorMessage: string) {
    this.pausedStepIndex = Math.max(0, Math.min(index, this.recordedSteps.length));
    this.activeStepIndex = this.pausedStepIndex;
    this.patchSteps = [];
    this.state = 'PAUSED_AWAITING_USER';
    this.lastError = errorMessage;
    this.notify();
  }

  public loadSteps(steps: MacroStep[]) {
    this.recordedSteps = [...(steps || [])];
    this.activeStepIndex = 0;
    this.state = 'IDLE';
    this.pausedStepIndex = null;
    this.patchSteps = [];
    this.lastError = null;
    this.notify();
  }

  public reset() {
    this.state = 'IDLE';
    this.activeStepIndex = 0;
    this.pausedStepIndex = null;
    this.patchSteps = [];
    this.lastError = null;
    this.notify();
  }
}
