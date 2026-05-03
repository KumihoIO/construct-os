/**
 * stepEvents.ts — Typed CustomEvent bus for opening the step palette and
 * inserting nodes into the canvas. Every chooser surface emits this event;
 * the editor canvas listens once and is the only writer of canvas state.
 */

export interface AddStepDetail {
  /** StepType value from stepRegistry (e.g. "agent", "shell", "tag") */
  type: string;
  /** Optional canvas (flow) coordinates. Defaults to viewport center. */
  position?: { x: number; y: number };
  /** When emitted from a noodle-drop, the source node + handle to wire from. */
  source?: { taskId: string; handle?: 'true' | 'false' | null };
  /** Optional preset skill name to assign to the new node. */
  presetSkill?: string;
}

export const ADD_STEP_EVENT = 'construct:add-step';

/** Emit a typed CustomEvent that the editor listens for to insert a step. */
export function emitAddStep(detail: AddStepDetail): void {
  window.dispatchEvent(new CustomEvent<AddStepDetail>(ADD_STEP_EVENT, { detail }));
}

declare global {
  interface WindowEventMap {
    'construct:add-step': CustomEvent<AddStepDetail>;
  }
}
