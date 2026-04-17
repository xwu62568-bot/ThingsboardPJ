import type { ThingsBoardState } from './ThingsBoardTypes';

type Listener = (state: ThingsBoardState) => void;

const defaultState: ThingsBoardState = {
  configured: false,
  connectionState: 'disabled',
};

export class ThingsBoardStore {
  private state: ThingsBoardState = defaultState;
  private listeners = new Set<Listener>();

  getState(): ThingsBoardState {
    return this.state;
  }

  setState(partial: Partial<ThingsBoardState>): void {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}
