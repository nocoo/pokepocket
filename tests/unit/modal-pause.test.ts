import { describe, expect, it } from 'vitest';
import { createModalPauseController } from '../../src/lib/modal-pause';

describe('modal-pause controller', () => {
  it('initializes with no open modal and no running intent', () => {
    const controller = createModalPauseController();
    expect(controller.getState()).toEqual({
      modal: null,
      runningIntent: false,
    });
  });

  it('records running intent and requests pause/persist when opening modal from running game', () => {
    const controller = createModalPauseController();
    const actions = controller.openModal('saves', { isRunning: true, hasCartridge: true });

    expect(actions).toEqual({ shouldPause: true, shouldPersist: true });
    expect(controller.getState()).toEqual({
      modal: 'saves',
      runningIntent: true,
    });
  });

  it('persists a loaded but paused cartridge when opening a modal', () => {
    const controller = createModalPauseController();
    const actions = controller.openModal('settings', { isRunning: false, hasCartridge: true });

    expect(actions).toEqual({ shouldPause: false, shouldPersist: true });
    expect(controller.getState()).toEqual({
      modal: 'settings',
      runningIntent: false,
    });
  });

  it('does not request pause/persist when opening modal while already paused', () => {
    const controller = createModalPauseController();
    const actions = controller.openModal('help', { isRunning: false });

    expect(actions).toEqual({ shouldPause: false, shouldPersist: false });
    expect(controller.getState()).toEqual({
      modal: 'help',
      runningIntent: false,
    });
  });

  it('preserves running intent across nested transitions (e.g. saves -> snapshot confirmation -> saves -> close)', () => {
    const controller = createModalPauseController();
    // 1. Opens 'saves' modal while game is running
    controller.openModal('saves', { isRunning: true });
    expect(controller.getState().runningIntent).toBe(true);

    // 2. Transitions to 'snapshot' confirmation
    controller.setModalDirectly('snapshot');
    expect(controller.getState()).toEqual({
      modal: 'snapshot',
      runningIntent: true,
    });

    // 3. Cancels confirmation back to 'saves'
    controller.setModalDirectly('saves');
    expect(controller.getState()).toEqual({
      modal: 'saves',
      runningIntent: true,
    });

    // 4. Closes 'saves' while in play view -> should resume
    const closeResult = controller.closeModal({ currentView: 'play' });
    expect(closeResult).toEqual({ shouldResume: true });
    expect(controller.getState()).toEqual({
      modal: null,
      runningIntent: false,
    });
  });

  it('does not resume game if initial intent was paused before modal opened', () => {
    const controller = createModalPauseController();
    // 1. Opens 'saves' modal while game was already paused
    controller.openModal('saves', { isRunning: false });
    expect(controller.getState().runningIntent).toBe(false);

    // 2. Transitions to 'snapshot' confirmation
    controller.setModalDirectly('snapshot');
    expect(controller.getState().runningIntent).toBe(false);

    // 3. Confirms or cancels back to close
    const closeResult = controller.closeModal({ currentView: 'play' });
    expect(closeResult).toEqual({ shouldResume: false });
    expect(controller.getState().runningIntent).toBe(false);
  });

  it('does not resume game if modal is closed in library view', () => {
    const controller = createModalPauseController();
    controller.openModal('settings', { isRunning: true });

    const closeResult = controller.closeModal({ currentView: 'library' });
    expect(closeResult).toEqual({ shouldResume: false });
    expect(controller.getState()).toEqual({
      modal: null,
      runningIntent: false,
    });
  });
});
